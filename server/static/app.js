// とここと 経営ダッシュボード — Canvas visualisation of Claude Code agent activity.
// 米沢みさわ小学校（廃校リノベの宿）を舞台に、生徒（転校生）が校舎の中を歩いて
// ゴール（黒板・下駄箱・校門…）へ向かう。世界観は米沢織（紅花×藍）＋校舎＋山里。
//
// Layout per session (lane):
//   ┌──────────────────────────────────────────────┐
//   │ ▸ mission summary            ていしゅつ完了 ♥ │  title (16px)
//   │ ▓ bubble row for agent 0                     │  speech zone:
//   │ ▓ bubble row for agent 1                     │   one row (26px) per agent
//   │ ▓ …                                          │   bubble border = agent body color
//   │ floor + path with 生徒 + goal(黒板/下駄箱…)  │  ground (38px)
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

// とここと palette — 米沢織の染め（紅花＝safflower / 藍＝indigo）＋生成り＋木＋黒板。
const COLORS = {
  bubble: "#f6efd9",       // 生成り — speech bubbles / text on dark
  bubbleBorder: "#26384f", // 藍 — bubble & panel borders
  text: "#2a2620",
  bannerBg: "#26384f",     // 藍 chrome — header / footer / title bars
  bannerText: "#f6efd9",   // 生成り
  // accent (紅花・safflower) — main cap, delivered badge, help "!", flags
  accent: "#d95f2b",
  accentLight: "#f0a35a",
  accentDark: "#a5401b",
  cream: "#f6efd9",
  // school/village sprite tones
  wood: "#b98a52",
  woodDark: "#7c5330",
  board: "#3a5245",        // 黒板 green
  chalk: "#f2efe2",
  mountain: "#6d8a7a",
  mountainDark: "#4f6b5c",
  // legacy aliases still referenced by shared sprites (trees/leaves)
  trunk: "#6b4a2b",
  leaves: "#5b8c4a",
  leavesShade: "#3a6b3f",
  fernGreen: "#3a6b3f",
  // legacy mail* aliases kept pointing at the accent so any stray
  // reference stays on-palette during the transition.
  mailRed: "#d95f2b",
  mailDark: "#a5401b",
  mailBeige: "#f6efd9",
};

// Each session is assigned one scene (deterministic by session_id) so the
// scenery varies but stays stable across reloads. The 生徒 (schoolkid) walker
// and the path are shared so every scene reads as "とここと・米沢みさわ小学校".
// theme[0] = 教室 is the home/default scene (used as fallback elsewhere).
const THEMES = [
  { // 0: 教室（きょうしつ） — home
    sky: "#eadfc4", ground: "#b98a52", groundDark: "#7c5330", groundDot: "#cda469",
    pathBase: "#c89a5e", pathStone: "#dcb679",
    titleDim: "#f0e6cf",
    decor: ["desk", "window", "chalkTray", "desk"],
    goal: "board",
  },
  { // 1: 校庭（放課後）
    sky: "#f4c79a", ground: "#c2a066", groundDark: "#9a7c48", groundDot: "#d8b878",
    pathBase: "#caa96e", pathStone: "#e0c48c",
    titleDim: "#f6dcc0",
    decor: ["mountains", "ironBar", "jungleGym", "cherryTree"],
    goal: "gate",
  },
  { // 2: 廊下（ろうか）
    sky: "#d8c9a8", ground: "#a5763f", groundDark: "#6f4e29", groundDot: "#c0925a",
    pathBase: "#b5854a", pathStone: "#cfa066",
    titleDim: "#e6dabc",
    decor: ["shoeLocker", "locker", "window", "locker"],
    goal: "shoeLocker",
  },
  { // 3: 焚き火の夜（たきび）
    sky: "#1a2340", ground: "#33402f", groundDark: "#212c1e", groundDot: "#556a45",
    pathBase: "#3d4a34", pathStone: "#5a6a48",
    titleDim: "#b8c0a0",
    decor: ["campfire", "logs", "tent", "grill"],
    goal: "tent",
  },
  { // 4: 星空観察（ほしぞら）
    sky: "#0d1330", ground: "#20304a", groundDark: "#131d30", groundDot: "#4a6088",
    pathBase: "#2c3d5a", pathStone: "#465e82",
    titleDim: "#bcc8f0",
    decor: ["star", "mountains", "star", "milkyway"],
    goal: "telescope",
  },
  { // 5: 織りの間（米沢織）
    sky: "#e8dcc0", ground: "#8a9c78", groundDark: "#5f6f50", groundDot: "#a4b48c",
    pathBase: "#b09a6a", pathStone: "#c8b184",
    titleDim: "#efe6cf",
    decor: ["clothRoll", "indigoVat", "spool", "clothRoll"],
    goal: "loom",
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

const APP_VERSION = "1.0-tokokoto";

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
      // Same triple as a real intro: chime first, then speech (best effort).
      playChime(pick.personality);
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

// Personality "leitmotifs" — short pitched chime sequences played on each
// intro/help event. We use these as a guaranteed audio cue: the Web
// Speech path is unreliable on Chrome / macOS (silently goes silent
// after idle), but Web Audio always plays, and chimes give each
// character a recognisable signature.
const CHIME_MOTIFS = {
  energetic: [
    { f: 880,  d: 0.07, g: 0.28 },  // A5
    { f: 1175, d: 0.07, g: 0.28 },  // D6
    { f: 1480, d: 0.16, g: 0.28 },  // F#6 (resolve high)
  ],
  calm: [
    { f: 659,  d: 0.20, g: 0.22 },  // E5
    { f: 988,  d: 0.30, g: 0.18 },  // B5 (settle)
  ],
  shy: [
    { f: 784,  d: 0.22, g: 0.16 },  // G5
    { f: 988,  d: 0.20, g: 0.10 },  // B5 (gentle)
  ],
  playful: [
    { f: 1175, d: 0.06, g: 0.22 },  // D6
    { f: 988,  d: 0.06, g: 0.22 },  // B5
    { f: 1318, d: 0.06, g: 0.22 },  // E6
    { f: 1480, d: 0.14, g: 0.26 },  // F#6 (perky)
  ],
};

function playChime(personality) {
  if (!audioEnabled) return;
  ensureAudio();
  if (!audioCtx) return;
  if (audioCtx.state !== "running") {
    console.log("[agent-zoo] chime suppressed: AudioContext state =", audioCtx.state);
    return;
  }
  const motif = CHIME_MOTIFS[personality] || CHIME_MOTIFS.calm;
  const master = audioCtx.createGain();
  master.gain.value = 0.45;
  master.connect(audioCtx.destination);
  let t = audioCtx.currentTime + 0.01;
  for (const note of motif) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = note.f;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(note.g, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + note.d);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + note.d + 0.05);
    t += note.d * 0.85; // slight overlap so it feels like a phrase
  }
  console.log("[agent-zoo] chime for", personality);
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
        // Play the personality chime FIRST. Web Audio is reliable so
        // this guarantees an audible cue even if speech synthesis later
        // fails to fire. Speech is then attempted as a bonus.
        playChime(a.personality || "calm");
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
        // For help we layer all three cues so the user notices: a
        // bell (urgent), then the personality chime (who's calling),
        // then speech (what they're saying — best effort).
        playBell();
        setTimeout(() => playChime(a.personality || "calm"), 250);
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
  ctx.fillText("とここと 経営ダッシュボード", 8, 5);
  // subtitle + small version stamp on the header so it is obvious whether
  // the browser is rendering the latest app.js (vs a stale cached version).
  ctx.font = "8px monospace";
  ctx.fillStyle = COLORS.accentLight;
  ctx.fillText("米沢みさわ小学校", 8, 19);
  ctx.fillStyle = "#8fa0b8";
  ctx.fillText(APP_VERSION, 196, 19);

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
  ctx.fillText(`登校中の生徒: ${countActiveAgents()}`, 8, canvas.height - FOOTER_H + 4);
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
  drawGoal(W - 32, y + lh - GROUND_H, theme);
  drawWindow(44, y + lh - 30);
  drawDesk(120, y + lh - 18);
  drawChalkTray(230, y + lh - 12);
  drawDesk(320, y + lh - 18);

  ctx.fillStyle = COLORS.bannerText;
  ctx.font = "10px monospace";
  ctx.textBaseline = "top";
  ctx.fillText("校舎はしずかです…", 12, y + 8);
  ctx.font = "8px monospace";
  ctx.fillStyle = COLORS.accentLight;
  ctx.fillText("Claude Code がうごくと、生徒が登校してきます。", 12, y + 22);
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
  drawGoal(W - 32, groundTop, theme);

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

// Idle phrases — Slack release-notes vibe: tiny self-deprecating
// asides, parenthetical small theatre, never demanding.
const IDLE_PHRASES = [
  "考え中…",
  "ふーむ",
  "うーん…",
  "もうちょっと",
  "頭の中で交通整理",
  "ちょっと水分補給",
  "アイデア降ってこないかな",
  "（深呼吸）",
  "（道草中）",
  "（小休止）",
  "ぐぬぬ",
  "ええっと、ええっと",
  "あれ、どこだったかな",
  "（風が涼しい）",
  "ぼちぼち",
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
  const label = "ていしゅつ完了 ♥";
  const w = Math.ceil(ctx.measureText(label).width) + 8;
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x - (w - 84), y, w, 12);
  ctx.fillStyle = COLORS.cream;
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
  // 教室
  desk:       (x, b) => drawDesk(x, b - 10),
  window:     (x, b) => drawWindow(x, b - 22),
  chalkTray:  (x, b) => drawChalkTray(x, b - 4),
  // 校庭
  mountains:  (x, b) => drawMountains(x, b - 16),
  ironBar:    (x, b) => drawIronBar(x, b - 16),
  jungleGym:  (x, b) => drawJungleGym(x, b - 16),
  cherryTree: (x, b) => drawCherryTree(x, b - 28),
  // 廊下
  shoeLocker: (x, b) => drawShoeLocker(x, b - 18),
  locker:     (x, b) => drawLocker(x, b - 22),
  // 焚き火の夜
  campfire:   (x, b) => drawCampfire(x, b - 12),
  logs:       (x, b) => drawLogs(x, b - 4),
  tent:       (x, b) => drawTent(x, b - 14),
  grill:      (x, b) => drawGrill(x, b - 10),
  // 星空
  star:       (x, b) => drawStar(x, b - 18),
  milkyway:   (x, b) => drawMilkyway(x, b - 20),
  // 織りの間
  clothRoll:  (x, b) => drawClothRoll(x, b - 8),
  indigoVat:  (x, b) => drawIndigoVat(x, b - 8),
  spool:      (x, b) => drawSpool(x, b - 6),
};

// Goal sprite (end of the path) per scene — the place the 生徒 arrives.
function drawGoal(x, y, theme) {
  switch (theme.goal) {
    case "board":      return drawBoard(x - 4, y);
    case "gate":       return drawGate(x, y);
    case "shoeLocker": return drawShoeLockerGoal(x, y);
    case "tent":       return drawTentGoal(x, y);
    case "telescope":  return drawTelescope(x, y);
    case "loom":       return drawLoom(x, y);
    default:           return drawBoard(x - 4, y);
  }
}

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

// ---- reused sprites ----

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

function drawCherryTree(x, y) {
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(x + 4, y + 14, 3, 10);
  ctx.fillStyle = "#f0a8c4";
  ctx.fillRect(x, y + 4, 11, 9);
  ctx.fillRect(x + 1, y + 2, 9, 2);
  ctx.fillRect(x + 3, y, 5, 2);
  ctx.fillStyle = "#d088a8";
  ctx.fillRect(x + 1, y + 9, 2, 2);
  ctx.fillRect(x + 7, y + 6, 2, 2);
  ctx.fillStyle = "#f8c4d8";
  ctx.fillRect(x + 5, y + 12, 1, 1);
  ctx.fillRect(x + 2, y + 13, 1, 1);
}

function drawStar(x, y) {
  const tw = (frame >> 4) % 3;
  ctx.fillStyle = tw === 0 ? "#fdfdf2" : "#e6ecff";
  ctx.fillRect(x + 1, y, 1, 3);
  ctx.fillRect(x, y + 1, 3, 1);
  ctx.fillStyle = "#a8b0d8";
  ctx.fillRect(x + 1, y + 3, 1, 1);
}

function drawFirefly(x, y) {
  const flick = (frame >> 3) % 2;
  ctx.fillStyle = flick ? "#f6e08a" : "#fff8c0";
  ctx.fillRect(x + 1, y + 1, 2, 2);
  ctx.fillStyle = "rgba(246, 224, 138, 0.4)";
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x + 3, y, 1, 1);
  ctx.fillRect(x, y + 3, 1, 1);
  ctx.fillRect(x + 3, y + 3, 1, 1);
}

// ---- とここと decor sprites ----

// 教室: 学習机
function drawDesk(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 1, y + 6, 2, 6);
  ctx.fillRect(x + 8, y + 6, 2, 6);
  ctx.fillStyle = COLORS.wood;
  ctx.fillRect(x, y + 4, 11, 3);
  ctx.fillStyle = "#e8e0c8";
  ctx.fillRect(x + 3, y + 2, 5, 2); // notebook on top
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x + 3, y + 2, 5, 1);
}

// 教室/廊下: 窓（山の見える）
function drawWindow(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y, 16, 18);
  ctx.fillStyle = "#bcd8e4";
  ctx.fillRect(x + 2, y + 2, 12, 14);
  ctx.fillStyle = COLORS.mountain;
  ctx.fillRect(x + 2, y + 10, 12, 6);
  ctx.fillStyle = COLORS.mountainDark;
  ctx.fillRect(x + 6, y + 8, 5, 2);
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 8, y + 2, 1, 14);
  ctx.fillRect(x + 2, y + 8, 12, 1);
}

// 教室: チョーク受け
function drawChalkTray(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y + 2, 10, 2);
  ctx.fillStyle = COLORS.chalk;
  ctx.fillRect(x + 1, y + 1, 3, 1);
  ctx.fillStyle = COLORS.accentLight;
  ctx.fillRect(x + 6, y + 1, 3, 1);
}

// 校庭/星空: 米沢の山並み
function drawMountains(x, y) {
  ctx.fillStyle = COLORS.mountain;
  ctx.fillRect(x, y + 8, 24, 8);
  ctx.fillRect(x + 3, y + 5, 8, 3);
  ctx.fillRect(x + 13, y + 4, 8, 4);
  ctx.fillStyle = COLORS.mountainDark;
  ctx.fillRect(x + 5, y + 3, 3, 2);
  ctx.fillRect(x + 15, y + 2, 3, 2);
  ctx.fillStyle = "#eef4f0";
  ctx.fillRect(x + 6, y + 3, 1, 1);
  ctx.fillRect(x + 16, y + 2, 1, 1);
}

// 校庭: 鉄棒
function drawIronBar(x, y) {
  ctx.fillStyle = "#9aa2a8";
  ctx.fillRect(x, y + 2, 2, 14);
  ctx.fillRect(x + 12, y + 2, 2, 14);
  ctx.fillRect(x, y + 2, 14, 2);
  ctx.fillStyle = "#c4ccd0";
  ctx.fillRect(x + 1, y + 2, 12, 1);
}

// 校庭: ジャングルジム
function drawJungleGym(x, y) {
  ctx.fillStyle = "#5a9bb0";
  for (let i = 0; i <= 12; i += 6) ctx.fillRect(x + i, y, 1, 16);
  for (let j = 0; j <= 16; j += 5) ctx.fillRect(x, y + j, 13, 1);
}

// 廊下: 下駄箱（小・装飾）
function drawShoeLocker(x, y) {
  ctx.fillStyle = COLORS.wood;
  ctx.fillRect(x, y, 14, 18);
  ctx.fillStyle = COLORS.woodDark;
  for (let j = 0; j <= 18; j += 6) ctx.fillRect(x, y + j, 14, 1);
  for (let i = 0; i <= 14; i += 7) ctx.fillRect(x + i, y, 1, 18);
}

// 廊下: ロッカー
function drawLocker(x, y) {
  ctx.fillStyle = "#8a9aa0";
  ctx.fillRect(x, y, 8, 22);
  ctx.fillStyle = "#6c7c82";
  ctx.fillRect(x, y, 8, 1);
  ctx.fillRect(x, y + 11, 8, 1);
  ctx.fillStyle = "#3a4448";
  ctx.fillRect(x + 6, y + 4, 1, 2);
  ctx.fillRect(x + 6, y + 15, 1, 2);
}

// 焚き火の夜: 焚き火（アニメ）
function drawCampfire(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y + 8, 12, 3);
  ctx.fillRect(x + 1, y + 10, 10, 2);
  const t = (frame >> 2) % 2;
  ctx.fillStyle = "#e0662f";
  ctx.fillRect(x + 3, y + 2, 6, 7);
  ctx.fillStyle = "#f0a35a";
  ctx.fillRect(x + 4, y + 4, 4, 5);
  ctx.fillStyle = "#f6e08a";
  ctx.fillRect(x + 5, y + (t ? 5 : 4), 2, 3);
  ctx.fillStyle = "#ffd84a";
  ctx.fillRect(x + (t ? 6 : 4), y, 1, 1);
}

// 焚き火の夜: 薪
function drawLogs(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y + 2, 10, 2);
  ctx.fillRect(x + 1, y, 8, 2);
  ctx.fillStyle = "#c8a878";
  ctx.fillRect(x + 1, y + 2, 1, 2);
  ctx.fillRect(x + 8, y + 2, 1, 2);
}

// 焚き火の夜: テント（小・装飾）
function drawTent(x, y) {
  ctx.fillStyle = "#c86a3a";
  for (let r = 0; r < 8; r++) {
    const w = 1 + r;
    ctx.fillRect(x + 5 - Math.floor(w / 2), y + r, w, 1);
  }
  ctx.fillRect(x - 1, y + 8, 12, 1);
  ctx.fillStyle = "#8a3f22";
  ctx.fillRect(x + 4, y + 4, 2, 4);
}

// 焚き火の夜: 米沢牛グリル
function drawGrill(x, y) {
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x, y + 4, 12, 3);
  ctx.fillStyle = "#5a5a5a";
  ctx.fillRect(x, y + 3, 12, 1);
  ctx.fillStyle = "#7c5330";
  ctx.fillRect(x + 3, y + 2, 2, 1);
  ctx.fillRect(x + 7, y + 2, 2, 1);
  ctx.fillStyle = "#e0662f";
  ctx.fillRect(x + 2, y + 5, 1, 1);
  ctx.fillRect(x + 8, y + 5, 1, 1);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x + 1, y + 7, 1, 3);
  ctx.fillRect(x + 10, y + 7, 1, 3);
}

// 星空: 天の川
function drawMilkyway(x, y) {
  ctx.fillStyle = "#c8d0f0";
  ctx.fillRect(x, y + 4, 14, 1);
  ctx.fillRect(x + 2, y + 3, 10, 1);
  ctx.fillStyle = "#fdfdf2";
  ctx.fillRect(x + 3, y + 4, 1, 1);
  ctx.fillRect(x + 7, y + 3, 1, 1);
  ctx.fillRect(x + 11, y + 4, 1, 1);
}

// 織りの間: 反物（米沢織）
function drawClothRoll(x, y) {
  ctx.fillStyle = "#26384f"; // 藍
  ctx.fillRect(x, y, 10, 6);
  ctx.fillStyle = "#d95f2b"; // 紅花
  ctx.fillRect(x, y + 2, 10, 1);
  ctx.fillStyle = COLORS.cream;
  ctx.fillRect(x, y + 4, 10, 1);
  ctx.fillStyle = "#1a2740";
  ctx.fillRect(x, y, 1, 6);
  ctx.fillRect(x + 9, y, 1, 6);
}

// 織りの間: 藍甕
function drawIndigoVat(x, y) {
  ctx.fillStyle = "#4a3a2a";
  ctx.fillRect(x, y + 2, 10, 6);
  ctx.fillRect(x + 1, y + 1, 8, 1);
  ctx.fillStyle = "#26384f";
  ctx.fillRect(x + 2, y + 2, 6, 2);
  ctx.fillStyle = "#3a5a7d";
  ctx.fillRect(x + 3, y + 2, 2, 1);
}

// 織りの間: 糸巻き
function drawSpool(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y, 6, 1);
  ctx.fillRect(x, y + 5, 6, 1);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x + 1, y + 1, 4, 4);
  ctx.fillStyle = COLORS.accentLight;
  ctx.fillRect(x + 1, y + 2, 4, 1);
}

// ---- goal sprites (end of the path) ----

// 黒板（教室のゴール）
function drawBoard(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 2, y + 16, 2, 10);
  ctx.fillRect(x + 14, y + 16, 2, 10);
  ctx.fillStyle = COLORS.wood;
  ctx.fillRect(x, y, 18, 18);
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(x + 2, y + 2, 14, 14);
  ctx.fillStyle = COLORS.chalk;
  ctx.fillRect(x + 4, y + 5, 8, 1);
  ctx.fillRect(x + 4, y + 8, 6, 1);
  ctx.fillStyle = COLORS.accentLight; // ✓
  ctx.fillRect(x + 11, y + 10, 1, 2);
  ctx.fillRect(x + 12, y + 11, 1, 1);
  ctx.fillRect(x + 13, y + 9, 1, 3);
}

// 校門（校庭のゴール・とここと表札）
function drawGate(x, y) {
  ctx.fillStyle = "#8a7a68";
  ctx.fillRect(x, y + 2, 3, 24);
  ctx.fillRect(x + 11, y + 2, 3, 24);
  ctx.fillStyle = "#a89a86";
  ctx.fillRect(x, y + 2, 3, 1);
  ctx.fillRect(x + 11, y + 2, 3, 1);
  ctx.fillStyle = COLORS.cream; // 表札
  ctx.fillRect(x - 2, y + 8, 4, 8);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x - 2, y + 8, 4, 1);
  ctx.fillStyle = COLORS.text;
  ctx.fillRect(x, y + 10, 1, 1);
  ctx.fillRect(x, y + 12, 1, 1);
  ctx.fillRect(x, y + 14, 1, 1);
}

// 下駄箱（廊下のゴール）
function drawShoeLockerGoal(x, y) {
  ctx.fillStyle = COLORS.wood;
  ctx.fillRect(x, y + 2, 14, 24);
  ctx.fillStyle = COLORS.woodDark;
  for (let j = 2; j <= 26; j += 6) ctx.fillRect(x, y + j, 14, 1);
  for (let i = 0; i <= 14; i += 7) ctx.fillRect(x + i, y + 2, 1, 24);
  ctx.fillStyle = COLORS.accentLight; // うわばき
  ctx.fillRect(x + 2, y + 5, 4, 2);
}

// テント（焚き火のゴール）
function drawTentGoal(x, y) {
  ctx.fillStyle = "#c86a3a";
  for (let r = 0; r < 12; r++) {
    const w = 1 + r;
    ctx.fillRect(x + 7 - Math.floor(w / 2), y + r, w, 1);
  }
  ctx.fillRect(x, y + 12, 14, 1);
  ctx.fillStyle = "#8a3f22";
  ctx.fillRect(x + 6, y + 6, 3, 6);
  ctx.fillStyle = COLORS.accent; // 旗
  ctx.fillRect(x + 7, y - 2, 3, 2);
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 7, y - 2, 1, 3);
}

// 望遠鏡（星空のゴール）
function drawTelescope(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x + 4, y + 12, 2, 12);
  ctx.fillRect(x + 1, y + 20, 2, 5);
  ctx.fillRect(x + 8, y + 20, 2, 5);
  ctx.fillStyle = "#4a5a8a";
  ctx.fillRect(x + 4, y + 8, 8, 3);
  ctx.fillRect(x + 9, y + 6, 3, 3);
  ctx.fillStyle = "#6a7aaa";
  ctx.fillRect(x + 4, y + 8, 8, 1);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x + 11, y + 5, 2, 2);
}

// 機織り機（織りの間のゴール）
function drawLoom(x, y) {
  ctx.fillStyle = COLORS.woodDark;
  ctx.fillRect(x, y + 2, 2, 24);
  ctx.fillRect(x + 12, y + 2, 2, 24);
  ctx.fillRect(x, y + 2, 14, 2);
  ctx.fillRect(x, y + 14, 14, 2);
  ctx.fillStyle = COLORS.cream; // 経糸
  for (let i = 3; i < 12; i += 2) ctx.fillRect(x + i, y + 4, 1, 10);
  ctx.fillStyle = "#26384f"; // 織り上がり（藍）
  ctx.fillRect(x + 2, y + 10, 10, 4);
  ctx.fillStyle = COLORS.accent; // 紅花の一筋
  ctx.fillRect(x + 2, y + 12, 10, 1);
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

// 生徒（転校生） — walks to the right. ランドセル on the back (left edge),
// 通学帽 (main = yellow) / 赤白帽 (sub) on the head. Body = agent color.
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

  // ランドセル on the back (facing right → back is the left edge)
  const satchel = isMain ? COLORS.accent : shade(color, -35);
  ctx.fillStyle = satchel;
  ctx.fillRect(x, y + 6, 3, 7);
  ctx.fillStyle = shade(satchel, -22);
  ctx.fillRect(x, y + 6, 3, 1);
  ctx.fillRect(x, y + 12, 3, 1);
  ctx.fillRect(x + 1, y + 9, 2, 1); // flap seam

  // body (私服/体操服) — uses agent color
  ctx.fillStyle = color;
  ctx.fillRect(x + 3, y + 7, 7, 6);
  ctx.fillStyle = shade(color, -25);
  ctx.fillRect(x + 3, y + 12, 7, 1);
  ctx.fillStyle = shade(color, -40);
  ctx.fillRect(x + 4, y + 7, 4, 1);

  // head
  ctx.fillStyle = "#f6dfa9";
  ctx.fillRect(x + 3, y + 3, 6, 5);
  ctx.fillStyle = "#3b2b1a";
  ctx.fillRect(x + 5, y + 5, 1, 1);
  ctx.fillRect(x + 7, y + 5, 1, 1);

  if (isMain) {
    // 黄色い通学帽
    ctx.fillStyle = "#f4c531";
    ctx.fillRect(x + 2, y + 1, 8, 2);
    ctx.fillRect(x + 1, y + 2, 11, 1); // brim
    ctx.fillStyle = "#d9a417";
    ctx.fillRect(x + 2, y + 2, 8, 1);
    ctx.fillStyle = "#fff0b0";
    ctx.fillRect(x + 5, y + 1, 2, 1);
  } else {
    // 赤白帽
    ctx.fillStyle = "#d0463a";
    ctx.fillRect(x + 2, y + 1, 8, 2);
    ctx.fillRect(x + 1, y + 2, 11, 1);
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(x + 2, y + 2, 8, 1); // white band
  }
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
