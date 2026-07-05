#!/usr/bin/env bash
# とここと 経営ダッシュボード — one-shot bootstrap.
#
# Designed to be run as:
#   curl -fsSL https://raw.githubusercontent.com/shioshioshion/shioshiobot/claude/agent-progress-game-cXGzB/bootstrap.sh | bash
#
# It clones (or updates) the repo and runs install.sh.
set -euo pipefail

REPO_URL="https://github.com/shioshioshion/shioshiobot.git"
BRANCH="claude/agent-progress-game-cXGzB"
DEST="${AGENT_ZOO_REPO_DIR:-$HOME/shioshiobot}"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[agent-zoo] note: this installer targets macOS. Other systems can still run install.sh manually."
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[agent-zoo] 'git' is not installed."
  echo "  macOS will offer to install the Command Line Tools when you run any git command."
  echo "  Try opening Terminal and typing:  git --version"
  echo "  Then re-run this installer."
  exit 1
fi

if [[ -d "$DEST/.git" ]]; then
  echo "[agent-zoo] updating existing checkout at $DEST"
  git -C "$DEST" fetch --quiet origin "$BRANCH"
  git -C "$DEST" checkout --quiet "$BRANCH"
  git -C "$DEST" pull --ff-only --quiet origin "$BRANCH"
else
  echo "[agent-zoo] cloning into $DEST"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$DEST"
fi

bash "$DEST/install.sh"
