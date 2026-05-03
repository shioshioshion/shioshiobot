#!/usr/bin/env bash
# 苔むす森のおしごと便り — uninstaller for macOS.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.claude-agent-zoo"
HOOK_PATH="$HOME/.claude/hooks/agent_zoo_event.py"
PLIST_PATH="$HOME/Library/LaunchAgents/com.shioshio.agentzoo.plist"

if [[ -f "$PLIST_PATH" ]]; then
  echo "[agent-zoo] unloading launchd job"
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
fi

if [[ -L "$HOOK_PATH" || -f "$HOOK_PATH" ]]; then
  echo "[agent-zoo] removing hook symlink"
  rm -f "$HOOK_PATH"
fi

echo "[agent-zoo] removing hook entries from settings.json"
python3 "$REPO_DIR/install/unmerge_settings.py" || true

if [[ -d "$INSTALL_DIR" ]]; then
  echo "[agent-zoo] removing $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
fi

echo "✓ Uninstalled. Your settings.json.bak (if any) is left untouched."
