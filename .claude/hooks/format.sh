#!/usr/bin/env bash
# PostToolUse: форматирует файл, который только что записал Claude Code.
set -euo pipefail
FILE=$(jq -r '.tool_input.file_path // empty')
[[ -f "$FILE" ]] || exit 0
has() { command -v "$1" >/dev/null 2>&1; }
case "$FILE" in
  *.go)    has gofmt   && gofmt -w "$FILE" ;;
  *.rs)    has rustfmt && rustfmt --edition 2021 "$FILE" ;;
  *.proto) has buf     && buf format -w "$FILE" ;;
  *.ts|*.tsx|*.css|*.json|*.yml|*.yaml)
           has pnpm && [[ -d "${CLAUDE_PROJECT_DIR:-.}/clients/web/node_modules" ]] \
             && (cd "${CLAUDE_PROJECT_DIR:-.}/clients/web" && pnpm exec prettier --write "$FILE" >/dev/null 2>&1) || true ;;
esac
exit 0
