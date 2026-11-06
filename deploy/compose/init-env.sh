#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Создаёт .env рядом с собой из .env.example и вписывает случайные пароли хранилищ.
# Существующий .env не трогает: пароли уже записаны в томах данных, новые к ним не подойдут.
# Пароли на экран не выводятся.
#
#   ./init-env.sh                # создать .env; если он уже есть — ошибка
#   ./init-env.sh --if-missing   # то же, но молча выйти, если .env уже есть (для рецептов just)
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
env_file="$dir/.env"
example="$dir/.env.example"

if [ -e "$env_file" ]; then
  if [ "${1:-}" = "--if-missing" ]; then
    exit 0
  fi
  echo "$env_file уже есть — оставлен как был. Чтобы начать заново, удали его и тома данных." >&2
  exit 1
fi

# 48 шестнадцатеричных символов (192 бита): подходят и для адреса подключения, и для командной строки
secret() {
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

umask 077
tmp="$(mktemp "$dir/.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    [A-Z]*_PASSWORD=) printf '%s%s\n' "$line" "$(secret)" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$example" > "$tmp"

mv "$tmp" "$env_file"
trap - EXIT
echo "Создан $env_file со случайными паролями. Проверь в нём BB_DOMAIN."
