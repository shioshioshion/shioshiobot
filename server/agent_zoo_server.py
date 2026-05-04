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
    "そら", "あおい", "ひなた", "つむぎ", "いつき", "はる", "れん", "みお",
    "こはる", "あかり", "しおん", "なずな", "すばる", "ことね", "まひろ",
    "あさひ", "ねね", "せな", "なぎ", "いと", "すずな", "ゆずき", "ほたる",
    "しずく", "ゆうな", "あおば", "ふう", "こはく", "つぐみ", "すみれ",
    "いお", "なぎさ", "ゆきの", "やよい", "わかば", "つきの", "ひなの",
]
COLOR_POOL = [
    "#7bb274", "#a8c97f", "#c2b280", "#d9a066", "#a0a060",
    "#8fbc8f", "#6b8e23", "#9caf88", "#b9b58c", "#c8a26d",
    "#80a26c", "#bda66e",
]
PERSONALITIES = ["energetic", "calm", "shy", "playful"]

# Opening lines per personality × perceived task weight. Tone follows
# Slack's voice & tone guide — clarity first, concise, human, gently
# witty without ever tipping into kawaii / anime-trope territory. No
# "ご主人さま", restrained punctuation (one ! max, often none), short.
INTRO_PHRASES = {
    "energetic": {
        "heavy": [
            "お、これは骨ありそう。腕まくり",
            "ふむ、しっかりめのやつですね",
            "燃える系、いきます",
            "丁寧かつスピーディーに",
            "深呼吸… よし、出発",
        ],
        "light": [
            "了解、すぐ済ませます",
            "これくらいなら、すぐです",
            "お安いご用で",
            "ささっといきますね",
        ],
        "normal": [
            "了解、いってきます",
            "お預かりしました",
            "はい、出発します",
            "とりかかりますね",
        ],
    },
    "calm": {
        "heavy": [
            "丁寧に進めますね",
            "ふむ、慎重にいきます",
            "ひとつずつ、片付けます",
            "少々お時間いただきます",
            "腰を据えて取り組みます",
        ],
        "light": [
            "了解しました",
            "お任せください",
            "すぐ済みます",
            "承りました",
        ],
        "normal": [
            "では、はじめます",
            "お預かりします",
            "承知しました",
            "ぼちぼち取り掛かります",
        ],
    },
    "shy": {
        "heavy": [
            "うっ、大物… でもやってみます",
            "むずかしそう… ですが、がんばります",
            "が、がんばります",
            "ゆっくり、ですが進めます",
            "深呼吸して、いきます",
        ],
        "light": [
            "あ、これなら… たぶんすぐです",
            "やってみますね",
            "そっと、いきますね",
            "ささっと、できそうです",
        ],
        "normal": [
            "あ、はい… はじめます",
            "お、おてつだいします",
            "が、がんばります",
            "やってみます",
        ],
    },
    "playful": {
        "heavy": [
            "お、これは骨があるねえ",
            "ふふ、燃えてきた",
            "やりがいセンサー、反応中",
            "楽しそうな大物だ",
            "腕の見せどころ",
        ],
        "light": [
            "ちょちょいのちょい",
            "すぐ終わるやつだ",
            "ふふ、お安いご用",
            "らくしょう",
        ],
        "normal": [
            "ふんふん、いいですね",
            "なにしようかな",
            "よっこらしょっと",
            "とりかかりますか",
        ],
    },
}
HEAVY_KEYWORDS = (
    "戦略", "全部", "深く", "詳しく", "詳細", "しっかり", "完璧", "徹底",
    "計画", "分析", "調査", "包括", "高品質", "正確", "綿密", "並列",
    "経営", "全体", "ぜんぶ", "アナリスト", "ベンチマーク", "専門家",
    "レポート", "コンサル", "リサーチ", "監査", "セグメント", "ペルソナ",
    "ユニットエコノミクス", "GTM", "ブランディング", "リスク",
)
LIGHT_KEYWORDS = (
    "ささっと", "簡単", "教えて", "ちょっと", "確認", "見て", "ひとつ",
    "ひとこと", "短く", "サクッ", "ぱぱっと", "サクっ",
)


def task_weight(prompt):
    if not prompt:
        return "normal"
    p = str(prompt)
    n = len(p)
    if n > 180 or any(k in p for k in HEAVY_KEYWORDS):
        return "heavy"
    if n < 20 or any(k in p for k in LIGHT_KEYWORDS):
        return "light"
    return "normal"


def personality_for(seed):
    return PERSONALITIES[stable_hash("personality:" + str(seed)) % len(PERSONALITIES)]


def intro_phrase_for(personality, prompt, seed=""):
    weight = task_weight(prompt)
    phrases = (INTRO_PHRASES.get(personality) or INTRO_PHRASES["calm"]).get(
        weight, INTRO_PHRASES["calm"]["normal"]
    )
    # deterministic-by-seed pick so the same agent on the same prompt
    # always gets the same opening line (idempotent /state).
    idx = stable_hash("intro:" + str(seed) + ":" + str(prompt)[:80]) % len(phrases)
    return phrases[idx]


# Attention-grabbing lines for when Claude Code sends a Notification
# (waiting for user input / approval / answer). Personality-flavoured
# so the same character speaks consistently — and so the user can learn
# to recognise "this is so-and-so calling for me".
# Help-call lines. Slack-style: lead with a discourse marker ("うーん"/"あの"),
# admit the problem, ask without demanding. Mirrors "Hmm, that didn't work"
# and "We've got the popsicles. We just need an internet connection".
HELP_PHRASES = {
    "energetic": [
        "うーん、ここで足踏み中。見てもらえます？",
        "ちょっと判断もらえると進めます",
        "あ、これどうしよう",
        "ヘルプ。立ち止まってます",
        "ふむ、判断ポイントです",
    ],
    "calm": [
        "ご相談、いいですか",
        "ご判断、お待ちしてます",
        "ちょっと立ち止まりました",
        "うーん、判断に迷ってます",
        "確認お願いできますか",
    ],
    "shy": [
        "あの… ちょっと、止まっちゃいました",
        "うう、どうしましょう…",
        "むむ、迷ってます…",
        "あの、お知恵をください",
        "ちょっと、こわくて進めません",
    ],
    "playful": [
        "うーん、迷子になりそう",
        "あれ、止まっちゃった",
        "ご相談タイム、です",
        "ちょいと、こっちこっち",
        "ふむ、ヘルプ要請",
    ],
}

# Final-bell lines on Stop, per personality. Slack-style: warm, brief,
# never gushing. Mirrors "You're all caught up!" — quietly satisfying.
DELIVERED_PHRASES = {
    "energetic": [
        "届けました",
        "完了です",
        "おつかれさまでした",
        "ぶじゴール",
    ],
    "calm": [
        "お届け完了です",
        "ぶじ、届けました",
        "おわりました",
        "今日はこの辺で",
    ],
    "shy": [
        "あの、ぶじ届けました",
        "おわりました…",
        "なんとか、いけました",
        "ふぅ、おしまい",
    ],
    "playful": [
        "とどいた、とどいた",
        "ふふ、おしまい",
        "ぶじ完走",
        "おしまい",
    ],
}


def delivered_phrase_for(personality, seed=""):
    pool = DELIVERED_PHRASES.get(personality) or DELIVERED_PHRASES["calm"]
    idx = stable_hash("delivered:" + str(seed) + ":" + str(now())) % len(pool)
    return pool[idx]


def help_phrase_for(personality, seed=""):
    pool = HELP_PHRASES.get(personality) or HELP_PHRASES["calm"]
    idx = stable_hash("help:" + str(seed) + ":" + str(now())) % len(pool)
    return pool[idx]

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
    name = os.path.basename(str(p)) or str(p)
    # paranoid: strip any remaining slashes/spaces
    return name.strip().lstrip("/").strip()


def first_words(s, n=30):
    if not s:
        return ""
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


# Trailing fluff that adds politeness but no information; we strip these
# from the lane title so the user sees the actual mission.
_PROMPT_FLUFF = (
    "してください", "して下さい",
    "してくれませんか", "してもらえませんか",
    "してくれる？", "してくれる", "してくれない？", "してくれない",
    "してもらえる？", "してもらえる", "してもらえない？", "してもらえない",
    "してもらえますか", "してほしい", "してね", "してくれ",
    "教えてください", "教えて下さい",
    "教えてくれませんか", "教えてもらえませんか",
    "教えてくれる？", "教えてくれない？", "教えてくれない",
    "教えてもらえる？", "教えてもらえる", "教えてほしい", "教えて",
    "考えてください", "考えて下さい",
    "考えてみてください", "考えてみて", "考えてほしい", "考えて",
    "おねがいします", "お願いします", "お願いいたします", "おねがい",
    "可能でしょうか", "できますか？", "できますか", "できる？",
    "ですか？", "ですか", "でしょうか？", "でしょうか",
)


_MD_LINK_RE = __import__("re").compile(r"\[([^\]]+)\]\([^)]+\)")
_re = __import__("re")

# Topic-extraction patterns (lazy, anchored at start of the cleaned prompt).
# Tries to grab the noun phrase before a typical Japanese topic particle.
_TOPIC_PATTERNS = [
    _re.compile(r"^(.{2,25}?)について"),
    _re.compile(r"^(.{2,25}?)を"),
    _re.compile(r"^(.{2,25}?)は"),
    _re.compile(r"^(.{2,25}?)が"),
]

# Leading deictic / filler phrases that we strip off the topic so a
# request like "このように文字サイズは…" yields topic = "文字サイズ"
# rather than "このように文字サイズ".
_LEADING_DEIXIS = (
    "このように", "そのように", "あのように", "そういえば",
    "ちなみに", "まず", "まずは", "とりあえず", "ぜひ", "ちょっと",
    "今の", "次の", "この", "その", "あの",
)

# Verb-stem keywords → the abstract action label we display. The order
# matters: the first list whose keyword appears in the prompt wins.
_ACTION_VERBS = [
    ("活用検討", ("活用", "使い方", "使い道")),
    ("実装",     ("実装",)),
    ("修正",     ("直し", "直す", "直して", "修正", "修繕", "fix", "FIX")),
    ("改善",     ("改善", "改良", "良くす", "良くして", "ブラッシュアップ")),
    ("最適化",   ("最適化", "最適", "チューニング")),
    ("リファクタ", ("リファクタ", "整理しなお")),
    ("作成",     ("作って", "作る", "作成", "新規作成", "書いて", "書く",
                  "起こ", "立ち上げ", "セットアップ")),
    ("分析",     ("分析", "解析")),
    ("調査",     ("調べ", "調査", "リサーチ")),
    ("検討",     ("検討", "考えて", "考える", "考え", "プランニング")),
    ("計画",     ("計画", "ロードマップ", "スケジュール")),
    ("設計",     ("設計",)),
    ("確認",     ("確認", "チェック", "レビュー", "見て", "見る")),
    ("集計",     ("集計", "集約", "カウント")),
    ("比較",     ("比較", "見比べ", "対比")),
    ("整理",     ("まとめ", "整理", "整え", "教えて", "教える", "教え",
                  "解説", "説明")),
    ("調整",     ("大きく", "小さく", "高く", "低く", "短く", "長く",
                  "速く", "遅く", "調整", "変更", "変え", "微調整",
                  "リサイズ", "サイズ")),
    ("削除",     ("削除", "消して", "消す", "消し", "片付け")),
    ("ログ整理", ("ログ", "履歴")),
    ("テスト",   ("テスト", "test", "TEST")),
    ("デプロイ", ("デプロイ", "リリース", "公開")),
]


def _extract_topic(p):
    for pat in _TOPIC_PATTERNS:
        m = pat.match(p)
        if m:
            t = m.group(1).strip()
            # Strip leading deixis (repeatedly so chains peel)
            changed = True
            while changed:
                changed = False
                for d in _LEADING_DEIXIS:
                    if t.startswith(d):
                        t = t[len(d):]
                        changed = True
            if 2 <= len(t) <= 22:
                return t
    return None


def _detect_action(p):
    for status, kws in _ACTION_VERBS:
        for kw in kws:
            if kw in p:
                return status
    return None


def slackify_mission(text):
    """Abstract the prompt into a Slack-style "<topic>の<action>中" line.

    Returns None if it can't extract a meaningful (topic, action) pair —
    in which case the caller should fall back to raw truncation.
    """
    if not text:
        return None
    topic = _extract_topic(text)
    action = _detect_action(text)
    if topic and action:
        # Avoid awkward duplicates like "テストのテスト中" when the topic
        # noun and the action label are the same word.
        if action in topic or topic in action:
            return f"{action}中"
        return f"{topic}の{action}中"
    if action:
        return f"{action}中"
    return None


def summarize_prompt(prompt, max_chars=34):
    """Squeeze a long user prompt into a Slack-style mission line.

    First tries an abstract "<topic>の<action>中" rewrite ("Slack-y").
    Falls back to a keep-both-ends middle-truncation if no clear pattern
    is detected (so terminal output and other free-form text still
    appears, just trimmed).
    """
    if not prompt:
        return ""
    p = " ".join(str(prompt).split())
    p = _MD_LINK_RE.sub(r"\1", p)

    # Sentence-level break only (NOT 「、」 — it's still mid-sentence).
    cut_candidates = []
    for sep in ("。", "！", "？", "\n"):
        i = p.find(sep)
        if i > 0:
            cut_candidates.append(i)
    if cut_candidates:
        i = min(cut_candidates)
        if 6 < i < 240:
            p = p[:i]

    # Step A — try the abstract Slack-style rewrite.
    slacky = slackify_mission(p)
    if slacky and len(slacky) <= max_chars:
        return slacky

    # Step B — fallback: peel politeness, then middle-truncate so both
    # the topic at the start and the verb at the end remain visible.
    changed = True
    while changed:
        changed = False
        for f in _PROMPT_FLUFF:
            if p.endswith(f):
                p = p[: -len(f)]
                changed = True
        p = p.rstrip("、。 ?？!ー〜~ \t")

    if len(p) > max_chars:
        half = (max_chars - 1) // 2
        p = p[:half] + "…" + p[-(max_chars - half - 1):]
    return p


# Friendly verbs for common shell commands. The character speaks in-world
# rather than echoing raw commands or paths. Each entry is a small pool;
# bash_speech rotates through them so even repeated commands feel alive.
BASH_VERBS = {
    "mkdir": ["フォルダを作る", "場所を用意"],
    "rmdir": ["空のフォルダを片付け"],
    "cd":    ["別の場所へ移動", "場面転換"],
    "ls":    ["中身を眺める", "なにがあるか確認"],
    "pwd":   ["いまどこかな"],
    "cat":   ["中身を読んでみる", "ちらりと開く"],
    "less":  ["中身を読んでみる"],
    "head":  ["先頭をのぞく"],
    "tail":  ["末尾をのぞく"],
    "rm":    ["片付け中", "ひとつ削除"],
    "mv":    ["移動中", "場所を入れ替え"],
    "cp":    ["コピー中"],
    "touch": ["新しいファイルを一枚"],
    "echo":  ["ひとこと出力"],
    "git":   ["コミットを残す", "履歴に記録"],
    "gh":    ["GitHubへ問い合わせ"],
    "npm":   ["パッケージを整える"],
    "yarn":  ["パッケージを整える"],
    "pnpm":  ["パッケージを整える"],
    "pip":   ["パッケージを整える"],
    "pip3":  ["パッケージを整える"],
    "uv":    ["パッケージを整える"],
    "brew":  ["パッケージを整える"],
    "python":  ["スクリプトを実行"],
    "python3": ["スクリプトを実行"],
    "node":  ["スクリプトを実行"],
    "deno":  ["スクリプトを実行"],
    "bun":   ["スクリプトを実行"],
    "go":    ["スクリプトを実行"],
    "cargo": ["ビルド中"],
    "make":  ["ビルド中"],
    "curl":  ["取りに行ってきます"],
    "wget":  ["取りに行ってきます"],
    "find":  ["ファイルを探す"],
    "grep":  ["パターンを追う"],
    "rg":    ["パターンを追う"],
    "ag":    ["パターンを追う"],
    "sed":   ["置換中"],
    "awk":   ["処理中"],
    "sort":  ["並べ替え中"],
    "uniq":  ["重複を除く"],
    "wc":    ["数を数える"],
    "diff":  ["差分を確認"],
    "tar":   ["まとめて梱包"],
    "zip":   ["まとめて梱包"],
    "unzip": ["梱包をほどく"],
    "docker":  ["コンテナ操作"],
    "kubectl": ["クラスタ操作"],
    "open":  ["開きます"],
    "test":  ["テスト中", "通るかな"],
    "pytest":   ["テスト中", "通るかな"],
    "jest":     ["テスト中"],
    "vitest":   ["テスト中"],
    "tsc":      ["型チェック中"],
    "eslint":   ["スタイル確認中"],
    "prettier": ["整形中"],
    "ruff":     ["整形中"],
    "ssh":   ["別マシンへ"],
    "rsync": ["まとめて転送"],
    "scp":   ["転送中"],
    "launchctl": ["バックグラウンド操作"],
    "killall":   ["プロセスを止める"],
    "kill":      ["プロセスを止める"],
    "ps":     ["プロセスを確認"],
    "top":    ["プロセスを確認"],
    "htop":   ["プロセスを確認"],
    "sleep":  ["ちょっと一服"],
}

UNKNOWN_BASH = [
    "コマンド実行中",
    "ちょっと作業中",
    "なにか処理中",
]


def _pick_pool(pool, seed):
    if not pool:
        return ""
    return pool[stable_hash(seed) % len(pool)]


def bash_speech(cmd):
    if not cmd:
        return _pick_pool(UNKNOWN_BASH, str(cmd) + str(now()))
    parts = str(cmd).strip().split()
    if not parts:
        return _pick_pool(UNKNOWN_BASH, str(cmd) + str(now()))
    name = parts[0].rsplit("/", 1)[-1]
    if name == "sudo" and len(parts) > 1:
        name = parts[1].rsplit("/", 1)[-1]
    pool = BASH_VERBS.get(name)
    if not pool:
        return _pick_pool(UNKNOWN_BASH, str(cmd) + str(now()))
    # Rotate by command-string + timestamp so the same command from
    # different agents gets different flavor.
    return _pick_pool(pool, str(cmd) + str(now()))


def keyword_from_pattern(s):
    """Strip paths and wildcards from a Glob/Grep pattern, returning a friendly keyword."""
    if not s:
        return "なにか"
    s = str(s).strip().strip('"').strip("'")
    s = s.rsplit("/", 1)[-1]
    for ch in "*?[]{}":
        s = s.replace(ch, "")
    s = s.strip(". ")
    if not s:
        return "なにか"
    return first_words(s, 12)


READ_PHRASES   = ["「{}」を読みます", "「{}」をぱらり", "「{}」をひと通り", "「{}」をのぞきます"]
WRITE_PHRASES  = ["「{}」を書いてます", "「{}」を新規作成", "「{}」を仕上げ中"]
EDIT_PHRASES   = ["「{}」をちょっと修正", "「{}」に手を入れます", "「{}」を手直し中"]
MULTI_PHRASES  = ["「{}」を数箇所まとめて修正", "「{}」のあちこちを修正"]
WEBFETCH_PHRASES = ["外に取りに行きます", "ちょっとフェッチ中", "ネットからお取り寄せ"]
SUBSTOP_PHRASES = ["完了しました", "終わりました", "ぶじ戻りました"]


def speech_for(event_name, tool_name, tool_input):
    ti = tool_input or {}
    if event_name == "UserPromptSubmit":
        return "あたらしい手紙が届いた！"
    if event_name == "Stop":
        # Per-personality phrase is set by handle_hook; this is a fallback.
        return "ぶじ届けました…!"
    if event_name == "SessionStart":
        return "今日もおしごとはじめます"
    if event_name == "Notification":
        return "むむ、なにか呼ばれてる…"
    if event_name == "SubagentStop":
        return _pick_pool(SUBSTOP_PHRASES, "substop:" + str(now()))
    if event_name in ("PreToolUse", "PostToolUse"):
        if tool_name == "Read":
            name = short_path(ti.get("file_path", ""))
            return _pick_pool(READ_PHRASES, "read:" + name + str(now())).format(name)
        if tool_name == "Write":
            name = short_path(ti.get("file_path", ""))
            return _pick_pool(WRITE_PHRASES, "write:" + name + str(now())).format(name)
        if tool_name == "Edit":
            name = short_path(ti.get("file_path", ""))
            return _pick_pool(EDIT_PHRASES, "edit:" + name + str(now())).format(name)
        if tool_name == "MultiEdit":
            name = short_path(ti.get("file_path", ""))
            return _pick_pool(MULTI_PHRASES, "multi:" + name + str(now())).format(name)
        if tool_name == "Bash":
            return bash_speech(ti.get("command", ""))
        if tool_name == "Grep":
            return f"「{keyword_from_pattern(ti.get('pattern',''))}」のあしあとを追う"
        if tool_name == "Glob":
            return f"「{keyword_from_pattern(ti.get('pattern',''))}」のキノコを探す"
        if tool_name == "WebFetch":
            return _pick_pool(WEBFETCH_PHRASES, "webfetch:" + str(now()))
        if tool_name in ("WebSearch", "web_search"):
            q = first_words(ti.get("query", ""), 14)
            return f"「{q}」を森の外でしらべる…" if q else "もりの外をしらべる…"
        if tool_name in ("Task", "Agent"):
            d = first_words(ti.get("description", ""), 20) or "おつかい"
            return f"後輩に「{d}」を頼んだ"
        if tool_name == "TodoWrite":
            return "やることリストを整える"
        if tool_name == "NotebookEdit":
            return "ノートに書きこむ…"
        # claude.ai web chat tools (sent by the browser extension)
        if tool_name == "Thinking":
            return "うーん、考えこんでる…"
        if tool_name in ("Artifact", "create_artifact", "update_artifact"):
            return "巻物をしたためる…"
        if tool_name in ("Code", "code_execution", "repl"):
            return "まじないを唱える"
        if tool_name in ("Drive", "drive_search", "google_drive_search"):
            return "むらの倉をのぞく"
        if tool_name in ("Image", "create_image", "image_generation"):
            return "絵筆をとる…"
        if tool_name in ("ComputerUse", "computer_use"):
            return "ふしぎな道具を使ってる…"
        if tool_name and tool_name.startswith("mcp__"):
            return "ふしぎな道具を使ってる…"
        if tool_name:
            return "ちいさな道具をつかってる"
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
        is_main = agent_id == "main"
        mission = "とりまとめ役" if is_main else (label or "おつかい")
        seed = sid + agent_id
        a = {
            "agent_id": agent_id,
            "name": name_for(seed, idx),
            "color": color_for(seed, idx),
            "personality": personality_for(seed),
            "is_main": is_main,
            "progress": 0.0,
            "tool_count": 0,
            "say": "森の入口でしたくちゅう…" if is_main else "おてつだいに来ました！",
            "say_until": now() + 5,
            "active": True,
            "ended": False,
            "ended_at": None,
            "last_tool": None,
            "label": label,
            "mission": mission,
            "intro_phrase": "",
            "intro_at": 0,
            "help_phrase": "",
            "help_at": 0,
            "born_at": now(),
        }
        s["agents"][agent_id] = a
    elif label and not a.get("mission"):
        a["mission"] = label
    return a


def set_intro(agent, prompt):
    """Stamp the agent with a personality-flavoured opening line that the
    client should both display in the bubble and read aloud."""
    phrase = intro_phrase_for(agent.get("personality") or "calm", prompt or "",
                              seed=agent.get("agent_id", ""))
    agent["intro_phrase"] = phrase
    agent["intro_at"] = now()
    agent["say"] = phrase
    agent["say_until"] = now() + 8


def call_for_help(agent):
    """Stamp the agent with an attention-grabbing line. The client rings
    the bell AND speaks it, so the user notices that this session is
    waiting on them (Claude Code Notification hook)."""
    phrase = help_phrase_for(agent.get("personality") or "calm",
                             seed=agent.get("agent_id", ""))
    agent["help_phrase"] = phrase
    agent["help_at"] = now()
    agent["say"] = phrase
    agent["say_until"] = now() + 12


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
            # subagent's intro is shaped by the description it was given
            set_intro(sub, tool_input.get("description") or tool_input.get("prompt", ""))
            # main also speaks (in-world summary of having delegated)
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
                sub["ended_at"] = now()
                sub["progress"] = 1.0
                sub["say"] = speech_for(evt, None, None)
                sub["say_until"] = now() + 5
            return

        if evt == "UserPromptSubmit":
            full_prompt = payload.get("prompt", "") or ""
            s["current_prompt"] = summarize_prompt(full_prompt, max_chars=34)
            # New round: un-end the lane, drop completed subagents, reset main.
            s["ended_at"] = None
            for k in list(s["agents"].keys()):
                if k != "main" and s["agents"][k].get("ended"):
                    del s["agents"][k]
            main = s["agents"]["main"]
            main["progress"] = 0.0
            main["tool_count"] = 0
            main["ended"] = False
            main["ended_at"] = None
            main["active"] = True
            # main's intro is shaped by the full prompt (length + keywords)
            set_intro(main, full_prompt)
            return

        if evt == "Stop":
            s["ended_at"] = now()
            for a in s["agents"].values():
                if not a["ended"]:
                    a["progress"] = 1.0
                    a["ended"] = True
                    a["active"] = False
                    a["ended_at"] = now()
                    a["say"] = delivered_phrase_for(
                        a.get("personality") or "calm",
                        seed=a.get("agent_id", ""),
                    )
                    a["say_until"] = now() + 10
            return

        if evt == "SessionStart":
            return  # session already created above

        if evt == "Notification":
            # Claude Code is waiting for the user (permission prompt, idle
            # too long, etc.). Bump help_at so the client rings the bell
            # AND has the postman speak an attention line.
            call_for_help(s["agents"]["main"])
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

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
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
        # ETag based on (mtime, size) — cheap to compute, changes whenever a
        # `git pull` brings in new content. Combined with no-cache the
        # browser always revalidates, so a fresh file shows up on plain
        # reload (no need for cmd+shift+R).
        st = os.stat(path)
        etag = f'"{int(st.st_mtime * 1000):x}-{st.st_size:x}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache, must-revalidate")
            self._cors_headers()
            self.end_headers()
            return
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("ETag", etag)
        self._cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        # Allow `curl -I` and conditional GETs to inspect headers.
        return self.do_GET()

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
