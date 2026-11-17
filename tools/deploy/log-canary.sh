#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# «Канарейка» журналов поставки (ADR-0025 п. 9, CRYPTO.md §8.3 T71): то, что прислал клиент —
# адрес, User-Agent, путь с параметрами, заголовки, — не оседает ни в журналах контейнеров, ни в
# журнале сервера. Проверяется и случай, когда сервер недоступен: тогда Caddy отвечает 502 и пишет
# запрос в свой журнал (ADR-0028 п. 1).
#
#   tools/deploy/log-canary.sh <адрес стенда> <команда compose…>
#   tools/deploy/log-canary.sh http://127.0.0.1:18089 docker compose -p bb-smoke -f … -f …
#
# Стенд должен быть поднят; скрипт останавливает и снова запускает сервис server.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "использование: $0 <адрес стенда> <команда compose…>" >&2
  exit 2
fi
base_url="$1"
shift
compose=("$@")

fail() {
  echo "log-canary: $*" >&2
  exit 1
}

# Запрос с метками во всём, что клиент может прислать. Печатает код ответа.
canary_request() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
    -A 'canary-agent/1.0' \
    -H 'X-Forwarded-For: 203.0.113.77' \
    -H 'X-Request-Id: canary-request-id' \
    -H 'Referer: http://canary-referer.invalid/' \
    -H 'Authorization: Bearer canary-token' \
    -H 'Cookie: canary-cookie=1' \
    "$base_url$1" || true
}

wait_health() {
  for _ in $(seq 1 30); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$base_url/api/v1/health" || true)" = 200 ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Путь вне контракта: маршрута с таким началом в openapi.yaml нет и не будет.
unknown_path='/api/v1/canary-unknown/canary-path?q=canary-query'

# 1. Сервер работает: известный маршрут с параметрами и неизвестный путь.
[ "$(canary_request '/api/v1/health?q=canary-query')" = 200 ] || fail "сервер не отвечает на /api/v1/health"
[ "$(canary_request "$unknown_path")" = 404 ] || fail "неизвестный путь должен дать 404"

# 2. Сервер остановлен: Caddy отвечает 502 и пишет ошибку в свой журнал.
"${compose[@]}" stop server >/dev/null 2>&1
code="$(canary_request "$unknown_path")"
"${compose[@]}" start server >/dev/null 2>&1
wait_health || fail "сервер не поднялся после перезапуска"
[ "$code" = 502 ] || fail "при остановленном сервере ожидался ответ 502, получен $code"

# 3. Журналы: контейнеров всех сервисов и файлы журнала сервера.
containers="$("${compose[@]}" logs --no-color --no-log-prefix 2>&1)"
caddy="$("${compose[@]}" logs --no-color --no-log-prefix caddy 2>&1)"
server_stdout="$("${compose[@]}" logs --no-color --no-log-prefix server 2>&1)"
server_file="$("${compose[@]}" exec -T server bebeberloga-server logs --tail 0)"

# Сценарий действительно дошёл до журналов — иначе проверка ничего не доказывает.
grep -q '"logger":"http.log.error"' <<<"$caddy" || fail "в журнале Caddy нет записи об ошибке 502: сценарий не сработал"
grep -q '"route":"/api/v1/health"' <<<"$server_file" || fail "в журнале сервера нет строки запроса /api/v1/health"
grep -q '"route":"unmatched"' <<<"$server_file" || fail "в журнале сервера нет строки запроса по неизвестному пути"

# check_absent <где> <журнал> <строка…>: ни одной из строк в журнале быть не должно.
check_absent() {
  local where="$1" log="$2" needle
  shift 2
  for needle in "$@"; do
    if grep -q -- "$needle" <<<"$log"; then
      grep -m 3 -- "$needle" <<<"$log" | cut -c1-300 >&2
      fail "«$needle» попало в журнал: $where"
    fi
  done
}

# Адрес, с которого Caddy видит клиента этого скрипта, — шлюз сети контейнера: запросы идут
# через опубликованный порт. Его не должно быть ни в одном журнале, в том числе текстом сообщения.
caddy_id="$("${compose[@]}" ps -q caddy)"
[ -n "$caddy_id" ] || fail "контейнер caddy не найден"
gateways="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' "$caddy_id")"
[ -n "${gateways// /}" ] || fail "не удалось узнать адрес шлюза сети caddy"
for gw in $gateways; do
  pattern="(^|[^0-9.])${gw//./\\.}([^0-9.]|\$)"
  for log in "$containers" "$server_file"; do
    if grep -Eq -- "$pattern" <<<"$log"; then
      grep -E -m 3 -- "$pattern" <<<"$log" | cut -c1-300 >&2
      fail "адрес клиента $gw попал в журнал"
    fi
  done
done

check_absent "журналы контейнеров" "$containers" canary 203.0.113.77
check_absent "журнал сервера" "$server_file" canary 203.0.113.77
check_absent "журнал Caddy" "$caddy" remote_ip remote_port client_ip '"uri"' '"headers"' User-Agent
# В журнал контейнера сервер пишет только строку запуска и фатальные ошибки (RETENTION.md §6).
if grep -q '"route"' <<<"$server_stdout"; then
  fail "строки запросов попали в журнал контейнера сервера"
fi
grep -q 'bebeberloga-server запускается' <<<"$server_stdout" || fail "в журнале контейнера сервера нет строки запуска"

echo "log-canary: ok"
