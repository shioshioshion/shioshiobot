#!/usr/bin/env python3
"""Forward Claude Code hook stdin to the local agent-zoo server.

Designed to never block Claude Code: short timeouts, swallowed errors,
exits 0 even on failure.
"""
import json
import os
import sys
import urllib.request

URL = os.environ.get("AGENT_ZOO_URL", "http://127.0.0.1:7777/event")
TIMEOUT = float(os.environ.get("AGENT_ZOO_TIMEOUT", "0.4"))


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
        if not isinstance(payload, dict):
            payload = {"raw": raw}
    except Exception:
        payload = {"raw": raw}

    if not payload.get("hook_event_name") and len(sys.argv) > 1:
        payload["hook_event_name"] = sys.argv[1]

    try:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
