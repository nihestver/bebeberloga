#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Запуск Electron со сторожем: scripts/run.sh <секунд> [аргументы electron]. Режим — в S3_MODE.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
limit="$1"; shift
env -u ELECTRON_RUN_AS_NODE npx electron . "$@" &
pid=$!
( sleep "$limit"; kill "$pid" 2>/dev/null ) &
guard=$!
wait "$pid"; code=$?
kill "$guard" 2>/dev/null
exit "$code"
