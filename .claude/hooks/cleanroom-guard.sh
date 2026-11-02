#!/usr/bin/env bash
# Clean-room фильтр: блокирует запись файлов со словами из запретного списка (docs/spec/GLOSSARY.md)
# в каталогах кода. Режимы:
#   (без аргументов)  hook PreToolUse — путь и содержимое из stdin JSON
#   --files <f...>    lefthook pre-commit — проверить указанные файлы
#   --all             CI — проверить все файлы под git в каталогах кода
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PATTERN='discord|\bguild\b|snowflake|\bnitro\b|\bclyde\b|wumpus|\bnelly\b|go live|\bdave\b|libdave|krisp'
CODE_DIRS='^(server|crypto-core|media-engine|clients|proto|sdk|design|deploy|tools)/'

check_content() { # $1 = путь для сообщения; stdin = содержимое
  if grep -Eiq "$PATTERN"; then
    echo "clean-room: в '$1' есть слово из запретного списка (docs/spec/GLOSSARY.md). Используй термин из глоссария." >&2
    return 1
  fi
}

case "${1:-}" in
  --all)
    rc=0
    while IFS= read -r f; do
      [[ -f "$ROOT/$f" ]] || continue
      check_content "$f" < "$ROOT/$f" || rc=2
    done < <(cd "$ROOT" && git ls-files | grep -E "$CODE_DIRS" || true)
    [[ $rc -eq 0 ]] && echo "clean-room: ok"
    exit $rc
    ;;
  --files)
    shift; rc=0
    for f in "$@"; do
      rel="${f#"$ROOT"/}"
      [[ "$rel" =~ $CODE_DIRS ]] || continue
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
    [[ "$REL" =~ $CODE_DIRS ]] || exit 0
    # Write даёт content целиком, Edit — только new_string.
    CONTENT=$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$INPUT")
    check_content "$REL" <<<"$CONTENT" || exit 2
    exit 0
    ;;
esac
