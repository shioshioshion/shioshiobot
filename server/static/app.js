// 苔むす森のおしごと便り — Canvas visualisation of Claude Code agent activity.

const W = 480;
const LANE_H = 100;
const HEADER_H = 30;
const FOOTER_H = 16;
const SCALE = 2;

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
let visuals = new Map(); // (sid:agent_id) -> { x, lastTool }
let serverNowOffset = 0;
let frame = 0;

window.addEventListener("load", init);

function init() {
  canvas = document.getElementById("stage");
  ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  fetchState();
  setInterval(fetchState, 1000);
  requestAnimationFrame(loop);
}

async function fetchState() {
  try {
    const r = await fetch("/state");
    const s = await r.json();
    state = s;
    serverNowOffset = (Date.now() / 1000) - s.now;
    resize();
  } catch (e) { /* ignore — server may briefly be down */ }
}

function resize() {
  const lanes = Math.max(1, visibleSessions().length);
  const h = HEADER_H + lanes * LANE_H + FOOTER_H;
  if (canvas.width !== W || canvas.height !== h) {
    canvas.width = W;
    canvas.height = h;
    canvas.style.width = (W * SCALE) + "px";
    canvas.style.height = (h * SCALE) + "px";
    ctx.imageSmoothingEnabled = false;
  }
}

function visibleSessions() {
  const active = state.sessions.filter(s => !s.ended_at);
  const ended  = state.sessions.filter(s => s.ended_at);
  active.sort((a, b) => a.started_at - b.started_at);
  ended.sort((a, b) => a.started_at - b.started_at);
  return [...active, ...ended];
}

function nowServer() {
  return Date.now() / 1000 - serverNowOffset;
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
    drawIdle();
  } else {
    sessions.forEach((s, i) => drawLane(s, HEADER_H + i * LANE_H));
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

function drawIdle() {
  const y = HEADER_H;
  ctx.fillStyle = COLORS.moss1;
  ctx.fillRect(0, y, W, LANE_H);
  drawMossSpeckles(y);
  drawPath(y);
  drawMailbox(W - 32, y + LANE_H - 38);
  drawTree(40, y + LANE_H - 36);
  drawTree(380, y + LANE_H - 36);
  drawMushroom(120, y + LANE_H - 18);
  drawFern(220, y + LANE_H - 14);
  drawMushroom(310, y + LANE_H - 18);

  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "10px monospace";
  ctx.textBaseline = "top";
  ctx.fillText("森はしずかです…", 12, y + 8);
  ctx.font = "8px monospace";
  ctx.fillStyle = COLORS.laneTitleSub;
  ctx.fillText("Claude Code がうごくと、ここに郵便屋さんがあらわれます。", 12, y + 22);
}

function drawLane(session, y) {
  ctx.fillStyle = COLORS.moss1;
  ctx.fillRect(0, y, W, LANE_H);
  drawMossSpeckles(y);
  drawDecor(session, y);
  drawPath(y);
  drawMailbox(W - 32, y + LANE_H - 38);

  // session title
  ctx.fillStyle = COLORS.laneTitle;
  ctx.font = "bold 9px monospace";
  ctx.textBaseline = "top";
  const cwdName = (session.cwd || "").split("/").filter(Boolean).pop() || "(no cwd)";
  ctx.fillText(`[${session.short_id}] ${cwdName}`, 6, y + 6);
  if (session.current_prompt) {
    ctx.fillStyle = COLORS.laneTitleSub;
    ctx.font = "9px monospace";
    ctx.fillText("“" + session.current_prompt + "”", 6, y + 18);
  }

  // tool count badge
  ctx.fillStyle = COLORS.bannerBg;
  ctx.fillRect(W - 90, y + 6, 56, 12);
  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "8px monospace";
  ctx.fillText(`tools:${session.tool_count}`, W - 86, y + 8);

  // ended overlay
  if (session.ended_at) {
    drawDeliveredBadge(W - 100, y + 22);
  }

  // agents
  const agents = Object.values(session.agents || {});
  // main first, then subs
  agents.sort((a, b) => (a.is_main ? -1 : 0) - (b.is_main ? -1 : 0));
  agents.forEach((a, idx) => drawAgent(a, session, y, idx));
}

function drawDeliveredBadge(x, y) {
  ctx.fillStyle = COLORS.mailRed;
  ctx.fillRect(x, y, 64, 12);
  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "bold 8px monospace";
  ctx.fillText("DELIVERED ♥", x + 4, y + 2);
}

function drawMossSpeckles(y) {
  ctx.fillStyle = COLORS.mossDot;
  for (let i = 0; i < W; i += 3) {
    const yy = y + LANE_H - 14 - ((i * 7 + (y * 3)) % 11);
    if ((i ^ y) & 5) continue;
    ctx.fillRect(i, yy, 1, 1);
  }
  ctx.fillStyle = COLORS.moss2;
  for (let i = 0; i < W; i += 5) {
    if ((i + y) % 7 < 3) continue;
    ctx.fillRect(i, y + LANE_H - 6, 2, 2);
  }
}

function drawPath(y) {
  ctx.fillStyle = COLORS.pathBase;
  ctx.fillRect(20, y + LANE_H - 26, W - 40, 14);
  ctx.fillStyle = COLORS.pathStone;
  for (let i = 24; i < W - 24; i += 12) {
    ctx.fillRect(i, y + LANE_H - 24, 4, 2);
    ctx.fillRect(i + 6, y + LANE_H - 18, 3, 2);
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

function drawDecor(session, y) {
  const seed = stringHash(session.session_id || "x");
  const rng = mulberry32(seed);
  const count = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * (W - 80)) + 30;
    const k = Math.floor(rng() * 4);
    const dy = Math.floor(rng() * 4);
    if (k === 0) drawMushroom(x, y + LANE_H - 16 - dy);
    else if (k === 1) drawFern(x, y + LANE_H - 12 - dy);
    else if (k === 2) drawTree(x, y + LANE_H - 36 - dy);
    else drawSmallMushroom(x, y + LANE_H - 14 - dy);
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

function drawAgent(a, session, y, idx) {
  const key = (session.session_id || "x") + ":" + a.agent_id;
  let v = visuals.get(key);
  if (!v) { v = { x: 0 }; visuals.set(key, v); }
  const target = a.progress;
  v.x += (target - v.x) * 0.06;

  const startX = 24;
  const endX = W - 36;
  const px = Math.round(startX + v.x * (endX - startX));
  const stack = a.is_main ? 0 : (1 + idx) * 5;
  const py = y + LANE_H - 38 - stack;
  const moving = !a.ended && Math.abs(target - v.x) > 0.002;
  const f = moving ? Math.floor(frame / 8) : 0;
  const bob = moving ? (Math.floor(frame / 8) % 2) : 0;

  drawWalker(px, py - bob, a.color || "#7bb274", f, a.is_main);

  // name
  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "7px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(a.name, px + 6, py + 18);
  ctx.textAlign = "left";

  // speech bubble — show until say_until + small grace
  const t = nowServer();
  if (a.say && t < (a.say_until || 0) + 0.6) {
    drawBubble(px + 6, py - 4, a.say);
  }
}

function drawWalker(x, y, color, frame, isMain) {
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 1, y + 16, 11, 1);

  // legs (walk cycle)
  ctx.fillStyle = "#3b2b1a";
  if (frame % 2 === 0) {
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
  // collar
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
  // eyes
  ctx.fillStyle = "#3b2b1a";
  ctx.fillRect(x + 5, y + 5, 1, 1);
  ctx.fillRect(x + 7, y + 5, 1, 1);

  // cap (red for main, soft tan for sub)
  ctx.fillStyle = isMain ? "#bf4a3a" : "#a08055";
  ctx.fillRect(x + 2, y + 1, 8, 2);
  ctx.fillRect(x + 1, y + 2, 11, 1);
  // cap badge
  ctx.fillStyle = COLORS.mailBeige;
  ctx.fillRect(x + 5, y + 1, 2, 1);
}

function shade(hex, pct) {
  const c = hex.replace("#", "");
  let r = parseInt(c.substr(0, 2), 16);
  let g = parseInt(c.substr(2, 2), 16);
  let b = parseInt(c.substr(4, 2), 16);
  const f = pct / 100;
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (f < 0 ? v : 255 - v) * Math.abs(f))));
  return "#" + [adj(r), adj(g), adj(b)].map(v => v.toString(16).padStart(2, "0")).join("");
}

function wrap(text, n) {
  const lines = [];
  let s = String(text || "");
  while (s.length > n) {
    lines.push(s.slice(0, n));
    s = s.slice(n);
  }
  if (s) lines.push(s);
  return lines.slice(0, 3);
}

function drawBubble(anchorX, anchorY, text) {
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  const lines = wrap(text, 22);
  const widths = lines.map(l => Math.ceil(ctx.measureText(l).width));
  const w = Math.max(...widths) + 8;
  const h = lines.length * 10 + 6;
  let bx = anchorX - Math.floor(w / 2);
  let by = anchorY - h - 4;
  bx = Math.max(2, Math.min(W - w - 2, bx));
  by = Math.max(HEADER_H + 2, by);

  // bubble fill
  ctx.fillStyle = COLORS.bubble;
  ctx.fillRect(bx, by, w, h);
  // border
  ctx.fillStyle = COLORS.bubbleBorder;
  ctx.fillRect(bx, by, w, 1);
  ctx.fillRect(bx, by + h - 1, w, 1);
  ctx.fillRect(bx, by, 1, h);
  ctx.fillRect(bx + w - 1, by, 1, h);
  // tail
  const tailX = Math.max(bx + 4, Math.min(bx + w - 6, anchorX - 1));
  ctx.fillStyle = COLORS.bubble;
  ctx.fillRect(tailX, by + h, 2, 2);
  ctx.fillStyle = COLORS.bubbleBorder;
  ctx.fillRect(tailX, by + h + 2, 1, 1);

  // text
  ctx.fillStyle = COLORS.text;
  lines.forEach((l, i) => ctx.fillText(l, bx + 4, by + 4 + i * 10));
}
