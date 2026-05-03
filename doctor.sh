#!/usr/bin/env bash
# 苔むす森のおしごと便り — diagnostic.
# Run this if Claude Code activity is not showing up in the visualiser.
set -uo pipefail

SETTINGS="$HOME/.claude/settings.json"
HOOK_PATH="$HOME/.claude/hooks/agent_zoo_event.py"
URL="http://127.0.0.1:7777"

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
info() { printf "      → %s\n" "$1"; }

echo
echo "苔むす森のおしごと便り — 診断"
echo "================================"

# 1. Server reachable
echo
echo "[1/6] サーバーが動いているか?"
if curl -fsS "$URL/health" >/dev/null 2>&1; then
  ok "yes — $URL/health に応答あり"
else
  fail "サーバーが $URL に応答しない"
  info "再起動: launchctl kickstart -k gui/\$(id -u)/com.shioshio.agentzoo"
  info "前景で動かしてエラーを見る:"
  info "  python3 ~/.claude-agent-zoo/server/agent_zoo_server.py"
fi

# 2. Settings file
echo
echo "[2/6] ~/.claude/settings.json に hook が登録されているか?"
if [[ ! -f "$SETTINGS" ]]; then
  fail "$SETTINGS が無い"
  info "再インストール: ~/shioshiobot/install.sh"
elif ! grep -q "agent_zoo_event.py" "$SETTINGS"; then
  fail "agent_zoo_event.py への参照が無い"
  info "再インストール: ~/shioshiobot/install.sh"
else
  COUNT=$(grep -c "agent_zoo_event.py" "$SETTINGS" 2>/dev/null || echo 0)
  ok "$COUNT 個の hook エントリが登録されている"
fi

# 3. Hook script
echo
echo "[3/6] hook スクリプトが実行可能か?"
if [[ ! -e "$HOOK_PATH" ]]; then
  fail "$HOOK_PATH が無い"
  info "再インストール: ~/shioshiobot/install.sh"
elif [[ ! -x "$HOOK_PATH" ]]; then
  fail "$HOOK_PATH に実行権限が無い"
  info "修正: chmod +x $HOOK_PATH"
else
  ok "$HOOK_PATH は実行可能"
fi

# 4. End-to-end smoke test
echo
echo "[4/6] ダミーイベントを実際に発火 → サーバーに届くか?"
TEST_SID="doctor-$(date +%s)"
PAYLOAD=$(cat <<JSON
{"hook_event_name":"UserPromptSubmit","session_id":"$TEST_SID","cwd":"$HOME/diagnostic","prompt":"診断テストです"}
JSON
)
if [[ -x "$HOOK_PATH" ]]; then
  echo "$PAYLOAD" | "$HOOK_PATH" UserPromptSubmit >/dev/null 2>&1
  sleep 0.4
  if curl -fsS "$URL/state" 2>/dev/null | grep -q "$TEST_SID"; then
    ok "ダミーイベントがサーバーに届いた"
    info "ブラウザで $URL を開くと「diagnostic」レーンが見えるはず（90秒で消えます）"
    # Send a Stop so the lane will be cleaned up
    echo '{"hook_event_name":"Stop","session_id":"'$TEST_SID'"}' | "$HOOK_PATH" Stop >/dev/null 2>&1
  else
    fail "ダミーイベントがサーバーに届かない"
    info "サーバーログ: cat ~/.claude-agent-zoo/server.err.log"
  fi
else
  warn "[3] が失敗したのでスキップ"
fi

# 5. Alternative settings locations (sandboxed Claude Code Desktop)
echo
echo "[5/6] Claude Code が別の場所の settings.json を読んでないか?"
FOUND_ALT=""
for path in \
  "$HOME/Library/Containers/com.anthropic.claudecode/Data/.claude/settings.json" \
  "$HOME/Library/Containers/com.anthropic.claude-code/Data/.claude/settings.json" \
  "$HOME/Library/Containers/com.anthropic.Claude/Data/.claude/settings.json" \
  "$HOME/Library/Application Support/Claude/settings.json" \
  "$HOME/Library/Application Support/Claude Code/settings.json" \
  "$HOME/Library/Application Support/anthropic.claude/settings.json"; do
  if [[ -f "$path" ]]; then
    warn "別の settings.json を発見: $path"
    FOUND_ALT="$path"
    if grep -q "agent_zoo_event.py" "$path" 2>/dev/null; then
      ok "  (こちらにも agent-zoo hook あり)"
    else
      info "ここに hook が無い場合は、デスクトップアプリはここを読んでいる可能性"
      info "そのときは手動で同じ内容をマージするか、~/.claude/settings.json をシンボリックリンクで指す"
    fi
  fi
done
if [[ -z "$FOUND_ALT" ]]; then
  ok "別所の settings.json は見つからない（標準パスのはず）"
fi

# 6. Recent activity check
echo
echo "[6/6] サーバーが直近に受信したイベント数 (起動以降)"
SESSIONS=$(curl -fsS "$URL/state" 2>/dev/null | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  print(len(d.get('sessions',[])))
except Exception:
  print('?')
" 2>/dev/null || echo "?")
echo "  現在 $SESSIONS 個のセッションを把握"

echo
echo "================================"
echo "ぜんぶ ✓ なのにブラウザで何も見えない場合："
echo "  1. Claude Code デスクトップアプリを ⌘Q で完全終了 → 再起動"
echo "  2. なにかツールを使う作業をさせる（例: 「このフォルダ何が入ってる？」）"
echo "  3. ブラウザで $URL をリロード"
echo
echo "それでもダメなら、以下の出力を私に共有してください："
echo "  tail -n 30 ~/.claude-agent-zoo/server.log"
echo "  tail -n 30 ~/.claude-agent-zoo/server.err.log"
