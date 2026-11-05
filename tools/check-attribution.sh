#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Реестр ассетов: каждый файл-ассет под git (изображение, иконка, шрифт, звук, видео) должен быть
# строкой таблицы в ATTRIBUTION.md — путь в обратных кавычках в первой колонке. Строка для файла,
# которого нет, тоже ошибка: реестр не должен расходиться с репозиторием.
# Запуск: `just attribution` локально, job `cleanroom` в CI.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

REGISTRY="ATTRIBUTION.md"
ASSETS='\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg|ico|icns|ttf|otf|woff2?|ogg|opus|mp3|wav|flac|m4a|aac|mp4|webm|mov)$'

[[ -f "$REGISTRY" ]] || { echo "attribution: нет файла $REGISTRY" >&2; exit 2; }

# shellcheck disable=SC2016 # обратные кавычки — разметка Markdown, а не подстановка команды
listed="$(grep -oE '^\| `[^`]+`' "$REGISTRY" | sed -E 's/^\| `([^`]+)`$/\1/' | LC_ALL=C sort -u)"
tracked="$(git ls-files | grep -Ei "$ASSETS" | LC_ALL=C sort -u || true)"

missing="$(LC_ALL=C comm -23 <(printf '%s\n' "$tracked") <(printf '%s\n' "$listed") | sed '/^$/d')"
stale="$(while IFS= read -r f; do [[ -z "$f" || -e "$f" ]] || echo "$f"; done <<<"$listed")"

rc=0
if [[ -n "$missing" ]]; then
  echo "attribution: файлы-ассеты без строки в $REGISTRY (нужны автор, источник, лицензия):" >&2
  while IFS= read -r f; do echo "  $f" >&2; done <<<"$missing"
  rc=1
fi
if [[ -n "$stale" ]]; then
  echo "attribution: строки $REGISTRY для файлов, которых нет:" >&2
  while IFS= read -r f; do echo "  $f" >&2; done <<<"$stale"
  rc=1
fi
if [[ $rc -eq 0 ]]; then
  echo "attribution: ok ($(printf '%s\n' "$tracked" | sed '/^$/d' | wc -l | tr -d ' ') файлов)"
fi
exit $rc
