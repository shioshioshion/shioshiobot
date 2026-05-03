#!/usr/bin/env python3
"""Remove agent-zoo hook entries from ~/.claude/settings.json."""
import json
import os
import sys

HOME = os.environ["HOME"]
SETTINGS = os.path.join(HOME, ".claude", "settings.json")


def main():
    if not os.path.exists(SETTINGS):
        print("[agent-zoo] no settings.json to clean")
        return
    with open(SETTINGS, "r", encoding="utf-8") as f:
        try:
            cfg = json.load(f)
        except json.JSONDecodeError as e:
            print(f"[agent-zoo] settings.json invalid: {e}", file=sys.stderr)
            sys.exit(1)

    hooks = cfg.get("hooks") or {}
    changed = False
    for evt, entries in list(hooks.items()):
        new_entries = []
        for e in entries or []:
            new_h = [h for h in e.get("hooks", []) or []
                     if "agent_zoo_event.py" not in (h.get("command") or "")]
            if new_h:
                e["hooks"] = new_h
                new_entries.append(e)
            else:
                changed = True
        hooks[evt] = new_entries
        if not new_entries:
            hooks.pop(evt, None)
            changed = True

    if not changed:
        print("[agent-zoo] no agent-zoo hooks found")
        return

    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[agent-zoo] removed agent-zoo hooks from {SETTINGS}")


if __name__ == "__main__":
    main()
