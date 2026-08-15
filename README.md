# DSH-Codex-OAuth

English | [简体中文](README.zh.md)

> One ChatGPT / Codex sign-in turns DeepSeek Harness into a complete GPT workspace: use GPT models, GPT Image generation, and OpenAI web search through your OpenAI subscription, with subscription quota always within reach.

## ✨ Highlights

- **🚀 Use your subscription directly** — after signing in through browser OAuth or a device code, GPT models, image generation, web search, and quota reporting share the same subscription credential.
- **🧩 Native DSH experience** — GPT models appear directly in the model picker; search results reuse DSH's native source card; generated images are stored as durable attachments with preview, open, and download actions in the tool card.
- **🎛️ Subscription control center** — choose which GPT models are visible, switch image generation and web search on or off live, inspect plan and quota windows, view reset times, refresh status, or sign out from one panel.
- **🔑 Multiple authorization flows** — use browser-based PKCE authorization on a local machine or device-code authorization on headless SSH and server environments.
- **🛡️ Host-side credential management** — tokens refresh automatically and are never exposed to the web client or written to `settings.yaml`.
- **🌗 Native language and theme support** — plugin panels, quota, status, and image previews follow DSH's language setting and its Light, Dark, or System appearance.

## Capabilities

| Capability | What the plugin adds |
| --- | --- |
| GPT models and vision | Activates DSH's built-in `openai-codex` provider and adds the account's available GPT models to the model picker. |
| Image generation | Registers `generate_image` with square, landscape, and portrait output plus low/medium/high quality; results are saved as DSH attachments with preview, open, and download actions. |
| Web search | Routes DSH's native `web_search` through hosted GPT search and returns answer text with structured source URLs. |
| Subscription usage | Shows the plan, remaining percentage, reset time, and every quota window returned by the account, automatically identifying 5-hour and weekly windows when present. |
| OAuth sign-in and renewal | Supports browser PKCE, headless device codes, refresh-token rotation, status refresh, and sign-out. |
| Native DSH integration | Follows DSH's design and capability model, mounting or unmounting image generation and web search live without a restart. |

## Install

```sh
dsh plugin --profile web add -w @wnjxyk/dsh-codex-oauth@latest
```

Restart the Web profile after installation, then open DSH and continue with **Sign in** below.

## Sign in

Open **Settings → Models → OpenAI Codex subscription**, expand **Edit**, and choose either flow below.

### Browser sign-in

Click **Browser sign in**, or open:

```text
http://127.0.0.1:1456/start
```

Authorization takes place on OpenAI's official site. The callback returns to local port `1455`, and the subscription panel updates automatically after sign-in succeeds.

### Device-code sign-in

Click **Headless sign in** in DSH, or request a device code directly from the DSH host:

```sh
curl http://127.0.0.1:1456/start-device
# {"url":"https://auth.openai.com/codex/device","userCode":"XXXX-XXXX"}
```

Open the returned URL on any device and enter `userCode`. Keep DSH running while the plugin polls and completes sign-in automatically.

## Usage

- **Chat with GPT or inspect images:** select an `openai-codex` GPT model in the DSH model picker, then start a conversation or attach an image.
- **Generate an image:** ask the model to generate, draw, or render an image. It can call `generate_image`; the result is saved as a DSH attachment and displayed in the tool card.
- **Search the web:** ask for current information or request sources. DSH calls its native `web_search`, while the plugin supplies GPT search results and citations.
- **Manage available capabilities:** hide models you do not use or disable image generation and web search from the subscription panel. At least one GPT model must remain visible.

Image generation supports `1024x1024`, `1536x1024`, and `1024x1536`; quality can be `low`, `medium`, or `high`, and the background can be `auto` or `opaque`.

## How it works

```text
OpenAI OAuth (browser PKCE or device code)
  └─ DSH host: $DSH_HOME/codex-oauth.json
       ├─ refresh credentials automatically and inject them into the built-in openai-codex provider
       ├─ call hosted GPT Image and save results through DSH attachments
       ├─ call hosted GPT web search and map citations to DSH sources
       └─ fetch subscription usage for the bilingual settings panel

DSH web client
  └─ receives status, preferences, quota, and attachment references—never tokens
```

## Configuration

No configuration is normally required. The bundled defaults are:

| Option | Default | Purpose |
| --- | --- | --- |
| `path` | `$DSH_HOME/codex-oauth.json` | Host-side OAuth credential file. |
| `preferencesPath` | `$DSH_HOME/codex-oauth-preferences.json` | Model visibility and feature toggles. If `path` is overridden, this defaults to the same directory. |
| `issuer` | `https://auth.openai.com` | OAuth issuer; override only when using a gateway or running tests. |
| `usageUrl` | `https://chatgpt.com/backend-api/wham/usage` | Subscription usage endpoint. |
| `controlPort` | `1456` | Loopback login and status service. |
| `redirectPort` | `1455` | Loopback browser OAuth callback. |
| Search `model` | `gpt-5.4` | Model used by hosted web search. |

Example Cordis entry overrides:

```yaml
- insert:
    - id: dsh-codex-oauth
      name: "@wnjxyk/dsh-codex-oauth"
      config:
        path: /secure/codex-oauth.json
        preferencesPath: /secure/codex-oauth-preferences.json
        controlPort: 1456
        redirectPort: 1455

    - id: codex-web-search
      name: "@wnjxyk/dsh-codex-oauth/web-search"
      config:
        model: gpt-5.4
```

The image tool currently uses `gpt-5.4`. Chat models are discovered dynamically from DSH's built-in provider rather than hard-coded by this plugin.

## Local status endpoint

After sign-in, the settings panel refreshes usage every minute. For diagnostics, `/status` accepts only a local browser origin:

```sh
curl -H "Origin: http://127.0.0.1:3080" \
  http://127.0.0.1:1456/status
```

The response includes login state, account ID, token expiry, normalized quota windows, feature preferences, and any usage error. State-changing endpoints require the current session's CSRF token.

## Uninstall

Before uninstalling, sign out from **Settings → Models → OpenAI Codex subscription** to remove the OAuth credential stored on the DSH host. Then remove the plugin:

```sh
dsh plugin --profile web remove -w @wnjxyk/dsh-codex-oauth
```

If the Web profile is running, restart it after removal and refresh the DSH page so the model provider, image tool, and web-search provider are fully unloaded.

Removing the plugin does not delete `codex-oauth-preferences.json` or DSH attachments such as previously generated images. If you do not sign out first, `codex-oauth.json` also remains on disk. For a complete cleanup, stop DSH and manually remove the corresponding files listed under **Configuration**; use the actual locations if you configured custom paths.

## Security boundaries

- Browser authorization uses PKCE and a random `state`; device sign-in uses OpenAI's device authorization flow.
- Access and refresh tokens stay on the host and are persisted with atomic writes and a file lock; mode `0600` is used on platforms that support POSIX permissions.
- The control and callback services listen only on `127.0.0.1`.
- Browser-visible status and preference responses never contain access or refresh tokens.
- Sign-out and preference writes are CSRF-protected; control responses are non-cacheable and restricted to local web origins.

This is an independent implementation. It does not read `~/.codex/auth.json`, invoke the Codex CLI, or require an OpenAI Platform API key.

License: MIT
