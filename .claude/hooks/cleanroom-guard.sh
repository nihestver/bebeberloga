#!/usr/bin/env bash
# Clean-room фильтр: блокирует запись файлов со словами из запретного списка (docs/spec/GLOSSARY.md, ADR-0014).
#   Уровень 1 (товарные знаки, фирменные названия) — во всём репозитории, кроме исключений EXEMPT.
#   Уровень 2 (чужая номенклатура API) — в коде, спайках, тестах и docs/protocol/, кроме файлов локализации.
# Режимы:
#   (без аргументов)  hook PreToolUse — путь и содержимое из stdin JSON
#   --files <f...>    lefthook pre-commit — проверить указанные файлы
#   --all             CI и `just cleanroom` — проверить все файлы под git
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PATTERN_T1='discord|\bnitro\b|server.?boost|server.?subscription|\bclyde\b|wumpus|\bnelly\b|go.?live|super.?reactions?|libdave|dave.?protocol|krisp'
PATTERN_T2='\bguild|snowflake|stage.?(channel|instance)|@everyone|everyone.?role|mention.?everyone|\bhoist(ed)?\b|vanity.?url|\bautomod\b|rich.?presence|permission.?overwrite'
# Где слова перечислены намеренно: запретный список, журнал и политика clean room, рабочий план контура A,
# сам фильтр и deny-правила; бинарные файлы не проверяются.
EXEMPT='^(docs/spec/GLOSSARY\.md|docs/cleanroom/|docs/PLAN\.md|\.claude/hooks/|\.claude/settings\.json|LICENSES/)|\.(png|ico|jpe?g|webp|gif|ogg|opus|mp3|wav|woff2?|ttf|otf)$'
T2_SCOPE='^(server|crypto-core|media-engine|clients|proto|sdk|design|deploy|tools|spikes|tests)/|^docs/protocol/'
LOCALE_FILES='^clients/.*/locales/'

check_content() { # $1 = путь относительно корня; stdin = содержимое
  local content pattern="$PATTERN_T1"
  if [[ "$1" =~ $EXEMPT ]]; then cat >/dev/null; return 0; fi
  content=$(cat)
  if [[ "$1" =~ $T2_SCOPE ]] && ! [[ "$1" =~ $LOCALE_FILES ]]; then
    pattern="$PATTERN_T1|$PATTERN_T2"
  fi
  if grep -Eiq "$pattern" <<<"$content"; then
    echo "clean-room: в '$1' есть слово из запретного списка (docs/spec/GLOSSARY.md, уровень 1 или 2). Используй термин из глоссария." >&2
    return 1
  fi
}

case "${1:-}" in
  --all)
    rc=0
    while IFS= read -r f; do
      [[ -f "$ROOT/$f" ]] || continue
      check_content "$f" < "$ROOT/$f" || rc=2
    done < <(cd "$ROOT" && git ls-files)
    [[ $rc -eq 0 ]] && echo "clean-room: ok"
    exit $rc
    ;;
  --files)
    shift; rc=0
    for f in "$@"; do
      rel="${f#"$ROOT"/}"
      [[ -f "$f" ]] || continue
      check_content "$rel" < "$f" || rc=2
    done
    exit $rc
    ;;
  *)
    INPUT=$(cat)
    FILE=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")
    [[ -z "$FILE" ]] && exit 0
    REL="${FILE#"$ROOT"/}"
    [[ "$REL" == /* ]] && exit 0   # файл вне репозитория
    # Write даёт content целиком, Edit — только new_string.
    CONTENT=$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$INPUT")
    check_content "$REL" <<<"$CONTENT" || exit 2
    exit 0
    ;;
esac
