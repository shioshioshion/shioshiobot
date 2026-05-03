// Relays events from claude.ai content scripts to the local agent-zoo server.
// Lives in the background service worker so it can do cross-origin POST without
// being blocked by mixed-content rules on the claude.ai page.

const SERVER_URL = "http://127.0.0.1:7777/event";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "agentZooEvent" || !msg.payload) {
    sendResponse({ ok: false });
    return false;
  }
  fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.payload),
    keepalive: true,
  }).catch(() => { /* server may be off — silent */ });
  sendResponse({ ok: true });
  return false;
});
