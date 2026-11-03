#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Запустить DS с флагами из $DS_FLAGS на чистой базе, выполнить команду, остановить DS.
# Пример: DS_FLAGS="-batch-interval=1s" scripts/with-ds.sh client/target/release/load ...
set -euo pipefail
cd "$(dirname "$0")/.."
addr="${DS_ADDR:-127.0.0.1:8484}"
# shellcheck disable=SC2086
ds/bin/ds -addr "$addr" -reset ${DS_FLAGS:-} 2>>"${DS_LOG:-/dev/null}" &
pid=$!
trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
  if curl -fsS "http://$addr/v1/external-sender" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
"$@"
