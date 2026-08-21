window.__ModuleLoader__.load({
  id: "@wnjxyk/dsh-codex-oauth",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const CONTROL = "http://127.0.0.1:1456";
    const NS = "dsh-codex-oauth";
    const dictionaries = {
      zh: { title: "OpenAI Codex 订阅", signedOut: "尚未登录", signedIn: "已连接 ChatGPT 订阅，GPT 模型、看图、图片生成和联网搜索均可用", pending: "等待 OpenAI 授权", edit: "编辑", collapse: "收起", browser: "浏览器登录", device: "无头模式登录", refresh: "刷新状态与额度", logout: "退出登录", open: "打开授权页面", code: "设备码", waiting: "授权完成后会自动更新状态。", error: "无法连接 Codex OAuth 服务", quotaTitle: "Codex 剩余额度", quotaRemaining: "剩余", quotaReset: "重置", quotaWeekly: "每周额度", quotaFiveHour: "5 小时额度", quotaPrimary: "主要额度", quotaSecondary: "次级额度", quotaUnavailable: "暂时无法读取额度", featuresTitle: "订阅功能", searchTitle: "联网搜索", searchHint: "允许 DSH 使用 GPT 搜索公开网页", imageToggleTitle: "图片生成", imageToggleHint: "向模型提供 GPT 图片生成工具", modelsTitle: "显示的 GPT 模型", modelsHint: "勾选后才会出现在 DSH 模型选择器中", modelRequired: "至少需要保留一个 GPT 模型", saving: "正在保存…", imageTitle: "GPT 图片生成", imageRunning: "正在生成图片…", imageLoading: "正在加载预览…", imageReady: "图片已生成", imageFailed: "图片生成失败", imageLoadFailed: "图片已生成，但预览加载失败", imageOpen: "打开原图", imageDownload: "下载图片", imageInspect: "查看调用详情", imageRetry: "重试加载", imagePrompt: "提示词", dateLocale: "zh-CN" },
      en: { title: "OpenAI Codex subscription", signedOut: "Not signed in", signedIn: "ChatGPT subscription connected for GPT models, vision, image generation, and web search", pending: "Waiting for OpenAI authorization", edit: "Edit", collapse: "Collapse", browser: "Browser sign in", device: "Headless sign in", refresh: "Refresh status and quota", logout: "Sign out", open: "Open authorization page", code: "Device code", waiting: "Status updates automatically after authorization.", error: "Cannot reach the Codex OAuth service", quotaTitle: "Codex quota remaining", quotaRemaining: "Remaining", quotaReset: "Resets", quotaWeekly: "Weekly quota", quotaFiveHour: "5-hour quota", quotaPrimary: "Primary quota", quotaSecondary: "Secondary quota", quotaUnavailable: "Quota is temporarily unavailable", featuresTitle: "Subscription features", searchTitle: "Web search", searchHint: "Allow DSH to search the public web with GPT", imageToggleTitle: "Image generation", imageToggleHint: "Expose the GPT image-generation tool to models", modelsTitle: "Visible GPT models", modelsHint: "Only checked models appear in the DSH model picker", modelRequired: "Keep at least one GPT model visible", saving: "Saving…", imageTitle: "GPT image generation", imageRunning: "Generating image…", imageLoading: "Loading preview…", imageReady: "Image generated", imageFailed: "Image generation failed", imageLoadFailed: "The image was generated, but its preview could not be loaded", imageOpen: "Open full image", imageDownload: "Download image", imageInspect: "Inspect tool call", imageRetry: "Retry preview", imagePrompt: "Prompt", dateLocale: "en-US" },
    };
    async function request(path, options = {}) {
      const response = await fetch(CONTROL + path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || response.statusText);
      return body;
    }
    function remainingPercent(windowUsage) {
      const used = Number(windowUsage && windowUsage.usedPercent);
      return Number.isFinite(used) ? Math.max(0, Math.min(100, Math.round(100 - used))) : 0;
    }
    function usageWindowLabel(windowUsage, fallback, t) {
      const seconds = Number(windowUsage && windowUsage.windowSeconds);
      if (Number.isFinite(seconds) && seconds >= 6.5 * 86400 && seconds <= 7.5 * 86400) return t("quotaWeekly");
      if (Number.isFinite(seconds) && seconds >= 4.5 * 3600 && seconds <= 5.5 * 3600) return t("quotaFiveHour");
      return fallback;
    }
    function formatResetAt(resetAt, locale) {
      const value = Number(resetAt);
      if (!Number.isFinite(value) || value <= 0) return "";
      const milliseconds = value < 1e12 ? value * 1000 : value;
      return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(milliseconds));
    }
    function planLabel(planType) {
      if (typeof planType !== "string" || planType.trim() === "") return "";
      const normalized = planType.toLowerCase().replace(/[\s_-]+/g, "");
      if (normalized === "prolite") return "Pro Lite";
      if (normalized === "plus") return "Plus";
      if (normalized === "pro") return "Pro";
      if (normalized === "team") return "Team";
      return planType;
    }
    function QuotaMeter({ title, usage, t }) {
      const remaining = remainingPercent(usage);
      const reset = formatResetAt(usage && usage.resetAt, t("dateLocale"));
      const level = remaining <= 10 ? "is-low" : remaining <= 30 ? "is-warn" : "is-ok";
      return jsx.jsxs("div", { className: `codex-quota-meter ${level}`, children: [
        jsx.jsxs("div", { className: "codex-quota-row", children: [jsx.jsx("span", { children: title }), jsx.jsxs("strong", { children: [t("quotaRemaining"), " ", remaining, "%"] })] }),
        jsx.jsx("div", { className: "codex-quota-track", role: "progressbar", "aria-label": title, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": remaining, children: jsx.jsx("span", { style: { width: `${remaining}%` } }) }),
        reset && jsx.jsxs("small", { children: [t("quotaReset"), "：", reset] }),
      ] });
    }
    function CodexQuota({ status, t }) {
      if (!status.loggedIn) return null;
      const usage = status.usage;
      const windows = usage ? [
        usage.primary && { key: "primary", title: usageWindowLabel(usage.primary, t("quotaPrimary"), t), usage: usage.primary },
        usage.secondary && { key: "secondary", title: usageWindowLabel(usage.secondary, t("quotaSecondary"), t), usage: usage.secondary },
      ].filter(Boolean) : [];
      return jsx.jsxs("div", { className: "codex-quota", children: [
        jsx.jsxs("div", { className: "codex-quota-head", children: [jsx.jsx("strong", { children: t("quotaTitle") }), usage && jsx.jsx("span", { children: planLabel(usage.planType) })] }),
        windows.length > 0 ? jsx.jsx("div", { className: "codex-quota-grid", children: windows.map((window) => jsx.jsx(QuotaMeter, { title: window.title, usage: window.usage, t }, window.key)) }) : jsx.jsx("p", { className: "codex-quota-unavailable", children: t("quotaUnavailable") }),
      ] });
    }
    function selectedModelIds(preferences) {
      const models = Array.isArray(preferences && preferences.availableModels) ? preferences.availableModels : [];
      const available = models.map((model) => model.id);
      if (!Array.isArray(preferences && preferences.selectedModels)) return available;
      const selected = new Set(preferences.selectedModels);
      return available.filter((id) => selected.has(id));
    }
    function FeatureToggle({ checked, title, hint, disabled, onChange }) {
      return jsx.jsxs("label", { className: "codex-feature-row", children: [
        jsx.jsxs("span", { className: "codex-feature-copy", children: [jsx.jsx("strong", { children: title }), jsx.jsx("small", { children: hint })] }),
        jsx.jsxs("span", { className: "codex-switch", children: [jsx.jsx("input", { type: "checkbox", checked, disabled, onChange: (event) => onChange(event.target.checked) }), jsx.jsx("span", { "aria-hidden": "true" })] }),
      ] });
    }
    function CodexPreferences({ status, busy, update, setError, t }) {
      const preferences = status.preferences;
      if (!preferences) return null;
      const models = Array.isArray(preferences.availableModels) ? preferences.availableModels : [];
      const selected = selectedModelIds(preferences);
      const selectedSet = new Set(selected);
      function toggleModel(id, checked) {
        const next = new Set(selected);
        if (checked) next.add(id); else next.delete(id);
        if (next.size === 0) { setError(t("modelRequired")); return; }
        update({ selectedModels: models.map((model) => model.id).filter((modelId) => next.has(modelId)) });
      }
      return jsx.jsxs("div", { className: "codex-preferences-content", children: [
        jsx.jsxs("div", { className: "codex-feature-grid", children: [
          jsx.jsx(FeatureToggle, { checked: preferences.searchEnabled !== false, title: t("searchTitle"), hint: t("searchHint"), disabled: busy, onChange: (checked) => update({ searchEnabled: checked }) }),
          jsx.jsx(FeatureToggle, { checked: preferences.imageEnabled !== false, title: t("imageToggleTitle"), hint: t("imageToggleHint"), disabled: busy, onChange: (checked) => update({ imageEnabled: checked }) }),
        ] }),
        models.length > 0 && jsx.jsxs("fieldset", { className: "codex-models", disabled: busy, children: [
          jsx.jsx("legend", { children: t("modelsTitle") }),
          jsx.jsx("p", { children: t("modelsHint") }),
          jsx.jsx("div", { className: "codex-model-grid", children: models.map((model) => jsx.jsxs("label", { className: "codex-model-option", children: [jsx.jsx("input", { type: "checkbox", checked: selectedSet.has(model.id), onChange: (event) => toggleModel(model.id, event.target.checked) }), jsx.jsx("span", { children: model.name || model.id })] }, model.id)) }),
        ] }),
        busy && jsx.jsx("small", { className: "codex-saving", role: "status", children: t("saving") }),
      ] });
    }
    function CodexOAuthPanel({ t }) {
      const [status, setStatus] = React.useState({ loggedIn: false, loginPending: false });
      const [device, setDevice] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      const [expanded, setExpanded] = React.useState(false);
      const refresh = React.useCallback(async (force = false) => {
        try { const next = await request(force ? "/status?refresh=1" : "/status"); setStatus(next); setError(""); return next; }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); return null; }
      }, [t]);
      React.useEffect(() => { refresh(); }, [refresh]);
      React.useEffect(() => {
        if (!status.loginPending) return undefined;
        const timer = window.setInterval(refresh, 1500);
        return () => window.clearInterval(timer);
      }, [status.loginPending, refresh]);
      React.useEffect(() => {
        if (!status.loggedIn) return undefined;
        const timer = window.setInterval(() => refresh(false), 60000);
        return () => window.clearInterval(timer);
      }, [status.loggedIn, refresh]);
      function browserLogin() {
        window.open(CONTROL + "/start", "dsh-codex-oauth", "popup,width=680,height=780");
        setStatus((value) => ({ ...value, loginPending: true }));
      }
      async function deviceLogin() {
        setBusy(true); setError("");
        try { const next = await request("/start-device"); setDevice(next); setStatus((value) => ({ ...value, loginPending: true })); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); }
        finally { setBusy(false); }
      }
      async function logout() {
        setBusy(true);
        try { await request("/logout", { method: "POST", headers: { "x-dsh-csrf": status.csrf } }); setDevice(null); await refresh(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); }
        finally { setBusy(false); }
      }
      async function updatePreferences(patch) {
        setBusy(true); setError("");
        try {
          const result = await request("/preferences", { method: "POST", headers: { "x-dsh-csrf": status.csrf }, body: JSON.stringify(patch) });
          setStatus((value) => ({ ...value, preferences: result.preferences }));
        } catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); }
        finally { setBusy(false); }
      }
      const stateText = status.loggedIn ? t("signedIn") : status.loginPending ? t("pending") : t("signedOut");
      return jsx.jsxs("section", { className: "codex-oauth-panel", children: [
        jsx.jsxs("div", { className: "codex-oauth-head", children: [
          jsx.jsxs("div", { className: "codex-oauth-summary", children: [jsx.jsx("h3", { children: t("title") }), jsx.jsx("p", { className: status.loggedIn ? "is-connected" : "", role: "status", children: stateText })] }),
          jsx.jsx("span", { className: "codex-oauth-dot", "aria-hidden": "true" }),
        ] }),
        jsx.jsx(CodexQuota, { status, t }),
        jsx.jsxs("section", { className: "codex-preferences", children: [
          jsx.jsxs("div", { className: "codex-preferences-head", children: [
            jsx.jsx("strong", { className: "codex-preferences-title", children: t("featuresTitle") }),
            jsx.jsx("button", { type: "button", className: "codex-edit-button", onClick: () => setExpanded((value) => !value), "aria-expanded": expanded, "aria-controls": "codex-subscription-features", children: expanded ? t("collapse") : t("edit") }),
          ] }),
          expanded && jsx.jsxs("div", { id: "codex-subscription-features", className: "codex-preferences-details", children: [
            jsx.jsx(CodexPreferences, { status, busy, update: updatePreferences, setError, t }),
            jsx.jsxs("div", { className: "codex-oauth-actions", children: [
              !status.loggedIn && jsx.jsx("button", { type: "button", className: "primary", onClick: browserLogin, disabled: busy, children: t("browser") }),
              !status.loggedIn && jsx.jsx("button", { type: "button", onClick: deviceLogin, disabled: busy || status.loginPending, children: t("device") }),
              jsx.jsx("button", { type: "button", onClick: () => refresh(true), disabled: busy, title: t("refresh"), "aria-label": t("refresh"), children: "↻" }),
              status.loggedIn && jsx.jsx("button", { type: "button", onClick: logout, disabled: busy, children: t("logout") }),
            ] }),
            device && jsx.jsxs("div", { className: "codex-device", children: [jsx.jsxs("div", { children: [jsx.jsx("span", { children: t("code") }), jsx.jsx("strong", { children: device.userCode })] }), jsx.jsx("a", { href: device.url, target: "_blank", rel: "noreferrer", children: t("open") }), jsx.jsx("p", { children: t("waiting") })] }),
          ] }),
        ] }),
        error && jsx.jsx("p", { className: "codex-oauth-error", role: "alert", children: error }),
      ] });
    }
    function settledBlock(block) {
      return block && block.kind === "tool-result";
    }
    function imageAttachment(block) {
      if (!settledBlock(block) || !Array.isArray(block.content)) return null;
      const part = block.content.find((item) => item && item.type === "image" && item.attachment && typeof item.attachment.attachmentId === "string");
      return part ? part.attachment : null;
    }
    function imagePrompt(block) {
      const raw = settledBlock(block) ? block.call && block.call.argsRaw : block && block.argsRaw;
      if (typeof raw !== "string") return "";
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
      } catch {
        return "";
      }
    }
    function toolErrorText(block) {
      if (!settledBlock(block) || !Array.isArray(block.content)) return "";
      return block.content.filter((item) => item && item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n").trim();
    }
    function formatDimensions(attachment) {
      if (!attachment || !Number.isFinite(attachment.width) || !Number.isFinite(attachment.height)) return "";
      return `${attachment.width} × ${attachment.height}`;
    }
    function ImageGenerationPreview({ block, inspect, resolveImage, t }) {
      const attachment = imageAttachment(block);
      const attachmentId = attachment && attachment.attachmentId;
      const prompt = imagePrompt(block);
      const running = !settledBlock(block);
      const failed = settledBlock(block) && block.isError;
      const [previewUrl, setPreviewUrl] = React.useState("");
      const [previewError, setPreviewError] = React.useState("");
      const [retry, setRetry] = React.useState(0);
      const resolverRef = React.useRef(resolveImage);
      resolverRef.current = resolveImage;
      React.useEffect(() => {
        let active = true;
        setPreviewUrl("");
        setPreviewError("");
        if (!attachment || typeof resolverRef.current !== "function") return () => { active = false; };
        Promise.resolve(resolverRef.current(attachment)).then((url) => {
          if (active) setPreviewUrl(url);
        }).catch((cause) => {
          if (active) setPreviewError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => { active = false; };
      }, [attachmentId, retry]);
      const stateClass = failed || previewError ? "is-error" : previewUrl ? "is-ready" : "is-pending";
      const stateText = failed ? t("imageFailed") : previewError ? t("imageLoadFailed") : previewUrl ? t("imageReady") : attachment ? t("imageLoading") : t("imageRunning");
      const errorText = failed ? toolErrorText(block) : previewError;
      const dimensions = formatDimensions(attachment);
      return jsx.jsxs("section", { className: `codex-image-card ${stateClass}`, "aria-busy": running || Boolean(attachment && !previewUrl && !previewError), children: [
        jsx.jsxs("div", { className: "codex-image-head", children: [
          jsx.jsxs("div", { className: "codex-image-heading", children: [jsx.jsx("span", { className: "codex-image-icon", "aria-hidden": "true", children: "✦" }), jsx.jsxs("div", { children: [jsx.jsx("strong", { children: t("imageTitle") }), jsx.jsx("span", { role: "status", children: stateText })] })] }),
          jsx.jsx("span", { className: "codex-image-state", "aria-hidden": "true" }),
        ] }),
        prompt && jsx.jsxs("div", { className: "codex-image-prompt", children: [jsx.jsx("span", { children: t("imagePrompt") }), jsx.jsx("p", { children: prompt })] }),
        previewUrl && jsx.jsxs("div", { className: "codex-image-preview", children: [
          jsx.jsx("a", { href: previewUrl, target: "_blank", rel: "noreferrer", title: t("imageOpen"), children: jsx.jsx("img", { src: previewUrl, alt: prompt || t("imageTitle"), width: attachment.width, height: attachment.height }) }),
          jsx.jsxs("div", { className: "codex-image-meta", children: [jsx.jsx("span", { children: dimensions }), attachment.name && jsx.jsx("span", { children: attachment.name })] }),
        ] }),
        !previewUrl && !failed && !previewError && jsx.jsx("div", { className: "codex-image-skeleton", "aria-hidden": "true", children: jsx.jsx("span", {}) }),
        errorText && jsx.jsx("pre", { className: "codex-image-error", children: errorText }),
        jsx.jsxs("div", { className: "codex-image-links", children: [
          previewUrl && jsx.jsx("a", { href: previewUrl, target: "_blank", rel: "noreferrer", children: t("imageOpen") }),
          previewUrl && jsx.jsx("a", { href: previewUrl, download: attachment.name || "gpt-image.png", children: t("imageDownload") }),
          previewError && jsx.jsx("button", { type: "button", onClick: () => setRetry((value) => value + 1), children: t("imageRetry") }),
          inspect && jsx.jsx("button", { type: "button", onClick: inspect, children: t("imageInspect") }),
        ] }),
      ] });
    }
    const style = ".codex-oauth-panel{border:1px solid var(--border,#d7dce2);border-radius:8px;padding:16px;margin:14px 0 18px;background:var(--surface,#fff);color:var(--foreground,#1f2937)}.codex-oauth-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.codex-oauth-head h3{font-size:14px;line-height:20px;margin:0;font-weight:600;letter-spacing:0}.codex-oauth-head p{font-size:13px;line-height:18px;margin:2px 0 0;color:var(--muted-foreground,#667085)}.codex-oauth-head p.is-connected{color:#137a49}.codex-oauth-dot{width:9px;height:9px;border-radius:50%;background:#a5acb8;flex:0 0 auto}.codex-oauth-panel:has(.is-connected) .codex-oauth-dot{background:#1f9d63}.codex-quota{margin-top:14px;padding:12px;border:1px solid var(--border,#e1e5ea);border-radius:8px;background:var(--muted,#f7f8fa)}.codex-quota-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.codex-quota-head>strong{font-size:13px}.codex-quota-head>span{padding:2px 7px;border-radius:999px;background:var(--surface,#fff);color:var(--muted-foreground,#667085);font-size:11px}.codex-quota-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}.codex-quota-meter{padding:9px 10px;border-radius:7px;background:var(--surface,#fff)}.codex-quota-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px}.codex-quota-row>span{color:var(--muted-foreground,#667085)}.codex-quota-row>strong{font-size:13px}.codex-quota-track{height:6px;margin-top:7px;border-radius:999px;background:#e5e7eb;overflow:hidden}.codex-quota-track>span{display:block;height:100%;border-radius:inherit;background:#1f9d63;transition:width .25s ease}.codex-quota-meter.is-warn .codex-quota-track>span{background:#d97706}.codex-quota-meter.is-low .codex-quota-track>span{background:#d92d20}.codex-quota-meter small{display:block;margin-top:6px;color:var(--muted-foreground,#667085);font-size:10px}.codex-quota-unavailable{margin:0;color:var(--muted-foreground,#667085);font-size:12px}.codex-oauth-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.codex-oauth-actions button{min-height:32px;padding:5px 11px;border:1px solid var(--border,#cdd3db);border-radius:6px;background:var(--surface,#fff);color:inherit;font:inherit;font-size:13px;cursor:pointer}.codex-oauth-actions button.primary{background:#111827;color:#fff;border-color:#111827}.codex-oauth-actions button:disabled{opacity:.55;cursor:default}.codex-device{margin-top:12px;padding:12px;border-left:3px solid #3276d2;background:var(--muted,#f5f7fa);font-size:13px}.codex-device div{display:flex;align-items:center;gap:12px}.codex-device strong{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:17px;letter-spacing:0}.codex-device a{display:inline-block;margin-top:8px;color:#1769aa}.codex-device p{margin:6px 0 0;color:var(--muted-foreground,#667085)}.codex-oauth-error{margin:10px 0 0;color:#b42318;font-size:13px}.codex-image-card{width:min(100%,680px);margin:10px 0 14px;border:1px solid var(--border,#d7dce2);border-radius:12px;background:var(--surface,#fff);color:var(--foreground,#1f2937);overflow:hidden}.codex-image-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px}.codex-image-heading{display:flex;align-items:center;gap:10px;min-width:0}.codex-image-heading>div{display:flex;flex-direction:column;gap:1px;min-width:0}.codex-image-heading strong{font-size:13px;line-height:18px}.codex-image-heading span:not(.codex-image-icon){font-size:12px;line-height:17px;color:var(--muted-foreground,#667085)}.codex-image-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#eef2ff;color:#4f46e5;font-size:15px}.codex-image-state{width:8px;height:8px;border-radius:50%;background:#9aa2af;flex:0 0 auto}.codex-image-card.is-ready .codex-image-state{background:#1f9d63}.codex-image-card.is-error .codex-image-state{background:#d92d20}.codex-image-prompt{padding:0 14px 11px}.codex-image-prompt>span{display:block;margin-bottom:3px;color:var(--muted-foreground,#667085);font-size:11px}.codex-image-prompt p{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;margin:0;font-size:12px;line-height:18px}.codex-image-preview{border-top:1px solid var(--border,#e5e7eb);background:var(--muted,#f7f8fa)}.codex-image-preview>a{display:block;line-height:0}.codex-image-preview img{display:block;width:100%;height:auto;max-height:520px;object-fit:contain;background:linear-gradient(135deg,#f2f4f7,#fff)}.codex-image-meta{display:flex;justify-content:space-between;gap:12px;padding:7px 12px;color:var(--muted-foreground,#667085);font-size:11px}.codex-image-meta span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.codex-image-skeleton{position:relative;height:180px;border-top:1px solid var(--border,#e5e7eb);overflow:hidden;background:var(--muted,#f2f4f7)}.codex-image-skeleton span{position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.58),transparent);animation:codex-image-shimmer 1.4s infinite}.codex-image-error{max-height:120px;overflow:auto;margin:0;padding:10px 14px;border-top:1px solid #fecdca;background:#fff6f5;color:#b42318;white-space:pre-wrap;font:12px/18px ui-monospace,SFMono-Regular,Consolas,monospace}.codex-image-links{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;border-top:1px solid var(--border,#e5e7eb)}.codex-image-links:empty{display:none}.codex-image-links a,.codex-image-links button{padding:0;border:0;background:none;color:#1769aa;font:inherit;font-size:12px;text-decoration:none;cursor:pointer}.codex-image-links a:hover,.codex-image-links button:hover{text-decoration:underline}@keyframes codex-image-shimmer{to{transform:translateX(100%)}}@media(max-width:600px){.codex-oauth-actions button{flex:1 1 auto}.codex-device div{align-items:flex-start;flex-direction:column;gap:4px}.codex-quota-grid{grid-template-columns:1fr}.codex-image-preview img{max-height:420px}}";
    const themeStyle = ".codex-oauth-panel,.codex-image-card{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);transition:background-color .18s ease,color .18s ease,border-color .18s ease}.codex-oauth-head p,.codex-quota-row>span,.codex-quota-meter small,.codex-quota-unavailable,.codex-device p,.codex-image-heading span:not(.codex-image-icon),.codex-image-prompt>span,.codex-image-meta{color:var(--dsw-alias-label-secondary)}.codex-oauth-head p.is-connected{color:var(--dsw-alias-state-success-primary)}.codex-oauth-dot,.codex-image-state{background:var(--dsw-alias-label-caption)}.codex-oauth-panel:has(.is-connected) .codex-oauth-dot,.codex-image-card.is-ready .codex-image-state{background:var(--dsw-alias-state-success-primary)}.codex-quota{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}.codex-quota-head>span{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}.codex-quota-meter{background:var(--dsw-alias-bg-layer-2)}.codex-quota-track{background:var(--dsw-alias-bg-skeleton)}.codex-quota-track>span{background:var(--dsw-alias-state-success-primary)}.codex-quota-meter.is-warn .codex-quota-track>span{background:var(--dsw-alias-state-warn-primary)}.codex-quota-meter.is-low .codex-quota-track>span{background:var(--dsw-alias-state-error-primary)}.codex-oauth-actions button{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary)}.codex-oauth-actions button:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}.codex-oauth-actions button.primary{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}.codex-device{border-left-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}.codex-device a,.codex-image-links a,.codex-image-links button{color:var(--dsw-alias-state-business-primary)}.codex-oauth-error{color:var(--dsw-alias-state-error-primary)}.codex-image-icon{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}.codex-image-card.is-error .codex-image-state{background:var(--dsw-alias-state-error-primary)}.codex-image-preview,.codex-image-skeleton{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-module-platform)}.codex-image-preview img{background:var(--dsw-alias-bg-module-platform)}.codex-image-skeleton span{background:linear-gradient(90deg,transparent,var(--dsw-alias-interactive-bg-hover-accent),transparent)}.codex-image-error{border-color:var(--dsw-alias-state-error-secondary);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.codex-image-links{border-color:var(--dsw-alias-border-l1)}";
    const preferencesStyle = "li:has(button[aria-label$='openai-codex']){display:none}.codex-preferences{margin-top:14px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform)}.codex-preferences-title{display:block;margin-bottom:9px;font-size:13px}.codex-feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.codex-feature-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}.codex-feature-copy{display:flex;flex-direction:column;gap:2px;min-width:0}.codex-feature-copy strong{font-size:12px}.codex-feature-copy small,.codex-models>p,.codex-saving{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px}.codex-switch{position:relative;flex:0 0 auto;width:32px;height:18px}.codex-switch input{position:absolute;opacity:0;pointer-events:none}.codex-switch>span{display:block;width:100%;height:100%;border-radius:999px;background:var(--dsw-alias-bg-skeleton);transition:background .18s ease}.codex-switch>span:after{content:'';display:block;width:14px;height:14px;margin:2px;border-radius:50%;background:var(--dsw-alias-label-primary-inverted);box-shadow:0 1px 3px rgba(0,0,0,.24);transition:transform .18s ease}.codex-switch input:checked+span{background:var(--dsw-alias-state-success-primary)}.codex-switch input:checked+span:after{transform:translateX(14px)}.codex-switch input:focus-visible+span{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.codex-switch input:disabled+span{opacity:.55}.codex-models{min-width:0;margin:11px 0 0;padding:10px 0 0;border:0;border-top:1px solid var(--dsw-alias-border-l1)}.codex-models legend{padding:0;font-size:12px;font-weight:600}.codex-models>p{margin:2px 0 8px}.codex-model-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px}.codex-model-option{display:flex;align-items:center;gap:7px;min-width:0;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:11px;cursor:pointer}.codex-model-option:has(input:checked){border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-business-tertiary)}.codex-model-option input{accent-color:var(--dsw-alias-state-success-primary)}.codex-model-option span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.codex-saving{display:block;margin-top:8px}@media(max-width:600px){.codex-feature-grid{grid-template-columns:1fr}.codex-model-grid{grid-template-columns:1fr}}";
    const collapseStyle = ".codex-oauth-summary{min-width:0}.codex-quota{margin-top:10px;padding:8px 10px}.codex-quota-head{margin-bottom:6px}.codex-quota-grid{gap:8px}.codex-quota-meter{padding:0;background:transparent}.codex-quota-track{height:4px;margin-top:5px}.codex-quota-meter small{margin-top:4px}.codex-preferences{margin-top:10px;padding:9px 10px}.codex-preferences-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.codex-preferences-title{margin:0}.codex-preferences-details{margin-top:9px}.codex-edit-button{min-height:28px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,var(--border,#cdd3db));border-radius:6px;background:var(--dsw-alias-button-elevated-fill,var(--surface,#fff));color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;cursor:pointer}.codex-edit-button:hover{background:var(--dsw-alias-button-floating-hover,var(--muted,#f7f8fa))}.codex-edit-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#3276d2);outline-offset:2px}@media(max-width:600px){.codex-oauth-head{align-items:flex-start}.codex-oauth-head p{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}}";
    const inject = ["slots", "conversation", "locale"];
    function apply(ctx) {
      const node = document.createElement("style"); node.dataset.dshCodexOauth = "true"; node.textContent = style + themeStyle + preferencesStyle + collapseStyle; document.head.appendChild(node);
      ctx.effect(() => () => node.remove());
      ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-codex-oauth: dictionaries");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "dsh-codex-oauth",
        order: 15,
        label: () => "Codex",
        locale: NS,
      }, CodexOAuthPanel));
      ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
        name: "tool.call.toolview",
        key: "generate_image",
        locale: NS,
        inject: (sessionId) => ({
          resolveImage: (attachment) => ctx.conversation.resolveImage(sessionId, attachment),
        }),
      }, ImageGenerationPreview));
    }
    exports.inject = inject; exports.apply = apply; exports.dictionaries = dictionaries; exports.themeStyle = themeStyle; exports.preferencesStyle = preferencesStyle; exports.collapseStyle = collapseStyle; exports.selectedModelIds = selectedModelIds; exports.imageAttachment = imageAttachment; exports.imagePrompt = imagePrompt; exports.remainingPercent = remainingPercent; exports.usageWindowLabel = usageWindowLabel; return module.exports;
  },
  cssIds: [], depIds: ["react", "react/jsx-runtime"], cssEntries: [],
});
