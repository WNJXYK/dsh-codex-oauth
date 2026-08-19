/**
 * Smoke test for dsh-codex-oauth.
 *
 * Spins up a mock OAuth issuer (token + device + usage endpoints), then
 * drives the service's core methods (constructed via Object.create to avoid
 * the Cordis Service constructor): authorization-code login, refresh, device
 * flow, usage, logout, and account-id extraction. Run:
 *
 *   node scripts/smoke.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const hostPackages = [
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-atomic-write",
	"@deepseek-ai/dsh-attachment",
	"@deepseek-ai/dsh-credentials",
	"@deepseek-ai/dsh-home-paths",
	"@deepseek-ai/dsh-tools",
];
for (const name of hostPackages) {
	assert.equal(packageJson.dependencies?.[name], undefined);
	assert.equal(typeof packageJson.devDependencies?.[name], "string");
}

// ---------------------------------------------------------------------------
// Mock OAuth issuer + usage server
// ---------------------------------------------------------------------------
let devicePollCount = 0;
const seen = [];
const sockets = new Set();
const server = http.createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", () => {
		const url = new URL(req.url, "http://127.0.0.1");
		const bodyText = Buffer.concat(chunks).toString("utf8");
		const params = new URLSearchParams(bodyText);
		if (url.pathname === "/oauth/token") {
			seen.push({ kind: "token", grant: params.get("grant_type") });
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					access_token: makeJwt("acct-1"),
					refresh_token: "rt-1",
					expires_in: 3600,
					scope: "openid",
				}),
			);
			return;
		}
		if (url.pathname === "/api/accounts/deviceauth/usercode") {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ device_auth_id: "dev-1", user_code: "ABCD-1234", interval: "1" }));
			return;
		}
		if (url.pathname === "/api/accounts/deviceauth/token") {
			devicePollCount += 1;
			if (devicePollCount === 1) {
				res.statusCode = 403;
				res.end("{}");
				return;
			}
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ authorization_code: "auth-code-1", code_verifier: "verifier-1" }));
			return;
		}
		if (url.pathname === "/wham/usage") {
			seen.push({ kind: "usage", auth: req.headers.authorization, account: req.headers["chatgpt-account-id"] });
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					plan_type: "pro",
					rate_limit: {
						primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_at: 2000000000 },
						secondary_window: { used_percent: 10 },
					},
				}),
			);
			return;
		}
		res.statusCode = 404;
		res.end("{}");
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
server.on("connection", (socket) => {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));
});
const port = server.address().port;
const issuer = `http://127.0.0.1:${port}`;

function makeJwt(accountId) {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
	).toString("base64url");
	return `${header}.${payload}.sig`;
}

const { OpenAICodexAuth, extractAccountId, normalizeUsage, resolveSpec } = await import("../lib/index.js");
const { credentialRef } = await import("@deepseek-ai/dsh-credentials");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-codex-oauth-smoke-"));
const filename = path.join(home, "cred.json");

function makeService() {
	const calls = { set: [], unset: [], mutate: [] };
	const credentials = {
		async set(ref, value) {
			calls.set.push({ ref: String(ref), value });
		},
		async unset(ref) {
			calls.unset.push(String(ref));
		},
	};
	const svc = Object.create(OpenAICodexAuth.prototype);
	svc.spec = resolveSpec({
		path: filename,
		issuer,
		usageUrl: `${issuer}/wham/usage`,
		controlPort: 1456,
		redirectPort: 1455,
	});
	svc.csrf = "test-csrf";
	svc.usageCache = undefined;
	svc.usageError = undefined;
	svc.loginFlow = undefined;
	svc.lastLoginError = undefined;
	svc.ctx = {
		credentials,
		llm: {
			async listModels() {
				return [
					{ id: "gpt-5.4", name: "GPT-5.4" },
					{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
				];
			},
		},
		settings: {
			async mutate(ns, ops) {
				calls.mutate.push({ ns, ops });
			},
		},
	};
	svc.preferenceListeners = new Set();
	svc.calls = calls;
	return svc;
}

let passed = 0;
const ok = (label) => {
	passed += 1;
	console.log(`  ok - ${label}`);
};

// ---------------------------------------------------------------------------
// 1. account-id extraction
// ---------------------------------------------------------------------------
console.log("1. account-id extraction");
{
	assert.equal(extractAccountId(makeJwt("acct-123")), "acct-123");
	assert.equal(extractAccountId("a.b.c", makeJwt("acct-456")), "acct-456");
	assert.equal(extractAccountId("not-a-jwt"), undefined);
	ok("access-token claim and id-token fallback are parsed");
}

// ---------------------------------------------------------------------------
// 2. authorization-code login
// ---------------------------------------------------------------------------
console.log("2. authorization-code login");
{
	const svc = makeService();
	await svc.finishLogin("code-1", "verifier-1", undefined, svc.redirectUri);
	const doc = JSON.parse(fs.readFileSync(filename, "utf8"));
	assert.equal(doc.version, 1);
	assert.equal(doc.credential.accountId, "acct-1");
	assert.equal(doc.credential.refresh, "rt-1");
	assert.equal(doc.credential.access, makeJwt("acct-1"));
	assert.equal(svc.calls.set.length, 1);
	assert.equal(String(svc.calls.set[0].ref), "DSH_OPENAI_CODEX_TOKEN");
	assert.equal(svc.calls.set[0].value, makeJwt("acct-1"));
	ok("code exchange persists the credential and injects DSH_OPENAI_CODEX_TOKEN");
}

// ---------------------------------------------------------------------------
// 3. refresh on near-expiry
// ---------------------------------------------------------------------------
console.log("3. refresh on near-expiry");
{
	const svc = makeService();
	const expired = {
		version: 1,
		credential: { access: makeJwt("acct-old"), refresh: "rt-0", expires: Date.now() - 1000, accountId: "acct-1" },
	};
	fs.writeFileSync(filename, JSON.stringify(expired));
	const token = await svc.bearerToken();
	assert.equal(token, makeJwt("acct-1"));
	const doc = JSON.parse(fs.readFileSync(filename, "utf8"));
	assert.equal(doc.credential.refresh, "rt-1");
	assert.equal(svc.calls.set.length, 1);
	assert.equal(svc.calls.set[0].value, makeJwt("acct-1"));
	ok("expired token is refreshed and the new token is injected");
}

// ---------------------------------------------------------------------------
// 4. device-code login
// ---------------------------------------------------------------------------
console.log("4. device-code login");
{
	const svc = makeService();
	const flow = await svc.beginDeviceLogin();
	assert.equal(flow.userCode, "ABCD-1234");
	assert.match(flow.url, /codex\/device/);
	await flow.completion;
	const doc = JSON.parse(fs.readFileSync(filename, "utf8"));
	assert.equal(doc.credential.accountId, "acct-1");
	assert.equal(svc.calls.set.at(-1).value, makeJwt("acct-1"));
	ok("device-code flow polls once and completes the login");
}

// ---------------------------------------------------------------------------
// 5. usage
// ---------------------------------------------------------------------------
console.log("5. usage");
{
	const svc = makeService();
	fs.writeFileSync(
		filename,
		JSON.stringify({
			version: 1,
			credential: { access: makeJwt("acct-1"), refresh: "rt-1", expires: Date.now() + 3600_000, accountId: "acct-1" },
		}),
	);
	const usage = await svc.fetchUsage({
		access: makeJwt("acct-1"),
		refresh: "rt-1",
		expires: Date.now() + 3600_000,
		accountId: "acct-1",
	});
	assert.equal(usage.planType, "pro");
	assert.equal(usage.primary.usedPercent, 42);
	assert.equal(usage.primary.windowSeconds, 18000);
	const req = seen.find((s) => s.kind === "usage");
	assert.equal(req.account, "acct-1");
	assert.equal(req.auth, `Bearer ${makeJwt("acct-1")}`);
	ok("usage endpoint returns normalized windows with Bearer + account-id headers");
}

// ---------------------------------------------------------------------------
// 6. status + logout
// ---------------------------------------------------------------------------
console.log("6. status and logout");
{
	const svc = makeService();
	fs.rmSync(filename, { force: true });
	const statusBefore = await svc.status();
	assert.equal(statusBefore.loggedIn, false);
	assert.equal(statusBefore.csrf, "test-csrf");

	await svc.finishLogin("code-2", "verifier-2", undefined, svc.redirectUri);
	const statusAfter = await svc.status();
	assert.equal(statusAfter.loggedIn, true);
	assert.equal(statusAfter.accountId, "acct-1");
	assert.equal(statusAfter.usage.planType, "pro");

	await svc.logout();
	assert.equal(fs.existsSync(filename), false);
	assert.equal(svc.calls.unset.at(-1), "DSH_OPENAI_CODEX_TOKEN");
	const statusGone = await svc.status();
	assert.equal(statusGone.loggedIn, false);
	ok("status reports login state and logout clears the credential + token");
}

// ---------------------------------------------------------------------------
// 7. control server /start-device (headless trigger)
// ---------------------------------------------------------------------------
console.log("7. control server /start-device");
{
	const svc = makeService();
	fs.rmSync(filename, { force: true });
	const res = {
		status: 0,
		headers: {},
		body: "",
		writeHead(status, headers) {
			this.status = status;
			Object.assign(this.headers, headers);
			return this;
		},
		end(body) {
			this.body = body;
			return this;
		},
	};
	await svc.controlRequest({ method: "GET", url: "/start-device", headers: {} }, res);
	assert.equal(res.status, 200);
	const payload = JSON.parse(res.body);
	assert.equal(payload.userCode, "ABCD-1234");
	assert.match(payload.url, /codex\/device/);
	// The background poll completes the login (mock answers 200 on second poll).
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(JSON.parse(fs.readFileSync(filename, "utf8")).credential.accountId, "acct-1");
	assert.equal(svc.calls.set.at(-1).value, makeJwt("acct-1"));
ok("/start-device returns the user code and completes the login in the background");
}

// ---------------------------------------------------------------------------
// 8. subscription preferences
// ---------------------------------------------------------------------------
console.log("8. subscription preferences");
{
	const svc = makeService();
	svc.preferencesState = {
		searchEnabled: true,
		imageEnabled: true,
		selectedModels: null,
		availableModels: [
			{ id: "gpt-5.4", name: "GPT-5.4" },
			{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
		],
	};
	let changes = 0;
	svc.watchPreferences(() => { changes += 1; });
	const updated = await svc.updatePreferences({
		selectedModels: ["gpt-5.4"],
		searchEnabled: false,
		imageEnabled: false,
	});
	assert.deepEqual(updated.selectedModels, ["gpt-5.4"]);
	assert.equal(svc.featureEnabled("search"), false);
	assert.equal(svc.featureEnabled("image"), false);
	assert.deepEqual(svc.calls.mutate[0], {
		ns: "llm-pi-ai",
		ops: [{
			op: "set",
			path: ["providers", "openai-codex", "models"],
			value: [{ id: "gpt-5.4" }],
		}],
	});
	assert.equal(changes, 1);
	const stored = JSON.parse(fs.readFileSync(svc.spec.preferencesFilename, "utf8"));
	assert.equal(stored.preferences.searchEnabled, false);
	await svc.updatePreferences({ selectedModels: null });
	assert.deepEqual(svc.calls.mutate[1].ops, [{
		op: "unset",
		path: ["providers", "openai-codex", "models"],
	}]);
	ok("model visibility and hosted feature toggles persist and apply live");
}

// ---------------------------------------------------------------------------
console.log(`\nall ${passed} smoke checks passed`);
for (const socket of sockets) socket.destroy();
server.closeAllConnections?.();
server.close();
fs.rmSync(home, { recursive: true, force: true });
process.exit(0);
