import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
	buildImageRequest,
	collectImage,
	apply as imageApply,
	inject as imageInject,
} from "../lib/image-tool.js";
import {
	CODEX_SEARCH_PROVIDER_ID,
	OpenAICodexSearchProvider,
	apply as searchApply,
	buildWebSearchRequest,
	inject as searchInject,
	mapCodexSearchEvents,
} from "../lib/web-search.js";
import {
	buildUserTextInput,
	collectOutputItems,
	parseSseText,
} from "../lib/codex-responses.js";

console.log("1. service wiring");
assert.deepEqual(imageInject, ["tools", "attachments", "openaiCodexAuth"]);
assert.deepEqual(searchInject, ["web", "openaiCodexAuth"]);
assert.equal(new OpenAICodexSearchProvider({}).id, CODEX_SEARCH_PROVIDER_ID);
console.log("  ok - image and search depend on the registered OAuth service");

console.log("2. request payloads");
const imageBody = buildImageRequest({ prompt: "draw a cat", quality: "low" });
assert.deepEqual(imageBody.input, [
	{
		role: "user",
		content: [{ type: "input_text", text: "draw a cat" }],
	},
]);
assert.equal(imageBody.tools[0].type, "image_generation");
assert.equal(imageBody.tools[0].action, "generate");
assert.equal(imageBody.tools[0].quality, "low");
assert.deepEqual(imageBody.tool_choice, { type: "image_generation" });
const searchBody = buildWebSearchRequest("latest space news");
assert.deepEqual(searchBody.input, buildUserTextInput("latest space news"));
assert.deepEqual(searchBody.tools, [{ type: "web_search" }]);
assert.deepEqual(searchBody.tool_choice, { type: "web_search" });
let imageDefinition;
let imageDisposeCount = 0;
let imageRegisterCount = 0;
let imageEnabled = true;
let imageWatcher;
imageApply({
	effect(callback) {
		this.cleanup = callback();
		return this.cleanup;
	},
	openaiCodexAuth: {
		featureEnabled() {
			return imageEnabled;
		},
		watchPreferences(callback) {
			imageWatcher = callback;
			return () => {};
		},
	},
	tools: {
		register(definition) {
			imageRegisterCount += 1;
			imageDefinition = definition;
			return () => { imageDisposeCount += 1; };
		},
	},
});
assert.equal(imageRegisterCount, 1);
imageEnabled = false;
imageWatcher();
assert.equal(imageDisposeCount, 1);
imageEnabled = true;
imageWatcher();
assert.equal(imageRegisterCount, 2);
assert.deepEqual(imageDefinition.output.schema.properties.name, {
	type: "string",
});
assert.equal(imageDefinition.output.schema.properties.data, undefined);
assert.deepEqual(
	imageDefinition.output.render(
		{},
		{
			attachmentId: "att_test",
			mediaType: "image/png",
			bytes: 123,
			width: 1024,
			height: 1024,
			name: "cat.png",
		},
	)[0],
	{
		type: "image",
		attachment: {
			attachmentId: "att_test",
			mediaType: "image/png",
			bytes: 123,
			width: 1024,
			height: 1024,
			name: "cat.png",
		},
	},
);
console.log("  ok - hosted image and web-search tools are forced");

let searchEnabled = true;
let searchWatcher;
let searchRegisters = 0;
let searchDisposes = 0;
searchApply({
	effect(callback) {
		this.cleanup = callback();
		return this.cleanup;
	},
	openaiCodexAuth: {
		featureEnabled() {
			return searchEnabled;
		},
		watchPreferences(callback) {
			searchWatcher = callback;
			return () => {};
		},
	},
	web: {
		registerSearchProvider() {
			searchRegisters += 1;
			return () => { searchDisposes += 1; };
		},
	},
});
assert.equal(searchRegisters, 1);
searchEnabled = false;
searchWatcher();
assert.equal(searchDisposes, 1);
searchEnabled = true;
searchWatcher();
assert.equal(searchRegisters, 2);

console.log("3. SSE parsing and image extraction");
const imageEvents = parseSseText(
	`event: response.output_item.done\ndata: ${JSON.stringify({
		type: "response.output_item.done",
		item: {
			id: "ig_1",
			type: "image_generation_call",
			result: "aW1hZ2U=",
			revised_prompt: "a small cat",
		},
	})}\n\ndata: [DONE]\n\n`,
);
assert.equal(collectOutputItems(imageEvents).length, 1);
assert.deepEqual(collectImage(imageEvents), {
	data: "aW1hZ2U=",
	format: "png",
	revisedPrompt: "a small cat",
});
console.log("  ok - image_generation_call result is decoded from SSE");

console.log("4. web answer and citation mapping");
const searchEvents = [
	{
		type: "response.completed",
		response: {
			output: [
				{
					id: "ws_1",
					type: "web_search_call",
					results: [
						{
							url: "https://example.com/secondary",
							title: "Secondary",
							snippet: "Supporting result",
						},
					],
				},
				{
					id: "msg_1",
					type: "message",
					role: "assistant",
					content: [
						{
							type: "output_text",
							text: "Current answer [Primary](https://example.com/primary).",
							annotations: [
								{
									type: "url_citation",
									url: "https://example.com/primary",
									title: "Primary",
								},
							],
						},
					],
				},
			],
		},
	},
];
const mapped = mapCodexSearchEvents(searchEvents);
assert.match(mapped.content, /Current answer/u);
assert.deepEqual(
	mapped.sources.map((source) => source.url),
	["https://example.com/secondary", "https://example.com/primary"],
);
assert.equal(mapped.truncated, false);
console.log("  ok - DSH receives answer text plus structured source URLs");

console.log("5. signed-out search error");
const signedOut = new OpenAICodexSearchProvider({
	async credential() {
		return undefined;
	},
});
await assert.rejects(
	() => signedOut.search({ query: "news" }),
	(error) =>
		error?.code === "WEB_PROVIDER_CREDENTIAL_MISSING" &&
		/sign in/iu.test(error.message),
);
console.log("  ok - signed-out users receive an actionable login error");

console.log("6. client module registration");
const clientSource = fs.readFileSync(
	new URL("../lib/client.js", import.meta.url),
	"utf8",
);
let clientModule;
const clientDocument = {
	createElement() {
		return { dataset: {}, remove() {} };
	},
	head: { appendChild() {} },
};
vm.runInNewContext(clientSource, {
	document: clientDocument,
	window: {
		__ModuleLoader__: {
			load(module) {
				clientModule = module;
			},
		},
	},
});
assert.equal(clientModule?.id, "@wnjxyk/dsh-codex-oauth");
assert.equal(typeof clientModule?.factory, "function");
const clientExports = clientModule.factory(() => ({}));
assert.deepEqual(Array.from(clientExports.inject), ["slots", "conversation", "locale"]);
assert.equal(clientExports.remainingPercent({ usedPercent: 27 }), 73);
assert.equal(clientExports.remainingPercent({ usedPercent: 120 }), 0);
assert.equal(clientExports.remainingPercent({ usedPercent: -5 }), 100);
const quotaStrings = {
	quotaWeekly: "Weekly quota",
	quotaFiveHour: "5-hour quota",
};
const quotaT = (key) => quotaStrings[key] ?? key;
assert.equal(clientExports.usageWindowLabel({ windowSeconds: 604800 }, "Primary", quotaT), "Weekly quota");
assert.equal(clientExports.usageWindowLabel({ windowSeconds: 18000 }, "Primary", quotaT), "5-hour quota");
assert.equal(clientExports.usageWindowLabel({}, "Primary", quotaT), "Primary");
assert.equal(clientExports.dictionaries.zh.quotaTitle, "Codex 剩余额度");
assert.equal(clientExports.dictionaries.en.quotaTitle, "Codex quota remaining");
assert.equal(clientExports.dictionaries.zh.edit, "编辑");
assert.equal(clientExports.dictionaries.en.collapse, "Collapse");
assert.match(clientExports.dictionaries.zh.signedIn, /GPT 模型/u);
assert.deepEqual(
	Array.from(clientExports.selectedModelIds({
		selectedModels: ["gpt-b"],
		availableModels: [{ id: "gpt-a" }, { id: "gpt-b" }],
	})),
	["gpt-b"],
);
assert.match(clientExports.themeStyle, /--dsw-alias-bg-layer-1/u);
assert.match(clientExports.themeStyle, /--dsw-alias-label-primary/u);
assert.match(clientExports.themeStyle, /--dsw-alias-state-success-primary/u);
assert.match(clientExports.themeStyle, /--dsw-alias-state-error-primary/u);
assert.match(clientExports.themeStyle, /--dsw-alias-button-elevated-fill/u);
assert.match(clientExports.preferencesStyle, /openai-codex/u);
assert.match(clientExports.preferencesStyle, /codex-model-option/u);
assert.match(clientExports.collapseStyle, /codex-edit-button/u);
assert.match(clientExports.collapseStyle, /--dsw-alias-button-elevated-fill/u);
assert.match(clientExports.collapseStyle, /codex-quota\{margin-top:10px;padding:8px 10px\}/u);
assert.match(clientSource, /useState\(false\)/u);
assert.match(clientSource, /"aria-expanded": expanded/u);
assert.match(clientSource, /"aria-controls": "codex-subscription-features"/u);
assert.ok(
	clientSource.indexOf('jsx.jsx(CodexQuota, { status, t })') <
		clientSource.indexOf('expanded && jsx.jsxs("div", { id: "codex-subscription-features"'),
);
const slotRegistrations = [];
const resolvedAttachments = [];
const localeRegistrations = [];
clientExports.apply({
	effect(callback) {
		return callback();
	},
	conversation: {
		resolveImage(sessionId, attachment) {
			resolvedAttachments.push({ sessionId, attachment });
			return Promise.resolve("blob:test");
		},
	},
	locale: {
		register(namespace, dictionaries) {
			localeRegistrations.push({ namespace, dictionaries });
			return () => {};
		},
	},
	slots: {
		inject(name, callback) {
			assert.ok(["settings.models.before", "tool.call.toolview"].includes(name));
			callback();
		},
		register(options, component) {
			slotRegistrations.push({ options, component });
		},
	},
});
const settingsRegistration = slotRegistrations.find((entry) => entry.options.name === "settings.models.before");
const imageRegistration = slotRegistrations.find((entry) => entry.options.name === "tool.call.toolview");
assert.equal(settingsRegistration?.options?.id, "dsh-codex-oauth");
assert.equal(settingsRegistration?.options?.locale, "dsh-codex-oauth");
assert.equal(typeof settingsRegistration?.component, "function");
assert.equal(imageRegistration?.options?.key, "generate_image");
assert.equal(imageRegistration?.options?.locale, "dsh-codex-oauth");
assert.equal(typeof imageRegistration?.component, "function");
assert.equal(localeRegistrations[0]?.namespace, "dsh-codex-oauth");
assert.deepEqual(localeRegistrations[0]?.dictionaries, clientExports.dictionaries);
const attachment = { attachmentId: "att_preview", mediaType: "image/png", width: 1024, height: 1024 };
assert.equal(clientExports.imageAttachment({ kind: "tool-result", content: [{ type: "image", attachment }] }), attachment);
assert.equal(clientExports.imagePrompt({ argsRaw: '{"prompt":"draw a kitten"}' }), "draw a kitten");
assert.equal(await imageRegistration.options.inject("session-1").resolveImage(attachment), "blob:test");
assert.deepEqual(resolvedAttachments, [{ sessionId: "session-1", attachment }]);
console.log("  ok - bilingual quota and image surfaces follow DSH locale and theme tokens");

console.log("7. unified subscription model-provider patch");
const bundlePatch = fs.readFileSync(
	new URL("../cordis.patch.yml", import.meta.url),
	"utf8",
);
assert.match(bundlePatch, /^\s*-\s+id:\s+llm-pi-ai\s*$/mu);
assert.match(bundlePatch, /^\s+providers:\s*$/mu);
assert.match(bundlePatch, /^\s+openai-codex:\s*$/mu);
assert.match(bundlePatch, /^\s+apiKeyEnv:\s+DSH_OPENAI_CODEX_TOKEN\s*$/mu);
assert.match(bundlePatch, /^\s+searchProvider:\s+openai-codex\s*$/mu);
assert.match(bundlePatch, /^\s+name:\s+["']@wnjxyk\/dsh-codex-oauth["']\s*$/mu);
console.log("  ok - GPT models are registered while the generic provider editor is hidden");

console.log("\nall 7 tool checks passed");
