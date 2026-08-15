import { defineTool } from "@deepseek-ai/dsh-tools";
import {
	buildUserTextInput,
	collectOutputItems,
	parseSseText,
	requestCodexEvents,
} from "./codex-responses.js";

const MAINLINE_MODEL = "gpt-5.4";
export const name = "codex-image-tool";
export const inject = ["tools", "attachments", "openaiCodexAuth"];

function imageFromItem(item) {
	if (
		item?.type !== "image_generation_call" ||
		typeof item.result !== "string" ||
		item.result.length === 0
	) {
		return undefined;
	}
	return {
		data: item.result,
		format: item.output_format ?? "png",
		revisedPrompt: item.revised_prompt,
	};
}

/** Extract the first completed image call from Responses events. */
export function collectImage(events) {
	for (const item of collectOutputItems(events)) {
		const image = imageFromItem(item);
		if (image !== undefined) return image;
	}
	return undefined;
}

/** Backwards-compatible response parser used by tests and callers. */
export async function readImageEvent(response) {
	const events = parseSseText(await response.text());
	const image = collectImage(events);
	if (image !== undefined) return image;
	throw new Error("Codex returned no image_generation_call result");
}

/** Build the hosted image-tool request sent through the Codex backend. */
export function buildImageRequest(args) {
	const imageTool = {
		type: "image_generation",
		action: "generate",
		size: args.size ?? "1024x1024",
		quality: args.quality ?? "medium",
		background: args.background ?? "auto",
	};
	return {
		model: MAINLINE_MODEL,
		input: buildUserTextInput(args.prompt),
		instructions: "Generate the requested image and return the image result only.",
		tools: [imageTool],
		tool_choice: { type: "image_generation" },
		stream: true,
		store: false,
	};
}

export function imageToolDefinition(ctx) {
	return defineTool({
			name: "generate_image",
			description:
				"Generate an image with GPT Image through the signed-in ChatGPT/Codex subscription. Use when the user asks to create, draw, render, or generate an image.",
			parameters: {
				prompt: {
					type: "string",
					required: true,
					description: "A detailed image-generation prompt.",
				},
				size: {
					type: "string",
					enum: ["1024x1024", "1536x1024", "1024x1536"],
					description: "Output dimensions.",
				},
				quality: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "Rendering quality.",
				},
				background: {
					type: "string",
					enum: ["auto", "opaque"],
					description: "Background mode.",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						attachmentId: { type: "string", required: true },
						mediaType: { type: "string", required: true },
						bytes: { type: "integer", required: true },
						width: { type: "integer", required: true },
						height: { type: "integer", required: true },
						name: { type: "string" },
						revisedPrompt: { type: "string" },
					},
				},
				render: (_args, image) => [
					{
						type: "image",
						attachment: {
							attachmentId: image.attachmentId,
							mediaType: image.mediaType,
							bytes: image.bytes,
							width: image.width,
							height: image.height,
							...(image.name === undefined ? {} : { name: image.name }),
						},
					},
					{
						type: "text",
						text: image.revisedPrompt
							? `Generated image. Revised prompt: ${image.revisedPrompt}`
							: "Generated image.",
					},
				],
			},
			timeoutMs: 300_000,
			async execute(args, exec) {
				const credential = await ctx.openaiCodexAuth.credential(exec.signal);
				if (credential === undefined) {
					throw new Error(
						"Sign in to OpenAI Codex in Settings > Models before generating images.",
					);
				}
				const events = await requestCodexEvents({
					credential,
					body: buildImageRequest(args),
					signal: exec.signal,
				});
				const result = collectImage(events);
				if (result === undefined) {
					throw new Error("Codex returned no image_generation_call result");
				}
				const mediaType =
					result.format === "webp"
						? "image/webp"
						: result.format === "jpeg" || result.format === "jpg"
							? "image/jpeg"
							: "image/png";
				const data = Buffer.from(result.data, "base64");
				const ref = await ctx.attachments.saveImage({
					data,
					mediaType,
					name: `gpt-image-${Date.now()}.${result.format}`,
				});
				return {
					...ref,
					...(result.revisedPrompt === undefined
						? {}
						: { revisedPrompt: result.revisedPrompt }),
				};
			},
			presentCall: (args) => ({
				card: "generic",
				title: "Generate image",
				kind: "other",
				rawInput: args.prompt,
			}),
		});
}

export function apply(ctx) {
	ctx.effect(() => {
		let disposeTool;
		const sync = () => {
			const enabled = ctx.openaiCodexAuth.featureEnabled("image");
			if (enabled && disposeTool === undefined) {
				disposeTool = ctx.tools.register(imageToolDefinition(ctx));
			} else if (!enabled && disposeTool !== undefined) {
				disposeTool();
				disposeTool = undefined;
			}
		};
		const unwatch = ctx.openaiCodexAuth.watchPreferences(sync);
		sync();
		return () => {
			unwatch();
			disposeTool?.();
		};
	}, "dsh-codex-oauth: image feature toggle");
}

export default { name, inject, apply };
