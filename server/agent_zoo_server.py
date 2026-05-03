#!/usr/bin/env python3
"""agent-zoo: tiny local server that visualises Claude Code agent activity.

- Listens on 127.0.0.1:7777 (override with $AGENT_ZOO_PORT / $AGENT_ZOO_BIND).
- Receives Claude Code hook events at POST /event.
- Serves a static page at GET / that polls GET /state.
- Stdlib only; no external deps.
"""

import hashlib
import json
import math
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("AGENT_ZOO_PORT", "7777"))
BIND = os.environ.get("AGENT_ZOO_BIND", "127.0.0.1")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_SESSIONS = 12
ENDED_RETAIN_SEC = 90  # ended sessions linger this long for the goal animation

NAME_POOL = [
    "苔色のフィン", "蕨のミーシャ", "露草のリン", "翡翠のテオ",
    "朝霧のノエル", "木漏れ日のサシャ", "雨上がりのユイ", "胞子のクラウス",
    "こけももリリ", "風待ちのレオ", "小石のマルタ", "どんぐりのカイ",
    "針葉樹のオリ", "こもれびソラ", "森番のフェリ", "夜露のミラ",
    "若苔のジン", "枝垂れのヒナ", "こだまセラ", "下生えのトビ",
    "霧雨のアンジュ", "蔦のロビン",
]
COLOR_POOL = [
    "#7bb274", "#a8c97f", "#c2b280", "#d9a066", "#a0a060",
    "#8fbc8f", "#6b8e23", "#9caf88", "#b9b58c", "#c8a26d",
    "#80a26c", "#bda66e",
]

state_lock = threading.Lock()
sessions = {}  # session_id -> dict


def now() -> float:
    return time.time()


def stable_hash(s: str) -> int:
    return int(hashlib.md5(s.encode("utf-8")).hexdigest(), 16)


def name_for(seed: str, idx: int = 0) -> str:
    return NAME_POOL[stable_hash(f"name:{seed}:{idx}") % len(NAME_POOL)]


def color_for(seed: str, idx: int = 0) -> str:
    return COLOR_POOL[stable_hash(f"color:{seed}:{idx}") % len(COLOR_POOL)]


def short_path(p):
    if not p:
        return ""
    return os.path.basename(str(p)) or str(p)


def first_words(s, n=30):
    if not s:
        return ""
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def speech_for(event_name, tool_name, tool_input):
    ti = tool_input or {}
    if event_name == "UserPromptSubmit":
        return "あたらしい手紙が届いた！"
    if event_name == "Stop":
        return "ぶじ届けました…!"
    if event_name == "SessionStart":
        return "今日もおしごとはじめます"
    if event_name == "Notification":
        return "むむ、なにか呼ばれてる…"
    if event_name == "SubagentStop":
        return "おつかい完了です！"
    if event_name in ("PreToolUse", "PostToolUse"):
        if tool_name == "Read":
            return f"「{short_path(ti.get('file_path',''))}」のページをめくる…"
        if tool_name == "Write":
            return f"「{short_path(ti.get('file_path',''))}」へお手紙を書いてる"
        if tool_name == "Edit":
            return f"「{short_path(ti.get('file_path',''))}」をちょこっと書きなおし"
        if tool_name == "MultiEdit":
            return f"「{short_path(ti.get('file_path',''))}」を何箇所か直す"
        if tool_name == "Bash":
            return "$ " + first_words(ti.get("command", ""), 26)
        if tool_name == "Grep":
            return f"「{first_words(ti.get('pattern',''),18)}」のあしあとを追う"
        if tool_name == "Glob":
            return f"「{first_words(ti.get('pattern',''),18)}」のキノコを探す"
        if tool_name == "WebFetch":
            return "かぜのうわさをきく…"
        if tool_name == "WebSearch":
            return "もりの外をしらべる…"
        if tool_name in ("Task", "Agent"):
            d = first_words(ti.get("description", ti.get("prompt", "")), 22)
            return f"後輩に「{d}」を頼んだ"
        if tool_name == "TodoWrite":
            return "やることリストを整える"
        if tool_name == "NotebookEdit":
            return "ノートに書きこむ…"
        if tool_name and tool_name.startswith("mcp__"):
            return "ふしぎな道具を使ってる…"
        if tool_name:
            return f"{tool_name} をつかってる"
        return "なにかしてる…"
    return ""


def ensure_session(sid, cwd=""):
    s = sessions.get(sid)
    if s is None:
        s = {
            "session_id": sid,
            "short_id": (sid or "????????")[:8],
            "cwd": cwd or "",
            "started_at": now(),
            "last_event_at": now(),
            "ended_at": None,
            "tool_count": 0,
            "current_prompt": "",
            "agents": {},
        }
        sessions[sid] = s
        ensure_agent(sid, "main")
        prune_sessions()
    elif cwd and not s["cwd"]:
        s["cwd"] = cwd
    return s


def prune_sessions():
    # drop the oldest ended sessions if we exceed cap
    if len(sessions) <= MAX_SESSIONS:
        return
    ended = sorted(
        ((s["ended_at"] or s["last_event_at"], k) for k, s in sessions.items() if s["ended_at"]),
    )
    while len(sessions) > MAX_SESSIONS and ended:
        _, k = ended.pop(0)
        sessions.pop(k, None)


def gc_old_sessions():
    cutoff = now() - ENDED_RETAIN_SEC
    for k in list(sessions.keys()):
        s = sessions[k]
        if s["ended_at"] and s["ended_at"] < cutoff:
            sessions.pop(k, None)


def ensure_agent(sid, agent_id, label=""):
    s = sessions[sid]
    a = s["agents"].get(agent_id)
    if a is None:
        idx = len(s["agents"])
        a = {
            "agent_id": agent_id,
            "name": name_for(sid + agent_id, idx),
            "color": color_for(sid + agent_id, idx),
            "is_main": agent_id == "main",
            "progress": 0.0,
            "tool_count": 0,
            "say": "森の入口でしたくちゅう…" if agent_id == "main" else "おてつだいに来ました！",
            "say_until": now() + 5,
            "active": True,
            "ended": False,
            "last_tool": None,
            "label": label,
            "born_at": now(),
        }
        s["agents"][agent_id] = a
    return a


def latest_active_subagent(s):
    cands = [a for k, a in s["agents"].items() if k.startswith("sub_") and not a["ended"]]
    cands.sort(key=lambda a: a["born_at"], reverse=True)
    return cands[0] if cands else None


def handle_hook(payload):
    with state_lock:
        gc_old_sessions()
        evt = payload.get("hook_event_name") or payload.get("event") or "unknown"
        sid = payload.get("session_id") or "no-session"
        cwd = payload.get("cwd", "") or ""
        tool_name = payload.get("tool_name")
        tool_input = payload.get("tool_input") or {}

        s = ensure_session(sid, cwd)
        s["last_event_at"] = now()

        # Spawning a subagent
        if evt == "PreToolUse" and tool_name in ("Task", "Agent"):
            sub_idx = sum(1 for k in s["agents"] if k.startswith("sub_"))
            sub_id = f"sub_{sub_idx}_{int(now() * 1000) % 100000}"
            label = first_words(tool_input.get("description", ""), 20)
            sub = ensure_agent(sid, sub_id, label=label)
            sub["say"] = label or "おつかいに行ってきます！"
            sub["say_until"] = now() + 6
            # main also speaks
            main = s["agents"]["main"]
            main["say"] = speech_for(evt, tool_name, tool_input)
            main["say_until"] = now() + 6
            main["tool_count"] += 1
            s["tool_count"] += 1
            main["progress"] = 0.95 * (1 - math.exp(-main["tool_count"] / 30.0))
            return

        if evt == "SubagentStop":
            sub = latest_active_subagent(s)
            if sub:
                sub["ended"] = True
                sub["active"] = False
                sub["progress"] = 1.0
                sub["say"] = speech_for(evt, None, None)
                sub["say_until"] = now() + 5
            return

        if evt == "UserPromptSubmit":
            s["current_prompt"] = first_words(payload.get("prompt", ""), 60)
            main = s["agents"]["main"]
            main["say"] = speech_for(evt, None, None)
            main["say_until"] = now() + 5
            return

        if evt == "Stop":
            s["ended_at"] = now()
            for a in s["agents"].values():
                if not a["ended"]:
                    a["progress"] = 1.0
                    a["ended"] = True
                    a["active"] = False
                    a["say"] = speech_for("Stop", None, None)
                    a["say_until"] = now() + 8
            return

        if evt == "SessionStart":
            return  # session already created above

        if evt == "Notification":
            main = s["agents"]["main"]
            main["say"] = speech_for(evt, None, None)
            main["say_until"] = now() + 5
            return

        if evt in ("PreToolUse", "PostToolUse"):
            target = latest_active_subagent(s) or s["agents"]["main"]
            target["last_tool"] = tool_name
            target["say"] = speech_for(evt, tool_name, tool_input)
            target["say_until"] = now() + 5
            if evt == "PreToolUse":
                target["tool_count"] += 1
                s["tool_count"] += 1
                target["progress"] = 0.95 * (1 - math.exp(-target["tool_count"] / 30.0))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw):
        pass  # quiet

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel):
        rel = rel.lstrip("/")
        if not rel:
            rel = "index.html"
        path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR):
            self.send_error(403)
            return
        if not os.path.isfile(path):
            self.send_error(404)
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js":   "application/javascript; charset=utf-8",
            ".css":  "text/css; charset=utf-8",
            ".png":  "image/png",
            ".svg":  "image/svg+xml",
            ".json": "application/json",
        }.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            return self._static("index.html")
        if u.path == "/state":
            with state_lock:
                gc_old_sessions()
                return self._json(200, {"sessions": list(sessions.values()), "now": now()})
        if u.path == "/health":
            return self._json(200, {"ok": True, "sessions": len(sessions)})
        return self._static(u.path)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/event":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}
        if isinstance(payload.get("data"), str):
            try:
                inner = json.loads(payload["data"])
                if isinstance(inner, dict):
                    inner.setdefault("hook_event_name", payload.get("event"))
                    payload = inner
            except Exception:
                pass
        try:
            handle_hook(payload)
        except Exception as e:
            sys.stderr.write(f"handle_hook error: {e}\n")
        self._json(200, {"ok": True})


def run_demo():
    """Optional demo mode: emit fake events so you can see the visuals without Claude Code."""
    import random
    random.seed(0)
    sids = ["demo-aaa-1234", "demo-bbb-5678"]
    cwds = ["/Users/you/projects/shioshiobot", "/Users/you/projects/notebook"]
    files = ["server.py", "app.js", "index.html", "README.md", "config.toml"]
    for sid, cwd in zip(sids, cwds):
        handle_hook({"hook_event_name": "SessionStart", "session_id": sid, "cwd": cwd})
        handle_hook({"hook_event_name": "UserPromptSubmit", "session_id": sid,
                     "prompt": "進捗ビューアの実装を進めて"})
    while True:
        time.sleep(1.2)
        sid = random.choice(sids)
        choice = random.random()
        if choice < 0.55:
            handle_hook({"hook_event_name": "PreToolUse", "session_id": sid, "tool_name": "Read",
                         "tool_input": {"file_path": "/x/" + random.choice(files)}})
        elif choice < 0.75:
            handle_hook({"hook_event_name": "PreToolUse", "session_id": sid, "tool_name": "Bash",
                         "tool_input": {"command": "npm test --silent"}})
        elif choice < 0.85:
            handle_hook({"hook_event_name": "PreToolUse", "session_id": sid, "tool_name": "Edit",
                         "tool_input": {"file_path": "/x/" + random.choice(files)}})
        elif choice < 0.92:
            handle_hook({"hook_event_name": "PreToolUse", "session_id": sid, "tool_name": "Task",
                         "tool_input": {"description": "ビジュアル調整", "prompt": "..."}})
        elif choice < 0.96:
            handle_hook({"hook_event_name": "SubagentStop", "session_id": sid})
        else:
            handle_hook({"hook_event_name": "Stop", "session_id": sid})
            time.sleep(8)
            sessions.pop(sid, None)
            handle_hook({"hook_event_name": "SessionStart", "session_id": sid,
                         "cwd": random.choice(cwds)})


def main():
    if "--demo" in sys.argv:
        threading.Thread(target=run_demo, daemon=True).start()
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"agent-zoo listening on http://{BIND}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
