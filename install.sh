#!/usr/bin/env bash
# とここと 経営ダッシュボード — installer for macOS.
#
# Usage:
#   ./install.sh
#
# What this does:
#   1. Symlinks the server + static files into ~/.claude-agent-zoo
#   2. Symlinks the hook script into ~/.claude/hooks/agent_zoo_event.py
#   3. Merges hook entries into ~/.claude/settings.json (idempotent, with backup)
#   4. Generates a launchd plist at ~/Library/LaunchAgents/com.shioshio.agentzoo.plist
#   5. Loads it so the server starts immediately and on every login
#
# After install, open: http://127.0.0.1:7777
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.claude-agent-zoo"
HOOK_DIR="$HOME/.claude/hooks"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_NAME="com.shioshio.agentzoo.plist"
PLIST_PATH="$LAUNCH_AGENTS/$PLIST_NAME"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[agent-zoo] warning: launchd auto-start is macOS only. On non-mac, run the server manually with:"
  echo "  python3 $REPO_DIR/server/agent_zoo_server.py"
fi

echo "[agent-zoo] preparing $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$HOOK_DIR" "$LAUNCH_AGENTS"

echo "[agent-zoo] linking server"
ln -sfn "$REPO_DIR/server" "$INSTALL_DIR/server"

echo "[agent-zoo] linking hook script -> $HOOK_DIR/agent_zoo_event.py"
ln -sfn "$REPO_DIR/hooks/agent_zoo_event.py" "$HOOK_DIR/agent_zoo_event.py"

chmod +x "$REPO_DIR/server/agent_zoo_server.py" "$REPO_DIR/hooks/agent_zoo_event.py"

echo "[agent-zoo] merging hooks into ~/.claude/settings.json"
python3 "$REPO_DIR/install/merge_settings.py"

if [[ "$(uname)" == "Darwin" ]]; then
  echo "[agent-zoo] writing launchd plist -> $PLIST_PATH"
  SERVER_PATH="$INSTALL_DIR/server/agent_zoo_server.py"
  sed -e "s|__SERVER_PATH__|$SERVER_PATH|g" \
      -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
      "$REPO_DIR/launchd/$PLIST_NAME.template" > "$PLIST_PATH"

  echo "[agent-zoo] (re)loading launchd job"
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load -w "$PLIST_PATH"
fi

# Wait briefly for the server to come up
echo -n "[agent-zoo] waiting for server"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:7777/health >/dev/null 2>&1; then
    echo " — up!"
    break
  fi
  echo -n "."
  sleep 0.3
done

EXT_DIR="$REPO_DIR/extension"

cat <<EOF

✓ Installed.
  Open in your browser:  http://127.0.0.1:7777
  Logs (if anything is off):
    ~/.claude-agent-zoo/server.log
    ~/.claude-agent-zoo/server.err.log

  To also see Claude.ai chats (browser) in the dashboard:
    1. Open Chrome / Brave / Edge / Arc
    2. Visit  chrome://extensions
    3. Toggle "Developer mode" (top right)
    4. Click "Load unpacked" and choose this folder:
         $EXT_DIR
    5. Reload any open claude.ai tabs

  To uninstall:  ./uninstall.sh
EOF
