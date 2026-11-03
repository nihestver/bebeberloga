#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Потолок DS без криптографии (эмулятор клиентов на Go) → results/emul.md.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p results
ds/bin/emul -joiners "${JOINERS:-1000}" -racers 10 -race-for 5s | tee results/emul.md
