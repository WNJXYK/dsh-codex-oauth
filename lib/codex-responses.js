import { randomUUID } from "node:crypto";

export const CODEX_RESPONSES_ENDPOINT =
	"https://chatgpt.com/backend-api/codex/responses";

/** Build the list-only input shape required by the ChatGPT Codex gateway. */
export function buildUserTextInput(text) {
	if (typeof text !== "string" || text.length === 0) {
		throw new Error("OpenAI Codex input text must be a non-empty string");
	}
	return [
		{
			role: "user",
			content: [{ type: "input_text", text }],
		},
	];
}

/** Build the headers used by the ChatGPT Codex Responses backend. */
export function buildCodexHeaders(credential, requestId = randomUUID()) {
	if (
		typeof credential?.access !== "string" ||
		credential.access.length === 0 ||
		typeof credential?.accountId !== "string" ||
		credential.accountId.length === 0
	) {
		throw new Error("OpenAI Codex credential is incomplete");
	}
	return {
		authorization: `Bearer ${credential.access}`,
		"chatgpt-account-id": credential.accountId,
		"content-type": "application/json",
		accept: "text/event-stream",
		"openai-beta": "responses=experimental",
		originator: "codex_cli_rs",
		"user-agent": "dsh-codex-oauth/0.4.0",
		"x-client-request-id": requestId,
	};
}

/** Parse a complete Server-Sent Events response body. */
export function parseSseText(text) {
	const normalized = String(text).replace(/\r\n?/gu, "\n");
	const events = [];
	for (const block of normalized.split(/\n\n+/u)) {
		const data = block
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n")
			.trim();
		if (data.length === 0 || data === "[DONE]") continue;
		try {
			events.push(JSON.parse(data));
		} catch (error) {
			throw new Error(`Invalid OpenAI Codex SSE event: ${String(error)}`, {
				cause: error,
			});
		}
	}
	if (events.length === 0 && normalized.trim().startsWith("{")) {
		try {
			events.push(JSON.parse(normalized));
		} catch (error) {
			throw new Error(`Invalid OpenAI Codex response JSON: ${String(error)}`, {
				cause: error,
			});
		}
	}
	return events;
}

function eventError(events) {
	for (const event of events) {
		if (event?.type === "error") {
			return (
				event.error?.message ??
				event.message ??
				event.error?.code ??
				event.code ??
				"OpenAI Codex request failed"
			);
		}
		if (event?.type === "response.failed") {
			return (
				event.response?.error?.message ??
				event.response?.error?.code ??
				"OpenAI Codex response failed"
			);
		}
	}
	return undefined;
}

/** Execute one streaming request against the ChatGPT Codex Responses backend. */
export async function requestCodexEvents({
	credential,
	body,
	signal,
	endpoint = CODEX_RESPONSES_ENDPOINT,
	fetchImpl = globalThis.fetch,
}) {
	if (typeof fetchImpl !== "function") {
		throw new Error("fetch is unavailable in this runtime");
	}
	let response;
	try {
		response = await fetchImpl(endpoint, {
			method: "POST",
			headers: buildCodexHeaders(credential),
			body: JSON.stringify(body),
			...(signal === undefined ? {} : { signal }),
		});
	} catch (error) {
		if (signal?.aborted) throw new Error("OpenAI Codex request aborted", { cause: error });
		throw new Error(`OpenAI Codex request failed: ${String(error)}`, { cause: error });
	}
	const text = await response.text();
	if (!response.ok) {
		let detail = text.trim();
		try {
			const parsed = JSON.parse(text);
			detail = parsed.error?.message ?? parsed.message ?? detail;
		} catch {
			// Preserve the plain response body.
		}
		throw new Error(
			`OpenAI Codex request failed (HTTP ${response.status})${
				detail.length > 0 ? `: ${detail.slice(0, 500)}` : ""
			}`,
		);
	}
	const events = parseSseText(text);
	const error = eventError(events);
	if (error !== undefined) throw new Error(error);
	return events;
}

/** Collect final Responses output items from both item and response events. */
export function collectOutputItems(events) {
	const keyed = new Map();
	const anonymous = [];
	const add = (item) => {
		if (item === null || typeof item !== "object") return;
		const key =
			typeof item.id === "string"
				? `${String(item.type ?? "item")}:${item.id}`
				: undefined;
		if (key === undefined) anonymous.push(item);
		else keyed.set(key, item);
	};
	for (const event of events) {
		add(event?.item);
		for (const item of event?.response?.output ?? []) add(item);
		for (const item of event?.output ?? []) add(item);
	}
	return [...keyed.values(), ...anonymous];
}
