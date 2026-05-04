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
  bubble: "#fdfdf2",
  bubbleBorder: "#3b3a2a",
  text: "#262320",
  bannerBg: "#3b3a2a",
  bannerText: "#fdfdf2",
  // shared sprite colors (postman & mailbox stay the same across themes)
  mailRed: "#bf4a3a",
  mailDark: "#5e2620",
  mailBeige: "#f4e9c8",
  // legacy aliases retained for unchanged sprites:
  mushroomCap: "#c8473e",
  mushroomCapDot: "#f4e9c8",
  mushroomStem: "#f4e9c8",
  trunk: "#6b4a2b",
  leaves: "#5b8c4a",
  leavesShade: "#3a6b3f",
  fernGreen: "#3a6b3f",
};

// Each session is assigned one theme (deterministic by session_id) so the
// scenery varies but stays stable across reloads. The postman, the path
// and the mailbox are shared so every theme reads as "an おしごと郵便屋さん".
const THEMES = [
  { // 0: 苔の森
    sky: "#cde6c8", ground: "#5d8a5e", groundDark: "#446b48", groundDot: "#6da26d",
    pathBase: "#7d8c5b", pathStone: "#9da973",
    titleDim: "#dde9c8",
    decor: ["mushroom", "fern", "tree", "smallMushroom"],
  },
  { // 1: 砂浜の道
    sky: "#bce0f0", ground: "#e0c894", groundDark: "#bea870", groundDot: "#f0d8a4",
    pathBase: "#e8c890", pathStone: "#f5dba8",
    titleDim: "#cce6f0",
    decor: ["palm", "shell", "smallStone", "smallMushroom"],
  },
  { // 2: 夜の集落
    sky: "#1f2349", ground: "#2a2e54", groundDark: "#161938", groundDot: "#5a6090",
    pathBase: "#3d3b58", pathStone: "#5a5878",
    titleDim: "#a8b0d8",
    decor: ["lantern", "nightTree", "firefly", "star"],
  },
  { // 3: 雪の道
    sky: "#dde8f0", ground: "#dee5e8", groundDark: "#a6b6c0", groundDot: "#ffffff",
    pathBase: "#9eafbf", pathStone: "#dde8f0",
    titleDim: "#dde8f0",
    decor: ["pine", "snowMound", "snowflake", "smallStone"],
  },
  { // 4: 桜並木
    sky: "#fae3ec", ground: "#a4c094", groundDark: "#7c987a", groundDot: "#e8b8d0",
    pathBase: "#c8b090", pathStone: "#e0c4a4",
    titleDim: "#f0c8de",
    decor: ["cherryTree", "lantern", "fern", "smallMushroom"],
  },
  { // 5: 星空小径
    sky: "#0e1238", ground: "#1d2255", groundDark: "#0d1130", groundDot: "#7884c4",
    pathBase: "#3a4078", pathStone: "#6068a0",
    titleDim: "#bcc8f0",
    decor: ["star", "firefly", "lantern", "nightTree"],
  },
];

// Theme assignment: each session keeps a stable theme even across page
// reloads (so a long-lived Claude Code session doesn't switch backgrounds
// every time you re-open the viewer). New sessions cycle through THEMES
// in order so that consecutive new sessions are visually distinct.
let themeAssignments = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem("agentZooThemes") || "{}");
    const m = new Map();
    for (const k of Object.keys(raw)) m.set(k, raw[k] | 0);
    return m;
  } catch (e) { return new Map(); }
})();
let themeCounter = parseInt(localStorage.getItem("agentZooThemeCounter") || "0", 10) || 0;

function persistThemes() {
  try {
    const obj = {};
    for (const [k, v] of themeAssignments) obj[k] = v;
    localStorage.setItem("agentZooThemes", JSON.stringify(obj));
    localStorage.setItem("agentZooThemeCounter", String(themeCounter));
  } catch (e) {}
}

function pickTheme(sessionId) {
  const key = sessionId || "x";
  if (!themeAssignments.has(key)) {
    themeAssignments.set(key, themeCounter % THEMES.length);
    themeCounter = (themeCounter + 1) % THEMES.length;
    // bound the map so it doesn't grow forever
    if (themeAssignments.size > 50) {
      const oldest = themeAssignments.keys().next().value;
      themeAssignments.delete(oldest);
    }
    persistThemes();
  }
  return THEMES[themeAssignments.get(key)];
}

let canvas, ctx;
let state = { sessions: [], now: Date.now() / 1000 };
let visuals = new Map(); // (sid:agent_id) -> { x }
let serverNowOffset = 0;
let frame = 0;

// --- audio (鈴の音 + 意気込み読み上げ) ---
let audioCtx = null;
let audioEnabled = localStorage.getItem("agentZooMute") !== "1";
// Map session_id -> last seen ended_at value. We ring whenever this value
// transitions from null/undefined → set, OR from one timestamp to a newer
// one (multi-turn Claude Code sessions go ended → un-ended → ended → … and
// must ring on every "ended" transition).
const lastEndedAt = new Map();
// Per-agent intro_at last seen. Speak when a new value arrives.
const lastIntroAt = new Map();
// Per-agent help_at last seen. When it advances we ring the bell AND
// speak the help line so the user notices a session waiting on them.
const lastHelpAt = new Map();
let firstFetchSeen = false;
let audioToggleBtn = null;

// Voice profile per personality. All ranges are biased toward the upper
// half of the speechSynthesis pitch scale so every postman sounds
// small, friendly and cute — no creepy-low voices. Personalities are
// still distinguishable through their relative pitch + rate.
// Within each personality the agent's name+id seeds a deterministic
// point in the range, so any one postman has a stable voice.
const PERSONALITY_VOICE = {
  energetic: { pitchMin: 1.45, pitchMax: 1.85, rateMin: 1.10, rateMax: 1.30, gain: 1.00 },
  calm:      { pitchMin: 1.15, pitchMax: 1.35, rateMin: 0.95, rateMax: 1.05, gain: 0.95 },
  shy:       { pitchMin: 1.20, pitchMax: 1.45, rateMin: 0.92, rateMax: 1.02, gain: 0.85 },
  playful:   { pitchMin: 1.30, pitchMax: 1.70, rateMin: 1.00, rateMax: 1.25, gain: 0.98 },
};

window.addEventListener("load", init);

const APP_VERSION = "0.12-mission-line";

function init() {
  console.log("[agent-zoo] app.js loaded, version =", APP_VERSION);
  canvas = document.getElementById("stage");
  ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  initAudioToggle();
  // The browser loads voices asynchronously; surface what's available so
  // the user can verify Japanese voices exist if they're debugging audio.
  if ("speechSynthesis" in window) {
    const dump = () => {
      const vs = (window.speechSynthesis.getVoices() || []).map(v => `${v.name}(${v.lang})`);
      console.log("[agent-zoo] available voices:", vs.length, "→", vs.slice(0, 12).join(", "));
    };
    dump();
    window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener("voiceschanged", dump);
  }
  fetchState();
  setInterval(fetchState, 1000);
  requestAnimationFrame(loop);
}

function initAudioToggle() {
  audioToggleBtn = document.getElementById("audio-toggle");
  const testBtn = document.getElementById("audio-test");
  refreshAudioToggle();

  if (testBtn) {
    // Test button: rings the bell AND speaks a sample line, so the user
    // can verify both audio paths independently. Also un-mutes if needed.
    testBtn.addEventListener("click", () => {
      console.log("[agent-zoo] test requested");
      if (!audioEnabled) {
        audioEnabled = true;
        localStorage.setItem("agentZooMute", "0");
        refreshAudioToggle();
      }
      wakeBothAudio();
      playBell();
      // pick one of four sample voices for the test so the user hears
      // the personality variation on every press.
      const samples = [
        { name: "テスト・元気", agent_id: "t-e", personality: "energetic", text: "やってやるぞー！テストです！" },
        { name: "テスト・落ち着き", agent_id: "t-c", personality: "calm",      text: "テストです、よろしくお願いします" },
        { name: "テスト・控えめ", agent_id: "t-s", personality: "shy",       text: "…テスト、してみますね" },
        { name: "テスト・遊び心", agent_id: "t-p", personality: "playful",   text: "テストー♪ どれどれ〜" },
      ];
      const pick = samples[Math.floor(Math.random() * samples.length)];
      speakIntro(pick.text, pick);
    });
  }

  if (audioToggleBtn) {
    audioToggleBtn.addEventListener("click", () => {
      audioEnabled = !audioEnabled;
      localStorage.setItem("agentZooMute", audioEnabled ? "0" : "1");
      refreshAudioToggle();
      console.log("[agent-zoo] audio toggled:", audioEnabled ? "ON" : "OFF");
    });
  }

  // Audio contexts and speechSynthesis both need a user gesture to start.
  // Hook any click/keydown anywhere on the page to wake both.
  const wake = () => { wakeBothAudio(); };
  window.addEventListener("click", wake);
  window.addEventListener("keydown", wake);
}

// Warm up Web Audio AND Web Speech in response to a user gesture.
function wakeBothAudio() {
  ensureAudio();
  if ("speechSynthesis" in window) {
    try {
      // Some Chromium browsers gate speechSynthesis on a user gesture too.
      // A near-silent utterance pinned to the queue satisfies that gate.
      window.speechSynthesis.resume();
      if (!window.__agentZooSpeechWarmed) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0; u.rate = 1; u.pitch = 1;
        u.onend = () => {};
        window.speechSynthesis.speak(u);
        window.__agentZooSpeechWarmed = true;
      }
    } catch (e) {}
  }
}

function refreshAudioToggle() {
  if (!audioToggleBtn) return;
  audioToggleBtn.textContent = audioEnabled ? "通知音 ON" : "通知音 OFF";
  audioToggleBtn.classList.toggle("muted", !audioEnabled);
  audioToggleBtn.title = audioEnabled ? "通知音をOFFにする" : "通知音をONにする";
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
  if (!audioEnabled) {
    console.log("[agent-zoo] bell suppressed: muted");
    return;
  }
  ensureAudio();
  if (!audioCtx) {
    console.log("[agent-zoo] bell suppressed: no AudioContext (browser may need a user click first)");
    return;
  }
  if (audioCtx.state !== "running") {
    console.log("[agent-zoo] bell suppressed: AudioContext state =", audioCtx.state, "(click anywhere on the page first)");
    return;
  }
  console.log("[agent-zoo] ringing 鈴 ♪");

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

function _buildUtter(text, agent) {
  const personality = agent.personality || "calm";
  const cfg = PERSONALITY_VOICE[personality] || PERSONALITY_VOICE.calm;
  const seed = stringHash((agent.name || "") + ":" + (agent.agent_id || ""));
  const r1 = ((seed >>> 0) % 1000) / 1000;
  const r2 = (((seed >>> 10) >>> 0) % 1000) / 1000;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  utter.pitch = cfg.pitchMin + r1 * (cfg.pitchMax - cfg.pitchMin);
  utter.rate  = cfg.rateMin  + r2 * (cfg.rateMax  - cfg.rateMin);
  utter.volume = Math.min(1, 0.95 * (cfg.gain || 1));
  const voices = window.speechSynthesis.getVoices() || [];
  const ja = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith("ja"));
  const cute = ja.filter(v => !/otoya/i.test(v.name || ""));
  const pool = cute.length ? cute : ja;
  if (pool.length) utter.voice = pool[seed % pool.length];
  return { utter, personality, voicesLoaded: voices.length };
}

function speakIntro(text, agent) {
  if (!audioEnabled) {
    console.log("[agent-zoo] speech suppressed (muted):", text);
    return;
  }
  if (!("speechSynthesis" in window)) {
    console.log("[agent-zoo] speechSynthesis not supported in this browser");
    return;
  }
  const ss = window.speechSynthesis;
  console.log(
    "[agent-zoo] speech state pre-speak: paused=", ss.paused,
    "speaking=", ss.speaking, "pending=", ss.pending,
  );

  // Aggressive un-jam: if the engine is "idle" but somehow stuck (Chrome
  // on macOS often gets into this state after ~15s without speaking),
  // a cancel() + resume() is the only thing that revives it. We only
  // cancel when there's nothing actually in flight, so we don't kill a
  // legitimate ongoing utterance.
  try {
    if (!ss.speaking && !ss.pending) {
      ss.cancel();
    }
    ss.resume();
  } catch (e) { console.log("[agent-zoo] reset failed:", e); }

  const built = _buildUtter(text, agent);
  const utter = built.utter;
  utter.onstart = () => console.log("[agent-zoo] speech START:", agent.name, "→", text);
  utter.onend   = () => console.log("[agent-zoo] speech END:  ", agent.name);
  utter.onerror = (e) => {
    console.log("[agent-zoo] speech ERR:", e.error || e, "for", agent.name);
    // One-shot retry on transient errors. Build a fresh utterance because
    // a SpeechSynthesisUtterance can only be spoken once reliably.
    if (e.error === "interrupted" || e.error === "canceled") return;
    if (utter.__retried) return;
    setTimeout(() => {
      try {
        const again = _buildUtter(text, agent).utter;
        again.__retried = true;
        again.onstart = () => console.log("[agent-zoo] retry START:", agent.name);
        again.onend   = () => console.log("[agent-zoo] retry END:  ", agent.name);
        again.onerror = (er) => console.log("[agent-zoo] retry ERR:", er.error, agent.name);
        ss.cancel(); ss.resume(); ss.speak(again);
      } catch (e2) { console.log("[agent-zoo] retry failed:", e2); }
    }, 200);
  };

  console.log("[agent-zoo] queueing speech:", agent.name, built.personality,
              "p=" + utter.pitch.toFixed(2), "r=" + utter.rate.toFixed(2),
              "voice=" + (utter.voice ? utter.voice.name : "(default)"),
              "voices_loaded=" + built.voicesLoaded,
              "→", text);
  try { ss.speak(utter); }
  catch (e) { console.log("[agent-zoo] speak failed:", e); }

  // Watchdog: if the utterance never starts within 1 second, force a
  // recovery cycle and try once more with a fresh utterance.
  let started = false;
  utter.addEventListener("start", () => { started = true; });
  setTimeout(() => {
    if (started) return;
    if (utter.__retried) return;
    console.log("[agent-zoo] speech didn't start within 1s; recovering");
    try { ss.cancel(); ss.resume(); } catch (e) {}
    try {
      const again = _buildUtter(text, agent).utter;
      again.__retried = true;
      again.onstart = () => console.log("[agent-zoo] recovery START:", agent.name);
      again.onend   = () => console.log("[agent-zoo] recovery END:  ", agent.name);
      again.onerror = (er) => console.log("[agent-zoo] recovery ERR:", er.error, agent.name);
      ss.speak(again);
    } catch (e) { console.log("[agent-zoo] recovery failed:", e); }
  }, 1100);
}

function maybeSpeakIntros() {
  if (!firstFetchSeen) {
    // first /state response — record but don't speak (avoid a flood when
    // the page first opens with old sessions still hanging around).
    for (const s of state.sessions) {
      for (const a of Object.values(s.agents || {})) {
        const key = s.session_id + ":" + a.agent_id;
        lastIntroAt.set(key, a.intro_at || 0);
      }
    }
    return;
  }
  for (const s of state.sessions) {
    for (const a of Object.values(s.agents || {})) {
      const key = s.session_id + ":" + a.agent_id;
      const prev = lastIntroAt.get(key) || 0;
      const cur = a.intro_at || 0;
      if (cur > prev && a.intro_phrase) {
        console.log("[agent-zoo] intro detected for", a.name,
                    "prev=", prev, "cur=", cur, "phrase=", a.intro_phrase);
        speakIntro(a.intro_phrase, a);
      }
      lastIntroAt.set(key, cur);
    }
  }
  // GC: forget agents that have rolled out of /state
  const live = new Set();
  for (const s of state.sessions) {
    for (const a of Object.values(s.agents || {})) {
      live.add(s.session_id + ":" + a.agent_id);
    }
  }
  for (const k of Array.from(lastIntroAt.keys())) {
    if (!live.has(k)) lastIntroAt.delete(k);
  }
}

// Lightweight keep-alive that just resumes audio engines every few
// seconds. Earlier versions pumped a silent utterance through Web Speech
// to keep it warm, but on Chrome / macOS that silent utterance can leave
// `speaking=true` set forever, jamming all subsequent real speech. We
// now do recovery on-demand inside speakIntro instead.
let __keepAliveTicks = 0;
setInterval(() => {
  __keepAliveTicks++;
  if (audioCtx && audioCtx.state === "suspended") {
    try { audioCtx.resume(); } catch (e) {}
  }
  if (!("speechSynthesis" in window)) return;
  const ss = window.speechSynthesis;
  try { ss.resume(); } catch (e) {}
  if (__keepAliveTicks % 6 === 0) {
    // every ~30s: report state so we can spot a wedged engine.
    console.log("[agent-zoo] keep-alive #" + __keepAliveTicks,
                "paused=", ss.paused, "speaking=", ss.speaking, "pending=", ss.pending);
  }
}, 5000);

function maybeRingBells() {
  // ring whenever a session's ended_at transitions to a new truthy value.
  for (const s of state.sessions) {
    const prev = lastEndedAt.has(s.session_id) ? lastEndedAt.get(s.session_id) : undefined;
    const cur = s.ended_at || null;
    if (cur && cur !== prev) {
      if (firstFetchSeen) {
        console.log("[agent-zoo] session ended → ringing", s.session_id);
        playBell();
      } else {
        console.log("[agent-zoo] session was already ended at load (no chime):", s.session_id);
      }
    }
    lastEndedAt.set(s.session_id, cur);
  }
  // forget sessions that have rolled out of /state.
  const live = new Set(state.sessions.map(s => s.session_id));
  for (const sid of Array.from(lastEndedAt.keys())) {
    if (!live.has(sid)) lastEndedAt.delete(sid);
  }
  firstFetchSeen = true;
}

async function fetchState() {
  try {
    const r = await fetch("/state");
    state = await r.json();
    serverNowOffset = (Date.now() / 1000) - state.now;
    maybeCallForHelp();
    maybeSpeakIntros();
    maybeRingBells();
    resize();
  } catch (e) { /* server may briefly be down */ }
}

function maybeCallForHelp() {
  // Same first-fetch handling as intros: prime the ledger but stay silent.
  if (!firstFetchSeen) {
    for (const s of state.sessions) {
      for (const a of Object.values(s.agents || {})) {
        const key = s.session_id + ":" + a.agent_id;
        lastHelpAt.set(key, a.help_at || 0);
      }
    }
    return;
  }
  for (const s of state.sessions) {
    for (const a of Object.values(s.agents || {})) {
      const key = s.session_id + ":" + a.agent_id;
      const prev = lastHelpAt.get(key) || 0;
      const cur = a.help_at || 0;
      if (cur > prev && a.help_phrase) {
        console.log("[agent-zoo] help requested by", a.name, "→", a.help_phrase);
        // Bell first to draw the ear, then voice over the top.
        playBell();
        speakIntro(a.help_phrase, a);
      }
      lastHelpAt.set(key, cur);
    }
  }
  const live = new Set();
  for (const s of state.sessions) {
    for (const a of Object.values(s.agents || {})) live.add(s.session_id + ":" + a.agent_id);
  }
  for (const k of Array.from(lastHelpAt.keys())) {
    if (!live.has(k)) lastHelpAt.delete(k);
  }
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
  // The title row IS the prompt now, so we don't reserve a separate prompt
  // band any more.
  const agents = visibleAgents(s);
  const speechH = Math.max(1, agents.length) * ROW_H;
  return Math.max(MIN_LANE_H, TITLE_H + speechH + GROUND_H);
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
  ctx.fillStyle = THEMES[0].sky; // fallback; each lane repaints its own band
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
  // small version stamp on the header so it is obvious whether the
  // browser is rendering the latest app.js (vs a stale cached version).
  ctx.font = "8px monospace";
  ctx.fillStyle = "#a8a89c";
  ctx.fillText(APP_VERSION, 196, 12);

  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  ctx.fillStyle = COLORS.bannerText;
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
  ctx.textAlign = "left";
  ctx.fillText(`森を歩いている郵便屋さん: ${countActiveAgents()}`, 8, canvas.height - FOOTER_H + 4);
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
  const theme = THEMES[0];
  ctx.fillStyle = theme.sky;
  ctx.fillRect(0, y, W, lh - GROUND_H);
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, y + lh - GROUND_H, W, GROUND_H);
  drawGroundSpeckles(y + lh - GROUND_H, GROUND_H, theme);
  drawPath(y + lh - GROUND_H, GROUND_H, theme);
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
  ctx.fillStyle = "#dde9c8";
  ctx.fillText("Claude Code がうごくと、ここに郵便屋さんがあらわれます。", 12, y + 22);
}

function drawLane(session, yTop, lh) {
  const theme = pickTheme(session.session_id);
  const groundTop = yTop + lh - GROUND_H;

  // sky band — paint the lane's own sky color over the global background
  ctx.fillStyle = theme.sky;
  ctx.fillRect(0, yTop, W, lh - GROUND_H);

  // ground (theme-colored)
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, groundTop, W, GROUND_H);
  drawGroundSpeckles(groundTop, GROUND_H, theme);
  drawDecor(session, groundTop, theme);
  drawPath(groundTop, GROUND_H, theme);
  drawMailbox(W - 32, groundTop);

  // title row: show the user's prompt directly (the cwd was always the
  // same Mac home dir, so it carried no information for the user).
  ctx.fillStyle = COLORS.bannerBg;
  ctx.fillRect(0, yTop, W, TITLE_H);
  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "bold 10px monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const titleText = session.current_prompt
    ? "▸ " + session.current_prompt
    : "▸ まちうけ中…";
  ctx.fillText(clipText(titleText, W - 110), 6, yTop + 3);

  if (session.ended_at) {
    drawDeliveredBadge(W - 96, yTop + 2);
  }

  const speechTop = yTop + TITLE_H;

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
    // "!" mark above the head while help is recent (within 30s).
    const t = nowServer();
    if (a.help_at && (t - a.help_at) < 30) {
      drawHelpMark(charX + 6, charBaseY - stagger - bob - 4);
    }
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

// Idle phrases — when nothing has happened for a while we cycle through
// these to keep the character feeling alive. Slack microcopy vibe:
// short, gently absurd, never frustrated.
const IDLE_PHRASES = [
  "ふむふむ…",
  "ちょっと考えごと",
  "もうすこし、もうすこし",
  "ぽや〜",
  "（道草中）",
  "ぐつぐつ煮込んでます",
  "ええっと、ええっと",
  "頭のなかで整理中",
  "（耳をすませてる）",
  "んしょ、んしょ",
  "（風が気持ちいい）",
  "そろり、そろり…",
  "ちょっとだけぼーっと",
  "むむっ",
  "あれ、どこだったかな",
];

function speechFor(agent) {
  if (!agent.say) return null;
  if (agent.ended) return agent.say; // keep the delivery message
  const t = nowServer();
  // say_until was set to ~5s after the last update; if it's well in the
  // past, the agent is "idle" and we rotate through gentle phrases.
  const lastUpdate = (agent.say_until || 0) - 5;
  const elapsed = t - lastUpdate;
  if (elapsed < 12) return agent.say;
  const idx = Math.floor(t / 3) % IDLE_PHRASES.length;
  return IDLE_PHRASES[idx];
}

function drawBubbleForAgent(agent, agentIdx, speechTop, anchorX) {
  const text0 = speechFor(agent);
  if (!text0) return;

  const rowTop = speechTop + agentIdx * ROW_H;
  const rowBottom = rowTop + ROW_H - 2;
  const bubbleH = ROW_H - 6;            // ~20px
  const bubbleY = rowBottom - bubbleH;

  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  const maxW = Math.min(W - 16, 260);
  const text = clipText(text0, maxW - 10);
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

function drawGroundSpeckles(yTop, h, theme) {
  ctx.fillStyle = theme.groundDot;
  for (let i = 0; i < W; i += 3) {
    const yy = yTop + h - 14 - ((i * 7 + (yTop * 3)) % 11);
    if ((i ^ yTop) & 5) continue;
    ctx.fillRect(i, yy, 1, 1);
  }
  ctx.fillStyle = theme.groundDark;
  for (let i = 0; i < W; i += 5) {
    if ((i + yTop) % 7 < 3) continue;
    ctx.fillRect(i, yTop + h - 6, 2, 2);
  }
}

function drawPath(groundTop, groundH, theme) {
  const pathTop = groundTop + 12;
  ctx.fillStyle = theme.pathBase;
  ctx.fillRect(20, pathTop, W - 40, 14);
  ctx.fillStyle = theme.pathStone;
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

// Each entry takes (x, baseY) where baseY is roughly the top of the path
// band; the function offsets upward to plant itself on/near the ground.
const DECOR_FNS = {
  mushroom:      (x, b) => drawMushroom(x, b - 8),
  smallMushroom: (x, b) => drawSmallMushroom(x, b - 6),
  fern:          (x, b) => drawFern(x, b - 4),
  tree:          (x, b) => drawTree(x, b - 28),
  palm:          (x, b) => drawPalm(x, b - 26),
  shell:         (x, b) => drawShell(x, b - 4),
  smallStone:    (x, b) => drawSmallStone(x, b - 4),
  lantern:       (x, b) => drawLantern(x, b - 22),
  nightTree:     (x, b) => drawNightTree(x, b - 26),
  firefly:       (x, b) => drawFirefly(x, b - 16),
  star:          (x, b) => drawStar(x, b - 18),
  pine:          (x, b) => drawPine(x, b - 26),
  snowMound:     (x, b) => drawSnowMound(x, b - 6),
  snowflake:     (x, b) => drawSnowflake(x, b - 18),
  cherryTree:    (x, b) => drawCherryTree(x, b - 28),
};

function drawDecor(session, groundTop, theme) {
  const seed = stringHash(session.session_id || "x");
  const rng = mulberry32(seed);
  const count = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * (W - 80)) + 30;
    const dy = Math.floor(rng() * 4);
    const baseY = groundTop + 10 - dy;
    const name = theme.decor[Math.floor(rng() * theme.decor.length)];
    const fn = DECOR_FNS[name] || DECOR_FNS.smallMushroom;
    fn(x, baseY);
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

// --- new sprites for varied themes ---

function drawPalm(x, y) {
  // bent trunk
  ctx.fillStyle = "#7a5a32";
  ctx.fillRect(x + 4, y + 12, 2, 12);
  ctx.fillRect(x + 5, y + 8, 2, 4);
  ctx.fillRect(x + 6, y + 6, 2, 2);
  // fronds
  ctx.fillStyle = "#4a8b58";
  ctx.fillRect(x, y + 4, 5, 1);
  ctx.fillRect(x - 1, y + 5, 4, 1);
  ctx.fillRect(x + 7, y + 4, 5, 1);
  ctx.fillRect(x + 9, y + 5, 4, 1);
  ctx.fillRect(x + 1, y + 2, 4, 2);
  ctx.fillRect(x + 7, y + 2, 4, 2);
  ctx.fillRect(x + 4, y, 5, 2);
  // coconuts
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(x + 5, y + 5, 1, 1);
  ctx.fillRect(x + 7, y + 6, 1, 1);
}

function drawShell(x, y) {
  ctx.fillStyle = "#f0c4d4";
  ctx.fillRect(x + 1, y + 1, 5, 1);
  ctx.fillRect(x, y + 2, 7, 2);
  ctx.fillStyle = "#c89aae";
  ctx.fillRect(x + 1, y + 2, 1, 1);
  ctx.fillRect(x + 3, y + 1, 1, 2);
  ctx.fillRect(x + 5, y + 2, 1, 1);
  ctx.fillStyle = "#a07088";
  ctx.fillRect(x + 1, y + 4, 5, 1);
}

function drawSmallStone(x, y) {
  ctx.fillStyle = "#9b958a";
  ctx.fillRect(x, y + 1, 5, 2);
  ctx.fillRect(x + 1, y, 3, 1);
  ctx.fillStyle = "#776f64";
  ctx.fillRect(x, y + 3, 5, 1);
  ctx.fillStyle = "#bcb6ab";
  ctx.fillRect(x + 1, y + 1, 1, 1);
}

function drawLantern(x, y) {
  // post
  ctx.fillStyle = "#3b2a1c";
  ctx.fillRect(x + 4, y + 8, 2, 14);
  // lantern body
  ctx.fillStyle = "#a04a2a";
  ctx.fillRect(x + 1, y + 2, 8, 6);
  ctx.fillStyle = "#3b2a1c";
  ctx.fillRect(x, y + 1, 10, 1);
  ctx.fillRect(x, y + 8, 10, 1);
  // glow
  ctx.fillStyle = "#f6e08a";
  ctx.fillRect(x + 3, y + 4, 4, 2);
  // tiny halo dots (only readable on dark themes, harmless on light)
  ctx.fillStyle = "#f6e08a";
  ctx.fillRect(x - 1, y + 4, 1, 1);
  ctx.fillRect(x + 10, y + 4, 1, 1);
}

function drawNightTree(x, y) {
  ctx.fillStyle = "#4a3a26";
  ctx.fillRect(x + 4, y + 14, 3, 10);
  ctx.fillStyle = "#2c5a3a";
  ctx.fillRect(x, y + 6, 11, 9);
  ctx.fillRect(x + 1, y + 4, 9, 2);
  ctx.fillRect(x + 3, y + 2, 5, 2);
  ctx.fillStyle = "#1a3a2a";
  ctx.fillRect(x + 2, y + 10, 2, 2);
  ctx.fillRect(x + 7, y + 8, 2, 2);
}

function drawFirefly(x, y) {
  // small floating light
  const flick = (frame >> 3) % 2;
  ctx.fillStyle = flick ? "#f6e08a" : "#fff8c0";
  ctx.fillRect(x + 1, y + 1, 2, 2);
  ctx.fillStyle = "rgba(246, 224, 138, 0.4)";
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x + 3, y, 1, 1);
  ctx.fillRect(x, y + 3, 1, 1);
  ctx.fillRect(x + 3, y + 3, 1, 1);
}

function drawStar(x, y) {
  ctx.fillStyle = "#fdfdf2";
  ctx.fillRect(x + 1, y, 1, 3);
  ctx.fillRect(x, y + 1, 3, 1);
  ctx.fillStyle = "#a8b0d8";
  ctx.fillRect(x + 1, y + 3, 1, 1);
}

function drawPine(x, y) {
  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(x + 4, y + 18, 3, 6);
  // stacked triangles
  ctx.fillStyle = "#2a5a3a";
  ctx.fillRect(x + 2, y + 14, 7, 4);
  ctx.fillRect(x + 1, y + 12, 9, 2);
  ctx.fillStyle = "#3a6b4a";
  ctx.fillRect(x + 3, y + 8, 5, 4);
  ctx.fillRect(x + 2, y + 10, 7, 1);
  ctx.fillStyle = "#4a7c5a";
  ctx.fillRect(x + 4, y + 4, 3, 4);
  ctx.fillRect(x + 5, y + 2, 1, 2);
  // snow on top
  ctx.fillStyle = "#fdfdf2";
  ctx.fillRect(x + 5, y + 1, 1, 1);
  ctx.fillRect(x + 4, y + 5, 1, 1);
  ctx.fillRect(x + 7, y + 5, 1, 1);
  ctx.fillRect(x + 8, y + 13, 1, 1);
}

function drawSnowMound(x, y) {
  ctx.fillStyle = "#fdfdf2";
  ctx.fillRect(x, y + 2, 8, 3);
  ctx.fillRect(x + 1, y + 1, 6, 1);
  ctx.fillRect(x + 2, y, 4, 1);
  ctx.fillStyle = "#dde8f0";
  ctx.fillRect(x, y + 5, 8, 1);
}

function drawSnowflake(x, y) {
  ctx.fillStyle = "#fdfdf2";
  ctx.fillRect(x + 2, y, 1, 5);
  ctx.fillRect(x, y + 2, 5, 1);
  ctx.fillRect(x + 1, y + 1, 1, 1);
  ctx.fillRect(x + 3, y + 1, 1, 1);
  ctx.fillRect(x + 1, y + 3, 1, 1);
  ctx.fillRect(x + 3, y + 3, 1, 1);
}

function drawCherryTree(x, y) {
  // trunk
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(x + 4, y + 14, 3, 10);
  // canopy: pink puffs
  ctx.fillStyle = "#f0a8c4";
  ctx.fillRect(x, y + 4, 11, 9);
  ctx.fillRect(x + 1, y + 2, 9, 2);
  ctx.fillRect(x + 3, y, 5, 2);
  ctx.fillStyle = "#d088a8";
  ctx.fillRect(x + 1, y + 9, 2, 2);
  ctx.fillRect(x + 7, y + 6, 2, 2);
  // a couple of fallen petals
  ctx.fillStyle = "#f8c4d8";
  ctx.fillRect(x + 5, y + 12, 1, 1);
  ctx.fillRect(x + 2, y + 13, 1, 1);
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

// Pulsing "!" sign drawn above a postman that is calling for the user.
function drawHelpMark(cx, topY) {
  // Pulse: alternate two yellows by frame.
  const flash = (frame >> 3) % 2 === 0;
  ctx.fillStyle = flash ? "#ffd84a" : "#fff8c0";
  // exclamation body
  ctx.fillRect(cx - 1, topY - 8, 2, 4);
  // dot
  ctx.fillRect(cx - 1, topY - 2, 2, 2);
  // outline glints
  ctx.fillStyle = "#a0701a";
  ctx.fillRect(cx - 2, topY - 7, 1, 2);
  ctx.fillRect(cx + 1, topY - 7, 1, 2);
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
