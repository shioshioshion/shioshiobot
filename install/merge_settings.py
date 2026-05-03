#!/usr/bin/env python3
"""Merge agent-zoo hooks into ~/.claude/settings.json without clobbering existing config.

Idempotent: re-running won't duplicate entries.
Always writes a backup at settings.json.bak the first time it changes the file.
"""
import json
import os
import shutil
import sys

HOME = os.environ["HOME"]
SETTINGS = os.path.join(HOME, ".claude", "settings.json")
HOOK_PATH = os.path.join(HOME, ".claude", "hooks", "agent_zoo_event.py")
HOOK_CMD = f"/usr/bin/env python3 {HOOK_PATH}"

EVENTS_WITH_MATCHER = ["PreToolUse", "PostToolUse"]
EVENTS_NO_MATCHER = [
    "UserPromptSubmit", "SessionStart", "Stop", "SubagentStop",
    "Notification", "PreCompact", "SessionEnd",
]


def load():
    if not os.path.exists(SETTINGS):
        return {}
    with open(SETTINGS, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as e:
            print(f"[agent-zoo] settings.json is invalid JSON: {e}", file=sys.stderr)
            sys.exit(1)


def already_present(entries):
    for e in entries or []:
        for h in e.get("hooks", []) or []:
            cmd = h.get("command", "") or ""
            if cmd.endswith("agent_zoo_event.py") or "agent_zoo_event.py" in cmd:
                return True
    return False


def main():
    cfg = load()
    cfg.setdefault("hooks", {})

    changed = False
    for evt in EVENTS_WITH_MATCHER + EVENTS_NO_MATCHER:
        cfg["hooks"].setdefault(evt, [])
        if already_present(cfg["hooks"][evt]):
            continue
        entry = {"hooks": [{"type": "command", "command": HOOK_CMD}]}
        if evt in EVENTS_WITH_MATCHER:
            entry["matcher"] = "*"
        cfg["hooks"][evt].append(entry)
        changed = True

    if not changed:
        print("[agent-zoo] hooks already present in settings.json — nothing to do")
        return

    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    if os.path.exists(SETTINGS) and not os.path.exists(SETTINGS + ".bak"):
        shutil.copy2(SETTINGS, SETTINGS + ".bak")
        print(f"[agent-zoo] backed up existing settings to {SETTINGS}.bak")
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[agent-zoo] hooks installed in {SETTINGS}")


if __name__ == "__main__":
    main()
