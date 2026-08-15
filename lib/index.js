/**
 * Native OpenAI Codex subscription login for DeepSeek Harness.
 *
 * This plugin supplies a valid OAuth credential, DSH's built-in GPT model
 * provider, plus hosted image-generation and web-search tools. The native
 * generic provider editor is hidden by the client; subscription-specific
 * model and feature controls live in the unified Codex panel instead:
 *
 * 1. Complete the OpenAI OAuth PKCE flow (browser redirect or device code).
 * 2. Persist and refresh `{ access, refresh, expires, accountId }`.
 * 3. Make the access token available to this package's hosted tools and DSH's
 *    built-in `openai-codex` model provider.
 * 4. Serve a 127.0.0.1 control endpoint to trigger login, read status, and
 *    fetch ChatGPT Codex usage for a settings card.
 *
 * The OAuth flow is OpenAI's standard public protocol (the same client id the
 * Codex CLI itself registers); this is an independent implementation.
 *
 * @module dsh-codex-oauth
 */
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Defaults (public protocol facts; every endpoint is config-overridable)
// ---------------------------------------------------------------------------
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_ISSUER = "https://auth.openai.com";
const DEFAULT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_CONTROL_PORT = 1456;
const DEFAULT_REDIRECT_PORT = 1455;
const DEFAULT_FILENAME = "codex-oauth.json";
const DEFAULT_PREFERENCES_FILENAME = "codex-oauth-preferences.json";
const USAGE_CACHE_MS = 30_000;
const USAGE_REQUEST_TIMEOUT_MS = 8_000;
const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_MARGIN_MS = 60_000;
/** Credential reference consumed by DSH's built-in `openai-codex` provider. */
const TOKEN_REF = credentialRef("DSH_OPENAI_CODEX_TOKEN");

/**
 * The plugin config. Endpoints and ports are overridable for tests and
 * gateways; the OAuth issuer, usage endpoint, and local callback ports each
 * have a documented default applied in {@link resolveSpec}.
 */
const Config = z.object({
	path: z.string(),
	preferencesPath: z.string(),
	dshHome: z.string(),
	issuer: z.string().default(DEFAULT_ISSUER),
	usageUrl: z.string().default(DEFAULT_USAGE_URL),
	controlPort: z.natural().default(DEFAULT_CONTROL_PORT),
	redirectPort: z.natural().default(DEFAULT_REDIRECT_PORT),
});

/**
 * Resolve the runtime spec from plugin config in one explicit step. Every
 * default lives here, never inline, so programmatic construction that
 * bypasses Schemastery normalization still resolves identically.
 * @param config - raw plugin config.
 * @returns validated endpoints, ports, and the credential file path.
 */
function resolveSpec(config) {
	const issuer = config.issuer ?? DEFAULT_ISSUER;
	const usageUrl = config.usageUrl ?? DEFAULT_USAGE_URL;
	const controlPort = config.controlPort ?? DEFAULT_CONTROL_PORT;
	const redirectPort = config.redirectPort ?? DEFAULT_REDIRECT_PORT;
	return {
		filename: resolve(
			config.path ?? join(resolveDshHome(config.dshHome), DEFAULT_FILENAME),
		),
		preferencesFilename: resolve(
			config.preferencesPath ??
				join(
					config.path === undefined
						? resolveDshHome(config.dshHome)
						: dirname(resolve(config.path)),
					DEFAULT_PREFERENCES_FILENAME,
				),
		),
		issuer,
		usageUrl,
		controlPort,
		redirectPort,
		tokenUrl: `${issuer}/oauth/token`,
		authorizeUrl: `${issuer}/oauth/authorize`,
		deviceCodeUrl: `${issuer}/api/accounts/deviceauth/usercode`,
		deviceTokenUrl: `${issuer}/api/accounts/deviceauth/token`,
		deviceAuthUrl: `${issuer}/codex/device`,
		redirectUri: `http://localhost:${redirectPort}/auth/callback`,
		deviceRedirectUri: `${issuer}/deviceauth/callback`,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64Url(bytes) {
	return Buffer.from(bytes).toString("base64url");
}

function pkceChallenge(verifier) {
	return base64Url(createHash("sha256").update(verifier).digest());
}

function decodeJwtPayload(token) {
	const parts = String(token).split(".");
	if (parts.length !== 3) return undefined;
	try {
		return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
}

/**
 * Extract the ChatGPT account id from a token's claims.
 * @param token - the access token.
 * @param idToken - optional id token used as a fallback claim source.
 * @returns the account id, or `undefined`.
 */
function extractAccountId(token, idToken) {
	const claims = decodeJwtPayload(token);
	const id =
		claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
		claims?.chatgpt_account_id ??
		claims?.organizations?.[0]?.id;
	if (typeof id === "string" && id.length > 0) return id;
	const idClaims = idToken === undefined ? undefined : decodeJwtPayload(idToken);
	const fallback =
		idClaims?.chatgpt_account_id ??
		idClaims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
	if (typeof fallback === "string" && fallback.length > 0) return fallback;
	return undefined;
}

function parseCredential(text) {
	const doc = JSON.parse(text);
	const credential = doc?.credential;
	if (
		doc?.version !== 1 ||
		credential === undefined ||
		typeof credential.access !== "string" ||
		typeof credential.refresh !== "string" ||
		typeof credential.expires !== "number" ||
		typeof credential.accountId !== "string"
	) {
		throw new Error("dsh-codex-oauth: invalid credential document");
	}
	return credential;
}

async function readCredential(filename) {
	try {
		return parseCredential(await readFile(filename, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	}
}

const DEFAULT_PREFERENCES = Object.freeze({
	searchEnabled: true,
	imageEnabled: true,
	selectedModels: null,
	availableModels: [],
});

function modelOption(value) {
	if (value === null || typeof value !== "object") return undefined;
	const id = typeof value.id === "string" ? value.id.trim() : "";
	if (id.length === 0) return undefined;
	const name = typeof value.name === "string" && value.name.trim().length > 0
		? value.name.trim()
		: id;
	return { id, name };
}

function uniqueModels(values) {
	const models = new Map();
	for (const value of Array.isArray(values) ? values : []) {
		const model = modelOption(value);
		if (model !== undefined && !models.has(model.id)) models.set(model.id, model);
	}
	return [...models.values()];
}

function normalizePreferences(value) {
	const root = value !== null && typeof value === "object" ? value : {};
	const selected = root.selectedModels === null
		? null
		: Array.isArray(root.selectedModels)
			? [...new Set(root.selectedModels.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))]
			: null;
	return {
		searchEnabled: root.searchEnabled !== false,
		imageEnabled: root.imageEnabled !== false,
		selectedModels: selected !== null && selected.length === 0 ? null : selected,
		availableModels: uniqueModels(root.availableModels),
	};
}

async function readPreferences(filename) {
	try {
		const document = JSON.parse(await readFile(filename, "utf8"));
		return normalizePreferences(document?.version === 1 ? document.preferences : document);
	} catch (error) {
		if (error?.code === "ENOENT") return normalizePreferences(DEFAULT_PREFERENCES);
		throw error;
	}
}

function readJsonRequest(request, limit = 64 * 1024) {
	return new Promise((resolveBody, rejectBody) => {
		const chunks = [];
		let bytes = 0;
		request.on("data", (chunk) => {
			bytes += chunk.length;
			if (bytes > limit) {
				rejectBody(new Error("Request body is too large"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			try {
				resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch {
				rejectBody(new Error("Request body must be valid JSON"));
			}
		});
		request.on("error", rejectBody);
	});
}

/**
 * Reduce the `wham/usage` reply to the stable display fields.
 * @param value - the parsed usage response.
 * @returns normalized plan and rate-limit windows.
 */
function normalizeUsage(value) {
	const root = value !== null && typeof value === "object" ? value : {};
	const limits = root.rate_limit !== null && typeof root.rate_limit === "object" ? root.rate_limit : {};
	const credits =
		root.rate_limit_reset_credits !== null &&
		typeof root.rate_limit_reset_credits === "object"
			? root.rate_limit_reset_credits
			: undefined;
	const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
	const windowOf = (w) => {
		if (w === null || typeof w !== "object") return undefined;
		const usedPercent = num(w.used_percent ?? w.usedPercent);
		if (usedPercent === undefined) return undefined;
		return {
			usedPercent: Math.max(0, Math.min(100, usedPercent)),
			...(num(w.limit_window_seconds ?? w.windowDurationSecs) !== undefined
				? { windowSeconds: num(w.limit_window_seconds ?? w.windowDurationSecs) }
				: {}),
			...(num(w.reset_at ?? w.resetsAt) !== undefined
				? { resetAt: num(w.reset_at ?? w.resetsAt) }
				: {}),
		};
	};
	return {
		...(typeof root.plan_type === "string" ? { planType: root.plan_type } : {}),
		...(windowOf(limits.primary_window ?? limits.primary) !== undefined
			? { primary: windowOf(limits.primary_window ?? limits.primary) }
			: {}),
		...(windowOf(limits.secondary_window ?? limits.secondary) !== undefined
			? { secondary: windowOf(limits.secondary_window ?? limits.secondary) }
			: {}),
		...(typeof limits.limit_reached === "boolean" ? { limitReached: limits.limit_reached } : {}),
		...(num(credits?.available_count) !== undefined
			? { resetCredits: num(credits.available_count) }
			: {}),
		fetchedAt: Date.now(),
	};
}

function isLocalOrigin(origin) {
	if (origin === undefined) return false;
	try {
		const hostname = new URL(origin).hostname;
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export class OpenAICodexAuth extends Service {
	static Config = Config;
	static inject = ["credentials", "llm", "settings"];

	constructor(ctx, config) {
		super(ctx, "openaiCodexAuth");
		// Programmatic construction may bypass Schemastery normalization;
		// resolve defaults in one explicit step either way.
		this.spec = resolveSpec(config);
		this.csrf = base64Url(randomBytes(24));
		this.usageCache = undefined;
		this.usageError = undefined;
		this.loginFlow = undefined;
		this.lastLoginError = undefined;
		this.preferencesState = normalizePreferences(DEFAULT_PREFERENCES);
		this.preferenceListeners = new Set();
	}

	/** Service lifecycle: inject/refresh the token, run the control server. */
	async *[Service.init]() {
		this.preferencesState = await readPreferences(this.spec.preferencesFilename);
		await this.refreshAvailableModels();
		const token = await this.bearerToken();
		if (token !== undefined) {
			await this.ctx.credentials.set(TOKEN_REF, token);
		} else {
			this.ctx.logger.info(
				`dsh-codex-oauth: not logged in — browser login: open http://127.0.0.1:${this.spec.controlPort}/start ; headless/SSH: curl http://127.0.0.1:${this.spec.controlPort}/start-device`,
			);
		}
		const timer = setInterval(() => {
			void this.bearerToken().catch(() => {});
		}, REFRESH_INTERVAL_MS);
		const disposeControl = await this.startControlServer();
		yield async () => {
			clearInterval(timer);
			this.loginFlow?.abort.abort();
			disposeControl();
		};
	}

	/** Return a detached, browser-safe view of the subscription preferences. */
	preferences() {
		const current = this.preferencesState ?? normalizePreferences(DEFAULT_PREFERENCES);
		return {
			searchEnabled: current.searchEnabled,
			imageEnabled: current.imageEnabled,
			selectedModels: current.selectedModels === null ? null : [...current.selectedModels],
			availableModels: current.availableModels.map((model) => ({ ...model })),
		};
	}

	/** Whether a hosted subscription feature is currently enabled. */
	featureEnabled(feature) {
		const current = this.preferencesState ?? DEFAULT_PREFERENCES;
		return feature === "search" ? current.searchEnabled !== false : current.imageEnabled !== false;
	}

	/** Observe live preference changes; used to mount/unmount hosted tools. */
	watchPreferences(listener) {
		this.preferenceListeners ??= new Set();
		this.preferenceListeners.add(listener);
		return () => this.preferenceListeners.delete(listener);
	}

	async refreshAvailableModels() {
		try {
			const discovered = uniqueModels(await this.ctx.llm.listModels("openai-codex"));
			if (discovered.length === 0) return;
			const previous = this.preferencesState ?? normalizePreferences(DEFAULT_PREFERENCES);
			this.preferencesState = {
				...previous,
				availableModels: uniqueModels([...discovered, ...previous.availableModels]),
			};
		} catch {
			// The provider may still be mounting during startup; the stored catalog
			// remains usable and a later preference update refreshes it again.
		}
	}

	async writePreferences(preferences) {
		await writeFileAtomic(
			this.spec.preferencesFilename,
			`${JSON.stringify({ version: 1, preferences }, null, 2)}\n`,
			{ mode: 0o600, dirMode: 0o700 },
		);
	}

	async applyModelSelection(selectedModels) {
		const op = selectedModels === null
			? { op: "unset", path: ["providers", "openai-codex", "models"] }
			: {
				op: "set",
				path: ["providers", "openai-codex", "models"],
				value: selectedModels.map((id) => ({ id })),
			};
		await this.ctx.settings.mutate("llm-pi-ai", [op]);
	}

	/** Validate, persist, and apply the subscription-specific feature controls. */
	async updatePreferences(input) {
		return withFileLock(this.spec.preferencesFilename, async () => {
			const previous = this.preferencesState ?? normalizePreferences(DEFAULT_PREFERENCES);
			const previousPublic = this.preferences();
			if (Array.isArray(input?.selectedModels) && input.selectedModels.length === 0) {
				throw new Error("At least one GPT model must remain visible");
			}
			const requested = normalizePreferences({ ...previous, ...input });
			const known = new Set(previous.availableModels.map((model) => model.id));
			if (requested.selectedModels !== null) {
				const unknown = requested.selectedModels.find((id) => !known.has(id));
				if (unknown !== undefined) throw new Error(`Unknown OpenAI Codex model: ${unknown}`);
				if (requested.selectedModels.length === 0) throw new Error("At least one GPT model must remain visible");
			}
			const allSelected = requested.selectedModels !== null &&
				known.size > 0 && requested.selectedModels.length === known.size;
			const selectedModels = allSelected ? null : requested.selectedModels;
			if (JSON.stringify(selectedModels) !== JSON.stringify(previous.selectedModels)) {
				await this.applyModelSelection(selectedModels);
			}
			const next = { ...requested, selectedModels };
			this.preferencesState = next;
			if (selectedModels === null) await this.refreshAvailableModels();
			await this.writePreferences(this.preferencesState);
			for (const listener of this.preferenceListeners ?? []) {
				try { listener(this.preferences(), previousPublic); } catch {}
			}
			return this.preferences();
		});
	}

	/**
	 * Return a valid access token, refreshing and persisting when near expiry.
	 * @param signal - optional caller cancellation for the refresh request.
	 * @returns the access token, or `undefined` when not logged in.
	 */
	async credential(signal) {
		const access = await this.bearerToken(signal);
		if (access === undefined) return undefined;
		const current = await readCredential(this.spec.filename);
		return current === undefined ? undefined : { ...current, access };
	}

	async bearerToken(signal) {
		return withFileLock(this.spec.filename, async () => {
			const current = await readCredential(this.spec.filename);
			if (current === undefined) return undefined;
			if (current.expires > Date.now() + REFRESH_MARGIN_MS) return current.access;
			const next = await this.tokenRequest(
				new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: current.refresh,
					client_id: DEFAULT_CLIENT_ID,
				}),
				signal,
			);
			const stored = {
				...next,
				refresh: next.refresh || current.refresh,
				accountId: next.accountId || current.accountId,
			};
			await this.write(stored);
			await this.ctx.credentials.set(TOKEN_REF, stored.access);
			return stored.access;
		});
	}

	/**
	 * Begin a browser login.
	 * @returns `{ url, completion }` — the authorize URL and a promise that
	 *   resolves after the callback completes the exchange.
	 */
	beginBrowserLogin() {
		if (this.loginFlow !== undefined) return this.loginFlow;
		const verifier = base64Url(randomBytes(32));
		const challenge = pkceChallenge(verifier);
		const state = randomBytes(16).toString("hex");
		const url = new URL(this.spec.authorizeUrl);
		for (const [key, value] of Object.entries({
			response_type: "code",
			client_id: DEFAULT_CLIENT_ID,
			redirect_uri: this.spec.redirectUri,
			scope: "openid profile email offline_access",
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "deepseek-harness",
		})) {
			url.searchParams.set(key, value);
		}
		const abort = new AbortController();
		const code = waitForBrowserCallback(this.spec.redirectUri, state, this.spec.redirectPort, abort.signal);
		const completion = code
			.then((authorizationCode) =>
				this.finishLogin(authorizationCode, verifier, abort.signal, this.spec.redirectUri),
			)
			.catch((error) => {
				this.lastLoginError = error instanceof Error ? error.message : String(error);
			})
			.finally(() => {
				this.loginFlow = undefined;
			});
		const flow = { url: url.toString(), completion, abort };
		this.loginFlow = flow;
		return flow;
	}

	/**
	 * Begin a device-code login.
	 * @param signal - optional caller cancellation.
	 * @returns `{ userCode, url, completion }` — the code to enter, the page to
	 *   open, and a promise that resolves once the poll completes the login.
	 */
	async beginDeviceLogin(signal) {
		const usercode = await fetch(this.spec.deviceCodeUrl, {
			method: "POST",
			headers: { "content-type": "application/json", "user-agent": "deepseek-harness" },
			body: JSON.stringify({ client_id: DEFAULT_CLIENT_ID }),
			...(signal === undefined ? {} : { signal }),
		});
		if (!usercode.ok) {
			throw new Error(`OpenAI device-auth initiation failed (HTTP ${usercode.status})`);
		}
		const init = await usercode.json();
		const userCode = init.user_code;
		const interval = Math.max(parseInt(init.interval, 10) || 5, 1) * 1000;
		if (typeof userCode !== "string" || typeof init.device_auth_id !== "string") {
			throw new Error("OpenAI device-auth response is incomplete");
		}
		const completion = (async () => {
			for (;;) {
				if (signal?.aborted) throw new Error("OpenAI login cancelled");
				const poll = await fetch(this.spec.deviceTokenUrl, {
					method: "POST",
					headers: { "content-type": "application/json", "user-agent": "deepseek-harness" },
					body: JSON.stringify({
						device_auth_id: init.device_auth_id,
						user_code: userCode,
					}),
					...(signal === undefined ? {} : { signal }),
				});
				if (poll.ok) {
					const data = await poll.json();
					if (typeof data.authorization_code !== "string" || typeof data.code_verifier !== "string") {
						throw new Error("OpenAI device-auth token response is incomplete");
					}
					await this.finishLogin(data.authorization_code, data.code_verifier, signal, this.spec.deviceRedirectUri);
					return;
				}
				if (poll.status !== 403 && poll.status !== 404) {
					throw new Error(`OpenAI device-auth polling failed (HTTP ${poll.status})`);
				}
				await new Promise((resolve) => setTimeout(resolve, interval));
			}
		})().catch((error) => {
			// The caller (control /start-device) has already responded with the
			// user code, so a later polling failure is reported via status().
			this.lastLoginError = error instanceof Error ? error.message : String(error);
		});
		this.lastLoginError = undefined;
		return { userCode, url: this.spec.deviceAuthUrl, completion };
	}

	/**
	 * Exchange an authorization code for tokens, persist, and inject.
	 * @param authorizationCode - the OAuth authorization code.
	 * @param verifier - the PKCE verifier used to request the code.
	 * @param signal - optional caller cancellation.
	 * @param redirectUri - the redirect URI the code was minted for.
	 */
	async finishLogin(authorizationCode, verifier, signal, redirectUri) {
		const credential = await this.tokenRequest(
			new URLSearchParams({
				grant_type: "authorization_code",
				client_id: DEFAULT_CLIENT_ID,
				code: authorizationCode,
				code_verifier: verifier,
				redirect_uri: redirectUri,
			}),
			signal,
		);
		if (!credential.refresh) {
			throw new Error("OpenAI token response is missing refresh_token");
		}
		await withFileLock(this.spec.filename, () => this.write(credential));
		await this.ctx.credentials.set(TOKEN_REF, credential.access);
		this.usageCache = undefined;
		this.usageError = undefined;
		this.lastLoginError = undefined;
	}

	/** Delete the credential and clear the injected token. */
	async logout() {
		await withFileLock(this.spec.filename, async () => {
			try {
				await unlink(this.spec.filename);
			} catch (error) {
				if (error?.code !== "ENOENT") throw error;
			}
		});
		await this.ctx.credentials.unset(TOKEN_REF);
		this.usageCache = undefined;
		this.usageError = undefined;
	}

	/**
	 * Read login status and (when logged in) cached ChatGPT Codex usage.
	 * @param refresh - force a usage refresh.
	 * @returns the status document for the control endpoint.
	 */
	async status(refresh) {
		const credential = await readCredential(this.spec.filename);
		if (credential === undefined) {
			return {
				loggedIn: false,
				loginPending: this.loginFlow !== undefined,
				loginError: this.lastLoginError,
				preferences: this.preferences(),
				csrf: this.csrf,
			};
		}
		try {
			await this.bearerToken();
		} catch (error) {
			this.usageError = error instanceof Error ? error.message : String(error);
		}
		if (refresh || this.usageCache === undefined || Date.now() - this.usageCache.fetchedAt > USAGE_CACHE_MS) {
			try {
				this.usageCache = await this.fetchUsage(credential);
				this.usageError = undefined;
			} catch (error) {
				this.usageError = error instanceof Error ? error.message : String(error);
			}
		}
		return {
			loggedIn: true,
			loginPending: this.loginFlow !== undefined,
			accountId: credential.accountId,
			expiresAt: credential.expires,
			usage: this.usageCache,
			usageError: this.usageError,
			preferences: this.preferences(),
			csrf: this.csrf,
		};
	}

	/**
	 * Query the ChatGPT Codex usage endpoint.
	 * @param credential - the current credential.
	 * @returns normalized usage.
	 */
	async fetchUsage(credential) {
		const access = await this.bearerToken();
		if (access === undefined) throw new Error("OpenAI login is missing");
		const response = await fetch(this.spec.usageUrl, {
			signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
			headers: {
				accept: "application/json",
				authorization: `Bearer ${access}`,
				"chatgpt-account-id": credential.accountId,
				"user-agent": "deepseek-harness-codex-oauth/0.1",
			},
		});
		if (!response.ok) {
			throw new Error(`Codex usage request failed (HTTP ${response.status})`);
		}
		return normalizeUsage(await response.json());
	}

	/**
	 * POST the OAuth token endpoint and normalize the response.
	 * @param body - URLSearchParams request body.
	 * @param signal - optional caller cancellation.
	 * @returns `{ access, refresh, expires, accountId }`.
	 */
	async tokenRequest(body, signal) {
		const response = await fetch(this.spec.tokenUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
			...(signal === undefined ? {} : { signal }),
		});
		if (!response.ok) {
			throw new Error(`OpenAI token request failed (HTTP ${response.status}): ${await response.text()}`);
		}
		const value = await response.json();
		if (typeof value.access_token !== "string" || value.access_token.length === 0) {
			throw new Error("OpenAI token response is missing access_token");
		}
		const refresh = typeof value.refresh_token === "string" ? value.refresh_token : undefined;
		const expiresIn = typeof value.expires_in === "number" ? value.expires_in : 3600;
		const accountId = extractAccountId(value.access_token, value.id_token);
		return {
			access: value.access_token,
			refresh: refresh ?? "",
			expires: Date.now() + expiresIn * 1000,
			accountId: accountId ?? "",
		};
	}

	/**
	 * Persist the credential atomically with owner-only permissions.
	 * @param credential - the credential document to write.
	 */
	write(credential) {
		return writeFileAtomic(
			this.spec.filename,
			`${JSON.stringify({ version: 1, credential }, null, 2)}\n`,
			{ mode: 0o600, dirMode: 0o700 },
		);
	}

	// -----------------------------------------------------------------------
	// 127.0.0.1 control server (login trigger + status + logout)
	// -----------------------------------------------------------------------

	/** Start the control server; resolves to its disposer. */
	startControlServer() {
		return new Promise((resolveStart, rejectStart) => {
			const server = createServer((request, response) => {
				void this.controlRequest(request, response);
			});
			server.once("error", rejectStart);
			server.listen(this.spec.controlPort, "127.0.0.1", () => {
				server.removeListener("error", rejectStart);
				resolveStart(() => {
					this.loginFlow?.abort.abort();
					server.close();
				});
			});
		});
	}

	async controlRequest(request, response) {
		const origin = request.headers.origin;
		const localOrigin = isLocalOrigin(origin);
		const headers = {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
			vary: "Origin",
			...(localOrigin ? { "access-control-allow-origin": origin } : {}),
		};
		const send = (status, value) => {
			response.writeHead(status, headers).end(JSON.stringify(value));
		};
		try {
			const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.spec.controlPort}`);
			if (request.method === "OPTIONS" && localOrigin) {
				response.writeHead(204, {
					...headers,
					"access-control-allow-methods": "GET, POST, OPTIONS",
					"access-control-allow-headers": "content-type, x-dsh-csrf",
				}).end();
				return;
			}
			// Login triggers work even without a browser origin (CLI/curl use).
			if (url.pathname === "/start" && request.method === "GET") {
				const flow = this.beginBrowserLogin();
				response.writeHead(302, { location: flow.url, "cache-control": "no-store" }).end();
				return;
			}
			if (url.pathname === "/start-device" && request.method === "GET") {
				const flow = await this.beginDeviceLogin();
				response.writeHead(200, headers).end(
					JSON.stringify({ url: flow.url, userCode: flow.userCode }),
				);
				return;
			}
			if (!localOrigin) {
				send(403, { error: "This endpoint only accepts a local DSH Web origin." });
				return;
			}
			if (url.pathname === "/status" && request.method === "GET") {
				send(200, await this.status(url.searchParams.get("refresh") === "1"));
				return;
			}
			if (url.pathname === "/logout" && request.method === "POST") {
				if (request.headers["x-dsh-csrf"] !== this.csrf) {
					send(403, { error: "Invalid CSRF token." });
					return;
				}
				await this.logout();
				send(200, { ok: true });
				return;
			}
			if (url.pathname === "/preferences" && request.method === "POST") {
				if (request.headers["x-dsh-csrf"] !== this.csrf) {
					send(403, { error: "Invalid CSRF token." });
					return;
				}
				const preferences = await this.updatePreferences(await readJsonRequest(request));
				send(200, { ok: true, preferences });
				return;
			}
			send(404, { error: "Not found" });
		} catch (error) {
			send(500, { error: error instanceof Error ? error.message : String(error) });
		}
	}
}

/**
 * One-shot local browser OAuth callback server, guarded by `state`.
 * @param redirectUri - the redirect URI for URL resolution.
 * @param state - the expected OAuth state value.
 * @param port - the loopback port to listen on.
 * @param signal - optional cancellation.
 * @returns the authorization code once the callback arrives.
 */
function waitForBrowserCallback(redirectUri, state, port, signal) {
	return new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		const server = createServer((request, response) => {
			const url = new URL(request.url ?? "", redirectUri);
			if (url.pathname !== "/auth/callback" || url.searchParams.get("state") !== state) {
				response.writeHead(400).end("Invalid OpenAI OAuth callback.");
				return;
			}
			const code = url.searchParams.get("code");
			if (code === null) {
				response.writeHead(400).end("Missing authorization code.");
				return;
			}
			response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
				.end("OpenAI login complete. You may close this window.");
			settled = true;
			signal?.removeEventListener("abort", abort);
			server.close();
			resolvePromise(code);
		});
		const abort = () => {
			if (settled) return;
			settled = true;
			server.close();
			rejectPromise(new Error("OpenAI login cancelled"));
		};
		signal?.addEventListener("abort", abort, { once: true });
		server.listen(port, "127.0.0.1").on("error", (error) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			rejectPromise(error);
		});
	});
}

export default OpenAICodexAuth;
export { Config, extractAccountId, normalizeUsage, resolveSpec };
