// とここと 経営ダッシュボード — content script for claude.ai
// Watches for user prompts and assistant streaming activity, then forwards
// events to the agent-zoo background relay (which POSTs to localhost:7777).

(function () {
  if (window.__agentZooBridgeLoaded) return;
  window.__agentZooBridgeLoaded = true;

  // One stable session id per browser tab so the same lane persists across
  // URL changes (e.g. /new -> /chat/<uuid> on first message).
  let tabSid = sessionStorage.getItem("agentZooTabId");
  if (!tabSid) {
    tabSid = "claudeai-" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("agentZooTabId", tabSid);
  }

  const TICK_MS = 1500;
  const HEARTBEAT_MS = 3000; // tool tick interval while streaming

  let isStreaming = false;
  let lastTickAt = 0;
  let sessionAnnounced = false;
  let lastSentPromptKey = "";

  function send(eventName, extra) {
    const payload = Object.assign({
      hook_event_name: eventName,
      session_id: tabSid,
      cwd: "claude.ai" + niceCwdFromUrl(),
    }, extra || {});
    try {
      chrome.runtime.sendMessage({ type: "agentZooEvent", payload: payload });
    } catch (e) {
      // service worker may be reloading — silently drop
    }
  }

  function niceCwdFromUrl() {
    const p = location.pathname;
    let m = p.match(/\/chat\/([0-9a-f-]+)/);
    if (m) return "/chat/" + m[1].slice(0, 8);
    m = p.match(/\/project\/([0-9a-f-]+)/);
    if (m) return "/project/" + m[1].slice(0, 8);
    m = p.match(/\/code\/([0-9a-f-]+)/);
    if (m) return "/code/" + m[1].slice(0, 8);
    if (p.startsWith("/new")) return "/new";
    return p.split("/").slice(0, 3).join("/") || "/";
  }

  function ensureSession() {
    if (sessionAnnounced) return;
    sessionAnnounced = true;
    send("SessionStart");
  }

  function readPromptText() {
    // claude.ai uses a contenteditable div for the input.
    const ce = document.querySelector(
      'div[contenteditable="true"][role="textbox"], ' +
      'div[contenteditable="true"].ProseMirror, ' +
      'div[contenteditable="true"]'
    );
    if (ce && (ce.innerText || "").trim()) return ce.innerText.trim();
    const ta = document.querySelector("textarea");
    if (ta && (ta.value || "").trim()) return ta.value.trim();
    return "";
  }

  function isStopButtonVisible() {
    const buttons = document.querySelectorAll("button");
    for (const b of buttons) {
      const lbl = (b.getAttribute("aria-label") || "").toLowerCase();
      if (!lbl) continue;
      // Common variants seen in claude.ai across versions.
      if (
        lbl.includes("stop response") ||
        lbl.includes("stop generating") ||
        lbl === "stop" ||
        lbl.includes("生成を停止") ||
        lbl.includes("停止")
      ) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    }
    return false;
  }

  function maybeRecordSend(text) {
    const t = (text || "").trim();
    if (!t) return;
    // simple dedupe so a single send isn't fired twice (Enter + click)
    const key = t.slice(0, 80);
    if (key === lastSentPromptKey) return;
    lastSentPromptKey = key;
    setTimeout(() => { lastSentPromptKey = ""; }, 4000);

    ensureSession();
    send("UserPromptSubmit", { prompt: t.slice(0, 200) });
  }

  // --- Listeners for prompt submission ---

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    // Most claude.ai layouts: Enter sends, Shift+Enter newline. Some setups
    // require Cmd/Ctrl+Enter — handle both.
    const text = readPromptText();
    if (text) maybeRecordSend(text);
  }, true);

  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest && e.target.closest("button");
    if (!btn) return;
    const lbl = (btn.getAttribute("aria-label") || btn.textContent || "").toLowerCase();
    if (!lbl) return;
    if (
      lbl.includes("send message") ||
      lbl.includes("send prompt") ||
      lbl === "send" ||
      lbl.includes("送信") ||
      lbl.includes("送る")
    ) {
      const text = readPromptText();
      if (text) maybeRecordSend(text);
    }
  }, true);

  // --- Polling for streaming state ---

  setInterval(() => {
    ensureSession();
    const streaming = isStopButtonVisible();
    const now = Date.now();
    if (streaming && !isStreaming) {
      isStreaming = true;
      lastTickAt = now;
      send("PreToolUse", { tool_name: "Thinking", tool_input: {} });
    } else if (!streaming && isStreaming) {
      isStreaming = false;
      send("Stop");
    } else if (streaming && now - lastTickAt > HEARTBEAT_MS) {
      lastTickAt = now;
      send("PreToolUse", { tool_name: "Thinking", tool_input: {} });
      detectToolCards();
    }
  }, TICK_MS);

  // --- Best-effort tool card detection ---
  // Looks for newly-rendered tool blocks in the most recent assistant message.
  // Marks the node so we don't re-fire for the same block.
  function detectToolCards() {
    const blocks = document.querySelectorAll(
      "[data-testid*='tool'], [data-testid*='search'], [aria-label*='Search'], [aria-label*='Artifact']"
    );
    for (const b of blocks) {
      if (b.__agentZooSeen) continue;
      b.__agentZooSeen = true;
      const txt = (b.textContent || "").toLowerCase();
      let tool = null;
      if (txt.includes("search")) tool = "WebSearch";
      else if (txt.includes("artifact")) tool = "Artifact";
      else if (txt.includes("drive")) tool = "Drive";
      else if (txt.includes("image")) tool = "Image";
      if (tool) send("PreToolUse", { tool_name: tool, tool_input: {} });
    }
  }

  // --- Initial announce ---
  ensureSession();
})();
