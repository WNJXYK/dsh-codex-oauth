import z from "@deepseek-ai/schemastery";
import {
	buildUserTextInput,
	collectOutputItems,
	requestCodexEvents,
} from "./codex-responses.js";

export const CODEX_SEARCH_PROVIDER_ID = "openai-codex";
export const DSH_DEFAULT_SEARCH_PROVIDER_ID = "deepseek-official";
export const DEFAULT_SEARCH_MODEL = "gpt-5.6-sol";
export const name = "codex-web-search";
export const inject = ["web", "openaiCodexAuth"];
export const Config = z.object({
	model: z.string().default(DEFAULT_SEARCH_MODEL),
});

class CodexWebError extends Error {
	constructor(message, code, options = {}) {
		super(message, options.cause === undefined ? {} : { cause: options.cause });
		this.name = "CodexWebError";
		this.code = code;
	}
}

const SEARCH_PROVIDER_SELECTION_FIELD = "searchProviderId";

/**
 * DSH 0.1.0-rc.6 resolves the selected search provider from this runtime
 * field but does not yet expose a public live-selection method. Keep the
 * compatibility seam isolated and fail clearly if a future DSH revision
 * changes it instead of silently leaving a missing provider configured.
 */
function createSearchProviderRouter(web) {
	if (
		web === null ||
		typeof web !== "object" ||
		!(SEARCH_PROVIDER_SELECTION_FIELD in web)
	) {
		throw new CodexWebError(
			"This DSH version does not support live web-search provider selection.",
			"WEB_PROVIDER_ROUTING_UNSUPPORTED",
		);
	}
	const selected = () => web[SEARCH_PROVIDER_SELECTION_FIELD];
	const select = (providerId) => {
		try {
			web[SEARCH_PROVIDER_SELECTION_FIELD] = providerId;
		} catch (error) {
			throw new CodexWebError(
				"DSH rejected the web-search provider selection update.",
				"WEB_PROVIDER_ROUTING_ERROR",
				{ cause: error },
			);
		}
		if (selected() !== providerId) {
			throw new CodexWebError(
				"DSH did not apply the web-search provider selection update.",
				"WEB_PROVIDER_ROUTING_ERROR",
			);
		}
	};
	return { selected, select };
}

function fallbackSearchProvider(providerId) {
	return providerId === CODEX_SEARCH_PROVIDER_ID
		? DSH_DEFAULT_SEARCH_PROVIDER_ID
		: providerId;
}

/** Build a forced hosted-web-search request for the Codex Responses backend. */
export function buildWebSearchRequest(query, model = DEFAULT_SEARCH_MODEL) {
	return {
		model,
		instructions:
			"Search the public web for the user's query. Return a concise factual answer with citations to the sources you used.",
		input: buildUserTextInput(query),
		tools: [{ type: "web_search" }],
		tool_choice: { type: "web_search" },
		parallel_tool_calls: false,
		stream: true,
		store: false,
		text: { verbosity: "low" },
	};
}

function citationOf(annotation) {
	if (annotation?.type !== "url_citation") return undefined;
	const value = annotation.url_citation ?? annotation;
	if (typeof value.url !== "string" || value.url.length === 0) return undefined;
	return {
		url: value.url,
		...(typeof value.title === "string" && value.title.length > 0
			? { title: value.title }
			: {}),
		...(typeof value.snippet === "string" && value.snippet.length > 0
			? { snippet: value.snippet }
			: {}),
	};
}

function resultSource(value) {
	if (typeof value?.url !== "string" || value.url.length === 0) return undefined;
	return {
		url: value.url,
		...(typeof value.title === "string" && value.title.length > 0
			? { title: value.title }
			: {}),
		...(typeof value.snippet === "string" && value.snippet.length > 0
			? { snippet: value.snippet }
			: {}),
		...(typeof (value.published_at ?? value.publishedAt) === "string"
			? { publishedAt: value.published_at ?? value.publishedAt }
			: {}),
	};
}

/** Map Responses messages and URL annotations into DSH's web seam vocabulary. */
export function mapCodexSearchEvents(events) {
	const textParts = [];
	const sources = new Map();
	const addSource = (source) => {
		if (source !== undefined && !sources.has(source.url)) sources.set(source.url, source);
	};
	for (const item of collectOutputItems(events)) {
		if (item.type === "web_search_call") {
			for (const result of item.results ?? item.action?.results ?? []) {
				addSource(resultSource(result));
			}
		}
		if (item.type !== "message" || item.role !== "assistant") continue;
		for (const block of item.content ?? []) {
			if (
				(block.type === "output_text" || block.type === "text") &&
				typeof block.text === "string" &&
				block.text.length > 0
			) {
				textParts.push(block.text);
			}
			for (const annotation of block.annotations ?? []) {
				addSource(citationOf(annotation));
			}
		}
	}
	const content = textParts.join("\n\n").trim();
	if (content.length === 0) {
		throw new Error("OpenAI Codex search returned no assistant answer");
	}
	// Some backend revisions inline Markdown citations but omit annotations.
	for (const match of content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu)) {
		addSource({ url: match[2], title: match[1] });
	}
	return {
		content,
		sources: [...sources.values()],
		truncated: false,
	};
}

export class OpenAICodexSearchProvider {
	id = CODEX_SEARCH_PROVIDER_ID;

	constructor(auth, model = DEFAULT_SEARCH_MODEL) {
		this.auth = auth;
		this.model = model;
	}

	available() {
		return this.auth.featureEnabled?.("search") !== false;
	}

	async search(request, signal) {
		try {
			if (this.auth.featureEnabled?.("search") === false) {
				throw new CodexWebError(
					"OpenAI Codex web search is disabled in Settings > Models.",
					"WEB_PROVIDER_DISABLED",
				);
			}
			const credential = await this.auth.credential(signal);
			if (credential === undefined) {
				throw new CodexWebError(
					"Sign in to OpenAI Codex in Settings > Models before searching the web.",
					"WEB_PROVIDER_CREDENTIAL_MISSING",
				);
			}
			const events = await requestCodexEvents({
				credential,
				body: buildWebSearchRequest(request.query, this.model),
				signal,
			});
			return mapCodexSearchEvents(events);
		} catch (error) {
			if (error instanceof CodexWebError) throw error;
			if (signal?.aborted) {
				throw new CodexWebError("OpenAI Codex search aborted", "WEB_ABORTED", {
					cause: error,
				});
			}
			throw new CodexWebError(
				`OpenAI Codex search failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				"WEB_PROVIDER_ERROR",
				{ cause: error },
			);
		}
	}
}

export function apply(ctx, config = {}) {
	ctx.effect(() => {
		const router = createSearchProviderRouter(ctx.web);
		let fallbackProvider = fallbackSearchProvider(router.selected());
		let appliedSelection;
		let ownsSelection = false;
		const disposeProvider = ctx.web.registerSearchProvider(
			new OpenAICodexSearchProvider(
				ctx.openaiCodexAuth,
				config.model ?? DEFAULT_SEARCH_MODEL,
			),
		);
		const sync = () => {
			const currentSelection = router.selected();
			// Preserve a provider selected by DSH or another plugin after startup.
			if (ownsSelection && currentSelection !== appliedSelection) {
				fallbackProvider = fallbackSearchProvider(currentSelection);
			}
			const enabled = ctx.openaiCodexAuth.featureEnabled("search");
			appliedSelection = enabled
				? CODEX_SEARCH_PROVIDER_ID
				: fallbackProvider;
			router.select(appliedSelection);
			ownsSelection = true;
		};
		let unwatch = () => {};
		let disposed = false;
		const teardown = () => {
			if (disposed) return;
			disposed = true;
			try {
				unwatch();
			} finally {
				try {
					const currentSelection = router.selected();
					if (
						currentSelection === CODEX_SEARCH_PROVIDER_ID ||
						(ownsSelection && currentSelection === appliedSelection)
					) {
						router.select(fallbackProvider);
					}
				} finally {
					disposeProvider();
				}
			}
		};
		try {
			unwatch = ctx.openaiCodexAuth.watchPreferences(sync);
			sync();
		} catch (error) {
			teardown();
			throw error;
		}
		return teardown;
	}, "dsh-codex-oauth: search feature toggle");
}

export default { name, inject, Config, apply };
