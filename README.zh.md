# DSH-Codex-OAuth

[English](README.md) | 简体中文

> 只需一次 ChatGPT / Codex 登录，即可将 DeepSeek Harness 变成完整的 GPT 工作台：通过 OpenAI 订阅使用 GPT 模型、GPT 图片生成和 OpenAI 联网搜索，并可随时查看订阅额度。

## ✨ 核心亮点

- **🚀 直接使用订阅**：通过浏览器 OAuth 或设备码登录后，GPT 模型、图片生成、联网搜索和额度查询共用同一份订阅凭据。
- **🧩 融入原生体验**：GPT 模型直接进入模型选择器；搜索结果复用 DSH 原生来源卡片；生成图片保存为持久附件，并可在工具卡中预览、打开和下载。
- **🎛️ 订阅专用控制中心**：在同一面板中选择显示哪些 GPT 模型，实时开关图片生成和联网搜索，查看套餐、额度窗口与重置时间，也可刷新状态或退出登录。
- **🔑 支持多种授权方式**：本机环境可使用浏览器 PKCE 授权，SSH / 服务器等无头环境可使用设备码授权。
- **🛡️ Host 侧凭据管理**：Token 自动刷新，不会进入 Web 客户端，也不会写入 `settings.yaml`。
- **🌗 原生语言与主题适配**：插件面板、额度、状态和图片预览会跟随 DSH 的语言设置，以及浅色、深色或跟随系统外观。

## 能力一览

| 能力 | 插件提供的内容 |
| --- | --- |
| GPT 模型与看图 | 激活 DSH 内置的 `openai-codex` 提供方，将账号可用的 GPT 模型加入模型选择器。 |
| 图片生成 | 注册 `generate_image`；支持方形、横图、竖图及低/中/高质量；结果保存为 DSH 附件，可直接预览、打开和下载。 |
| 联网搜索 | 将 DSH 原生 `web_search` 路由到 GPT 托管搜索，并返回回答正文和结构化来源 URL。 |
| 订阅用量 | 展示套餐、剩余比例、重置时间，以及账号返回的全部额度窗口；存在时会自动识别 5 小时额度与每周额度。 |
| OAuth 登录与续期 | 支持浏览器 PKCE、无头设备码、Refresh Token 轮换、状态刷新与退出登录。 |
| DSH 原生集成 | 遵循 DSH 的原生设计与能力机制，支持实时挂载或卸载图片生成和联网搜索，无需重启。 |

## 安装

```sh
dsh plugin --profile web add -w @wnjxyk/dsh-codex-oauth@latest
```

安装后重启 Web profile，打开 DSH，然后按照下方“登录”步骤连接订阅。

## 登录

进入 **设置 → 模型 → OpenAI Codex 订阅**，展开**编辑**，选择以下任一方式。

### 浏览器登录

点击**浏览器登录**，或直接打开：

```text
http://127.0.0.1:1456/start
```

授权在 OpenAI 官方页面完成。回调会返回本机 `1455` 端口，成功后订阅面板将自动更新。

### 设备码登录

在 DSH 中点击**无头模式登录**，也可以直接从 DSH Host 获取设备码：

```sh
curl http://127.0.0.1:1456/start-device
# {"url":"https://auth.openai.com/codex/device","userCode":"XXXX-XXXX"}
```

在任意设备上打开返回的 URL 并输入 `userCode`。保持 DSH 运行，插件会持续轮询并自动完成登录。

## 使用方式

- **GPT 对话或看图**：在 DSH 模型选择器中选择 `openai-codex` 的 GPT 模型，然后开始对话或附加图片。
- **生成图片**：直接让模型生成、绘制或渲染图片；模型可调用 `generate_image`，结果会保存为 DSH 附件并显示在工具卡中。
- **联网搜索**：询问最新信息或要求给出来源；DSH 会调用原生 `web_search`，插件负责提供 GPT 搜索结果与引用。
- **管理可用能力**：在订阅面板中隐藏不常用的模型，或关闭图片生成和联网搜索。至少需要保留一个可见的 GPT 模型。

图片生成支持 `1024x1024`、`1536x1024` 和 `1024x1536`；质量可选 `low`、`medium` 或 `high`，背景可选 `auto` 或 `opaque`。

## 工作原理

```text
OpenAI OAuth（浏览器 PKCE / 设备码）
  └─ DSH Host：$DSH_HOME/codex-oauth.json
       ├─ 自动刷新凭据并注入内置 openai-codex 模型提供方
       ├─ 调用托管 GPT Image，通过 DSH 附件服务保存结果
       ├─ 调用托管 GPT 联网搜索，将引用映射为 DSH 来源
       └─ 查询订阅用量，供中英文设置面板展示

DSH Web 客户端
  └─ 只接收状态、偏好、额度和附件引用，不接触 Token
```

## 配置

通常不需要任何配置。包内默认值如下：

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `path` | `$DSH_HOME/codex-oauth.json` | Host 侧 OAuth 凭据文件。 |
| `preferencesPath` | `$DSH_HOME/codex-oauth-preferences.json` | 模型显示范围和功能开关；覆盖 `path` 后，默认与其保存在同一目录。 |
| `issuer` | `https://auth.openai.com` | OAuth 签发方；仅在使用网关或测试时覆盖。 |
| `usageUrl` | `https://chatgpt.com/backend-api/wham/usage` | 订阅用量端点。 |
| `controlPort` | `1456` | 本机登录与状态服务端口。 |
| `redirectPort` | `1455` | 浏览器 OAuth 本机回调端口。 |
| 搜索 `model` | `gpt-5.4` | 托管联网搜索使用的模型。 |

Cordis 条目覆盖示例：

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

图片工具当前固定使用 `gpt-5.4`。聊天模型不会由本插件硬编码，而是从 DSH 内置提供方动态发现。

## 本机状态端点

登录后，设置面板每分钟自动更新用量。排查问题时，`/status` 只接受本机浏览器 Origin：

```sh
curl -H "Origin: http://127.0.0.1:3080" \
  http://127.0.0.1:1456/status
```

返回内容包括登录状态、账号 ID、Token 过期时间、标准化额度窗口、功能偏好和用量错误。修改状态的端点需要当前会话的 CSRF Token。

## 卸载

建议先在 **设置 → 模型 → OpenAI Codex 订阅**中退出登录，以删除 Host 侧保存的 OAuth 凭据。然后卸载插件：

```sh
dsh plugin --profile web remove -w @wnjxyk/dsh-codex-oauth
```

如果 Web profile 正在运行，请在卸载后重启它并刷新 DSH 页面，使模型提供方、图片工具和联网搜索提供方完全卸载。

卸载插件不会删除偏好文件 `codex-oauth-preferences.json` 或历史生成图片等 DSH 附件。如果卸载前没有退出登录，OAuth 凭据文件 `codex-oauth.json` 也会保留。需要彻底清理时，请在停止 DSH 后手动删除“配置”一节列出的对应文件；如曾自定义路径，请以实际配置为准。

## 安全边界

- 浏览器授权使用 PKCE 和随机 `state`；设备登录使用 OpenAI 设备授权流程。
- Access Token 和 Refresh Token 只保存在 Host 侧，并通过原子写入和文件锁持久化；在支持 POSIX 权限的平台上会使用 `0600` 模式。
- 控制服务与回调服务只监听 `127.0.0.1`。
- Web 页面可见的状态和偏好响应不会包含 Access Token 或 Refresh Token。
- 退出登录和偏好写入均有 CSRF 防护；控制响应禁止缓存，并限制为本机 Web Origin。

这是一个独立实现：它不会读取 `~/.codex/auth.json`，不会调用 Codex CLI，也不要求 OpenAI Platform API Key。

许可证：MIT
