// 苔むす森のおしごと便り — Canvas visualisation of Claude Code agent activity.
//
// Layout per session (lane):
//   ┌──────────────────────────────────────────────┐
//   │ cwd-name                       おとどけずみ ♥ │  title (16px)
//   │ "prompt summary…"                            │  prompt (14px, only if any)
//   │ ▓ bubble row for agent 0                     │  speech zone:
//   │ ▓ bubble row for agent 1                     │   one row (26px) per agent
//   │ ▓ …                                          │   bubble border = agent body color
//   │ moss + path with characters + postbox        │  ground (38px)
//   └──────────────────────────────────────────────┘
//
// Lane height is dynamic: it grows downward as more agents appear so
// nothing overlaps.

const W = 480;
const SCALE = 2;
const HEADER_H = 30;
const FOOTER_H = 16;

const TITLE_H = 16;
const PROMPT_H = 14;
const ROW_H = 26;
const GROUND_H = 38;
const MIN_LANE_H = TITLE_H + ROW_H + GROUND_H;

const COLORS = {
  sky: "#cde6c8",
  moss1: "#5d8a5e",
  moss2: "#446b48",
  mossDot: "#6da26d",
  pathBase: "#7d8c5b",
  pathStone: "#9da973",
  fernGreen: "#3a6b3f",
  mushroomCap: "#c8473e",
  mushroomCapDot: "#f4e9c8",
  mushroomStem: "#f4e9c8",
  mailRed: "#bf4a3a",
  mailDark: "#5e2620",
  mailBeige: "#f4e9c8",
  trunk: "#6b4a2b",
  leaves: "#5b8c4a",
  leavesShade: "#3a6b3f",
  bubble: "#fdfdf2",
  bubbleBorder: "#3b3a2a",
  text: "#262320",
  laneTitle: "#fdfdf2",
  laneTitleSub: "#dde9c8",
  bannerBg: "#3b3a2a",
  bannerText: "#fdfdf2",
};

let canvas, ctx;
let state = { sessions: [], now: Date.now() / 1000 };
let visuals = new Map(); // (sid:agent_id) -> { x }
let serverNowOffset = 0;
let frame = 0;

// --- audio (鈴の音) ---
let audioCtx = null;
let audioEnabled = localStorage.getItem("agentZooMute") !== "1";
const ringedSessions = new Set();
let firstFetchSeen = false;
let audioToggleBtn = null;

window.addEventListener("load", init);

function init() {
  canvas = document.getElementById("stage");
  ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  initAudioToggle();
  fetchState();
  setInterval(fetchState, 1000);
  requestAnimationFrame(loop);
}

function initAudioToggle() {
  audioToggleBtn = document.getElementById("audio-toggle");
  if (!audioToggleBtn) return;
  refreshAudioToggle();
  audioToggleBtn.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    localStorage.setItem("agentZooMute", audioEnabled ? "0" : "1");
    refreshAudioToggle();
    if (audioEnabled) {
      // confirmation chime so the user knows it's on
      ensureAudio();
      playBell();
    }
  });
  // Audio contexts can't start until a user gesture. Resume on any click.
  const wake = () => { ensureAudio(); };
  window.addEventListener("click", wake);
  window.addEventListener("keydown", wake);
}

function refreshAudioToggle() {
  if (!audioToggleBtn) return;
  audioToggleBtn.textContent = audioEnabled ? "♪" : "♪";
  audioToggleBtn.classList.toggle("muted", !audioEnabled);
  audioToggleBtn.title = audioEnabled ? "通知音 ON (押すとOFF)" : "通知音 OFF (押すとON)";
}

function ensureAudio() {
  if (!audioEnabled) return;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

// A simple sine-stack bell sound. No samples — entirely synthesised.
// Inharmonic partial ratios give the shimmery metallic quality of a small
// 鈴; an exponential decay envelope per partial makes it ring out softly.
function playBell() {
  if (!audioEnabled) return;
  ensureAudio();
  if (!audioCtx) return;

  const t0 = audioCtx.currentTime + 0.01;
  const fundamental = 1100;
  const partials = [
    { f: fundamental,         g: 0.30, d: 1.6 },
    { f: fundamental * 1.5,   g: 0.18, d: 1.2 },
    { f: fundamental * 2.0,   g: 0.10, d: 0.9 },
    { f: fundamental * 2.95,  g: 0.06, d: 0.6 },
    { f: fundamental * 4.07,  g: 0.04, d: 0.4 },
  ];

  const master = audioCtx.createGain();
  master.gain.value = 0.45;
  master.connect(audioCtx.destination);

  for (const p of partials) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.f, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(p.g, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + p.d + 0.05);
  }
}

function maybeRingBells() {
  // ring once when a session transitions to ended.
  for (const s of state.sessions) {
    if (s.ended_at && !ringedSessions.has(s.session_id)) {
      ringedSessions.add(s.session_id);
      // don't ring for sessions that were already ended on first page load
      if (firstFetchSeen) playBell();
    }
  }
  // forget sessions that have rolled out of the state so a future re-use
  // (very long-lived browser tab) can ring again.
  const live = new Set(state.sessions.map(s => s.session_id));
  for (const sid of ringedSessions) {
    if (!live.has(sid)) ringedSessions.delete(sid);
  }
  firstFetchSeen = true;
}

async function fetchState() {
  try {
    const r = await fetch("/state");
    state = await r.json();
    serverNowOffset = (Date.now() / 1000) - state.now;
    maybeRingBells();
    resize();
  } catch (e) { /* server may briefly be down */ }
}

function nowServer() { return Date.now() / 1000 - serverNowOffset; }

function visibleSessions() {
  const active = state.sessions.filter(s => !s.ended_at);
  const ended  = state.sessions.filter(s => s.ended_at);
  active.sort((a, b) => a.started_at - b.started_at);
  ended.sort((a, b) => a.started_at - b.started_at);
  return [...active, ...ended];
}

function visibleAgents(s) {
  const t = nowServer();
  return Object.values(s.agents || {})
    .filter(a => a.is_main || !a.ended || (a.ended_at == null) || (t - a.ended_at) < 8)
    .sort((a, b) => {
      // main first, then subs in birth order
      if (a.is_main !== b.is_main) return a.is_main ? -1 : 1;
      return (a.born_at || 0) - (b.born_at || 0);
    });
}

function laneHeight(s) {
  const agents = visibleAgents(s);
  const promptH = s.current_prompt ? PROMPT_H : 0;
  const speechH = Math.max(1, agents.length) * ROW_H;
  return Math.max(MIN_LANE_H, TITLE_H + promptH + speechH + GROUND_H);
}

function resize() {
  const sessions = visibleSessions();
  let h = HEADER_H + FOOTER_H;
  if (sessions.length === 0) h += 100;
  else for (const s of sessions) h += laneHeight(s);
  if (canvas.width !== W || canvas.height !== h) {
    canvas.width = W;
    canvas.height = h;
    canvas.style.width = (W * SCALE) + "px";
    canvas.style.height = (h * SCALE) + "px";
    ctx.imageSmoothingEnabled = false;
  }
}

function loop() {
  frame++;
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawHeader();

  const sessions = visibleSessions();
  if (sessions.length === 0) {
    drawIdle(HEADER_H);
  } else {
    let y = HEADER_H;
    for (const s of sessions) {
      const lh = laneHeight(s);
      drawLane(s, y, lh);
      y += lh;
    }
  }
  drawFooter();
}

function drawHeader() {
  ctx.fillStyle = COLORS.bannerBg;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "bold 12px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("苔むす森のおしごと便り", 8, 9);

  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${hh}:${mm}:${ss}`, W - 8, 11);
  ctx.textAlign = "left";
}

function drawFooter() {
  ctx.fillStyle = COLORS.bannerBg;
  ctx.fillRect(0, canvas.height - FOOTER_H, W, FOOTER_H);
  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`森を歩いている郵便屋さん: ${countActiveAgents()}`, 8, canvas.height - FOOTER_H + 4);
  ctx.textAlign = "right";
  ctx.fillText("http://127.0.0.1:7777", W - 8, canvas.height - FOOTER_H + 4);
  ctx.textAlign = "left";
}

function countActiveAgents() {
  let n = 0;
  for (const s of state.sessions) {
    if (s.ended_at) continue;
    for (const a of Object.values(s.agents || {})) if (!a.ended) n++;
  }
  return n;
}

function drawIdle(yTop) {
  const y = yTop;
  const lh = 100;
  ctx.fillStyle = COLORS.moss1;
  ctx.fillRect(0, y, W, lh);
  drawMossSpeckles(y, lh);
  drawPath(y, lh);
  drawMailbox(W - 32, y + lh - GROUND_H);
  drawTree(40, y + lh - 36);
  drawTree(380, y + lh - 36);
  drawMushroom(120, y + lh - 18);
  drawFern(220, y + lh - 14);
  drawMushroom(310, y + lh - 18);

  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "10px monospace";
  ctx.textBaseline = "top";
  ctx.fillText("森はしずかです…", 12, y + 8);
  ctx.font = "8px monospace";
  ctx.fillStyle = COLORS.laneTitleSub;
  ctx.fillText("Claude Code がうごくと、ここに郵便屋さんがあらわれます。", 12, y + 22);
}

function drawLane(session, yTop, lh) {
  // ground is at the bottom GROUND_H px of the lane
  const groundTop = yTop + lh - GROUND_H;

  // moss + decor + path live in the ground band
  ctx.fillStyle = COLORS.moss1;
  ctx.fillRect(0, groundTop, W, GROUND_H);
  drawMossSpeckles(groundTop, GROUND_H);
  drawDecor(session, groundTop);
  drawPath(groundTop, GROUND_H);
  drawMailbox(W - 32, groundTop);

  // sky band above ground (where title, prompt, speech live)
  // already painted via the global sky background; nothing to redraw

  // title row
  const cwdName = (session.cwd || "").split("/").filter(Boolean).pop() || "(no cwd)";
  ctx.fillStyle = COLORS.bannerBg;
  ctx.fillRect(0, yTop, W, TITLE_H);
  ctx.fillStyle = COLORS.laneTitle;
  ctx.font = "bold 10px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(clipText(cwdName, W - 110), 6, yTop + 3);

  if (session.ended_at) {
    drawDeliveredBadge(W - 96, yTop + 2);
  }

  // prompt row (truncated to fit)
  let speechTop = yTop + TITLE_H;
  if (session.current_prompt) {
    ctx.fillStyle = COLORS.laneTitleSub;
    ctx.font = "9px monospace";
    const promptText = "“" + session.current_prompt + "”";
    ctx.fillText(clipText(promptText, W - 12), 6, yTop + TITLE_H + 1);
    speechTop += PROMPT_H;
  }

  // characters: all walk on the same path centerline, with a small per-agent
  // y stagger so they don't overlap when bunched at start/end.
  const agents = visibleAgents(session);
  const pathTopY = groundTop + 12; // path band starts here
  const charBaseY = pathTopY - 14; // top of character (16px tall, feet at pathTop+2)

  // Draw row identity (name + mission) and bubbles first.
  agents.forEach((a, idx) => {
    const v = ensureVisual(session, a);
    v.x += (a.progress - v.x) * 0.06;
    const charX = Math.round(24 + v.x * (W - 24 - 50));
    drawAgentRowLabel(a, idx, speechTop);
    drawBubbleForAgent(a, idx, speechTop, charX);
  });

  agents.forEach((a, idx) => {
    const v = ensureVisual(session, a);
    const charX = Math.round(24 + v.x * (W - 24 - 50));
    const stagger = idx * 3; // small vertical offset so bunched chars don't overlap
    const moving = !a.ended && Math.abs(a.progress - v.x) > 0.002;
    const f = moving ? Math.floor(frame / 8) : 0;
    const bob = moving ? (Math.floor(frame / 8) % 2) : 0;
    drawWalker(charX, charBaseY - stagger - bob, a.color || "#7bb274", f, a.is_main);
  });
}

function ensureVisual(session, a) {
  const key = (session.session_id || "x") + ":" + a.agent_id;
  let v = visuals.get(key);
  if (!v) { v = { x: 0 }; visuals.set(key, v); }
  return v;
}

// Sticky identity label drawn on the left edge of each agent's row.
// Format:  ●  なまえ・ミッション
function drawAgentRowLabel(agent, agentIdx, speechTop) {
  const rowTop = speechTop + agentIdx * ROW_H;
  const cy = rowTop + Math.floor(ROW_H / 2);
  const dotX = 6, dotY = cy - 3;
  // colored dot (same as bubble border)
  ctx.fillStyle = agent.color || COLORS.bubbleBorder;
  ctx.fillRect(dotX, dotY, 6, 6);
  ctx.fillStyle = shade(agent.color || "#777777", -30);
  ctx.fillRect(dotX, dotY + 5, 6, 1);

  // label text
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.text;
  const mission = agent.mission || (agent.is_main ? "とりまとめ役" : "おつかい");
  const sep = "・";
  // truncate the mission so the whole label fits in ~half the canvas
  const maxLabelW = Math.floor(W * 0.45);
  const nameW = ctx.measureText(agent.name + sep).width;
  const missionMaxW = Math.max(20, maxLabelW - nameW);
  const missionShort = clipText(mission, missionMaxW);
  ctx.fillText(agent.name + sep + missionShort, dotX + 9, rowTop + 4);
}

function drawBubbleForAgent(agent, agentIdx, speechTop, anchorX) {
  if (!agent.say) return;
  if (nowServer() >= (agent.say_until || 0) + 0.6) return;

  const rowTop = speechTop + agentIdx * ROW_H;
  const rowBottom = rowTop + ROW_H - 2;
  const bubbleH = ROW_H - 6;            // ~20px
  const bubbleY = rowBottom - bubbleH;

  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  const maxW = Math.min(W - 16, 260);
  const text = clipText(agent.say, maxW - 10);
  const textW = Math.ceil(ctx.measureText(text).width);
  const w = textW + 10;

  let bx = anchorX - Math.floor(w / 2);
  bx = Math.max(2, Math.min(W - w - 2, bx));
  const by = bubbleY;

  // bubble fill
  ctx.fillStyle = COLORS.bubble;
  ctx.fillRect(bx, by, w, bubbleH);
  // colored border (matches agent coat color so you know who is talking)
  const border = agent.color || COLORS.bubbleBorder;
  ctx.fillStyle = border;
  ctx.fillRect(bx, by, w, 1);
  ctx.fillRect(bx, by + bubbleH - 1, w, 1);
  ctx.fillRect(bx, by, 1, bubbleH);
  ctx.fillRect(bx + w - 1, by, 1, bubbleH);
  // little tail nub at bottom, anchored toward the character's x
  const tailX = Math.max(bx + 3, Math.min(bx + w - 5, anchorX - 1));
  ctx.fillStyle = COLORS.bubble;
  ctx.fillRect(tailX, by + bubbleH, 2, 1);
  ctx.fillStyle = border;
  ctx.fillRect(tailX, by + bubbleH + 1, 1, 1);

  // text
  ctx.fillStyle = COLORS.text;
  ctx.fillText(text, bx + 5, by + Math.floor((bubbleH - 9) / 2));
}

function drawDeliveredBadge(x, y) {
  ctx.font = "bold 9px monospace";
  const label = "おとどけずみ ♥";
  const w = Math.ceil(ctx.measureText(label).width) + 8;
  ctx.fillStyle = COLORS.mailRed;
  ctx.fillRect(x - (w - 84), y, w, 12);
  ctx.fillStyle = COLORS.bannerText;
  ctx.textBaseline = "top";
  ctx.fillText(label, x - (w - 84) + 4, y + 1);
}

// Truncate a string to fit within maxW pixels at the current ctx.font.
function clipText(text, maxW) {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid) + "…";
    if (ctx.measureText(candidate).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

function drawMossSpeckles(yTop, h) {
  ctx.fillStyle = COLORS.mossDot;
  for (let i = 0; i < W; i += 3) {
    const yy = yTop + h - 14 - ((i * 7 + (yTop * 3)) % 11);
    if ((i ^ yTop) & 5) continue;
    ctx.fillRect(i, yy, 1, 1);
  }
  ctx.fillStyle = COLORS.moss2;
  for (let i = 0; i < W; i += 5) {
    if ((i + yTop) % 7 < 3) continue;
    ctx.fillRect(i, yTop + h - 6, 2, 2);
  }
}

function drawPath(groundTop, groundH) {
  const pathTop = groundTop + 12;
  ctx.fillStyle = COLORS.pathBase;
  ctx.fillRect(20, pathTop, W - 40, 14);
  ctx.fillStyle = COLORS.pathStone;
  for (let i = 24; i < W - 24; i += 12) {
    ctx.fillRect(i, pathTop + 2, 4, 2);
    ctx.fillRect(i + 6, pathTop + 8, 3, 2);
  }
}

function stringHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawDecor(session, groundTop) {
  const seed = stringHash(session.session_id || "x");
  const rng = mulberry32(seed);
  const count = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * (W - 80)) + 30;
    const k = Math.floor(rng() * 4);
    const dy = Math.floor(rng() * 4);
    const baseY = groundTop + 10; // top of path-ish
    if (k === 0) drawMushroom(x, baseY - 8 - dy);
    else if (k === 1) drawFern(x, baseY - 4 - dy);
    else if (k === 2) drawTree(x, baseY - 28 - dy);
    else drawSmallMushroom(x, baseY - 6 - dy);
  }
}

function drawMushroom(x, y) {
  ctx.fillStyle = COLORS.mushroomStem;
  ctx.fillRect(x + 2, y + 3, 3, 5);
  ctx.fillStyle = COLORS.mushroomCap;
  ctx.fillRect(x, y, 7, 3);
  ctx.fillRect(x + 1, y - 1, 5, 1);
  ctx.fillStyle = COLORS.mushroomCapDot;
  ctx.fillRect(x + 2, y + 1, 1, 1);
  ctx.fillRect(x + 4, y, 1, 1);
}

function drawSmallMushroom(x, y) {
  ctx.fillStyle = COLORS.mushroomStem;
  ctx.fillRect(x + 1, y + 2, 2, 3);
  ctx.fillStyle = "#e29960";
  ctx.fillRect(x, y, 4, 2);
}

function drawFern(x, y) {
  ctx.fillStyle = COLORS.fernGreen;
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(x - i, y + i, 2, 1);
    ctx.fillRect(x + i + 1, y + i, 2, 1);
  }
  ctx.fillRect(x, y - 1, 1, 7);
}

function drawTree(x, y) {
  ctx.fillStyle = COLORS.trunk;
  ctx.fillRect(x + 4, y + 12, 3, 8);
  ctx.fillStyle = COLORS.leaves;
  ctx.fillRect(x, y + 4, 11, 9);
  ctx.fillRect(x + 1, y + 2, 9, 2);
  ctx.fillRect(x + 3, y, 5, 2);
  ctx.fillStyle = COLORS.leavesShade;
  ctx.fillRect(x + 1, y + 9, 2, 2);
  ctx.fillRect(x + 7, y + 6, 2, 2);
  ctx.fillRect(x + 5, y + 11, 2, 2);
}

function drawMailbox(x, y) {
  ctx.fillStyle = COLORS.mailDark;
  ctx.fillRect(x + 4, y + 10, 3, 16);
  ctx.fillStyle = COLORS.mailRed;
  ctx.fillRect(x, y + 2, 12, 10);
  ctx.fillRect(x + 1, y + 1, 10, 1);
  ctx.fillStyle = COLORS.mailDark;
  ctx.fillRect(x + 2, y + 6, 8, 1); // slot
  ctx.fillStyle = COLORS.mailBeige;
  ctx.fillRect(x + 10, y + 3, 1, 5); // flag pole
  ctx.fillStyle = "#e8c060";
  ctx.fillRect(x + 11, y + 3, 2, 3); // flag
  ctx.fillStyle = COLORS.mailDark;
  ctx.fillRect(x, y + 12, 12, 1);
}

function drawWalker(x, y, color, frameIdx, isMain) {
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 1, y + 16, 11, 1);

  // legs (walk cycle)
  ctx.fillStyle = "#3b2b1a";
  if (frameIdx % 2 === 0) {
    ctx.fillRect(x + 3, y + 13, 2, 3);
    ctx.fillRect(x + 7, y + 13, 2, 2);
  } else {
    ctx.fillRect(x + 3, y + 13, 2, 2);
    ctx.fillRect(x + 7, y + 13, 2, 3);
  }

  // body (coat) — uses agent color
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 7, 8, 6);
  ctx.fillStyle = shade(color, -25);
  ctx.fillRect(x + 2, y + 12, 8, 1);
  ctx.fillStyle = shade(color, -40);
  ctx.fillRect(x + 4, y + 7, 4, 1);

  // bag
  ctx.fillStyle = "#c2a06b";
  ctx.fillRect(x + 8, y + 9, 4, 4);
  ctx.fillStyle = "#7b5b35";
  ctx.fillRect(x + 8, y + 9, 4, 1);
  ctx.fillRect(x + 9, y + 11, 2, 1);

  // head
  ctx.fillStyle = "#f6dfa9";
  ctx.fillRect(x + 3, y + 3, 6, 5);
  ctx.fillStyle = "#3b2b1a";
  ctx.fillRect(x + 5, y + 5, 1, 1);
  ctx.fillRect(x + 7, y + 5, 1, 1);

  // cap (red for main, soft tan for sub)
  ctx.fillStyle = isMain ? "#bf4a3a" : "#a08055";
  ctx.fillRect(x + 2, y + 1, 8, 2);
  ctx.fillRect(x + 1, y + 2, 11, 1);
  ctx.fillStyle = COLORS.mailBeige;
  ctx.fillRect(x + 5, y + 1, 2, 1);
}

function shade(hex, pct) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  const f = pct / 100;
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (f < 0 ? v : 255 - v) * Math.abs(f))));
  return "#" + [adj(r), adj(g), adj(b)].map(v => v.toString(16).padStart(2, "0")).join("");
}
