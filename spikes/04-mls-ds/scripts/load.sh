#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Матрица нагрузки: 1 000 одновременных входов в одну группу настоящими клиентами OpenMLS.
# Каждый сценарий — свежий DS на очищенной базе. Итог: results/load.jsonl и results/load.md.
# Переменные: JOINERS (по умолчанию 1000), REPEAT (повторов, по умолчанию 3; в таблице —
# медиана), SCENARIOS (имена через «;», по умолчанию все), OUT (по умолчанию results/load).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p results
base="${OUT:-results/load}"
out="$base.jsonl"
: >"$out"
J="${JOINERS:-1000}"
load=client/target/release/load

# имя | флаги DS | участников-коммитеров
matrix=(
  "сразу|-batch-interval=0|3"
  "батч 0,5 с|-batch-interval=500ms|3"
  "батч 1 с|-batch-interval=1s|3"
  "батч 2 с|-batch-interval=2s|3"
  "батч 5 с|-batch-interval=5s|3"
  "сразу, max 100|-batch-interval=0 -max-batch=100|3"
  "батч 1 с, max 100|-batch-interval=1s -max-batch=100|3"
  "фронт + батч 1 с, max 100|-batch-interval=1s -max-batch=100 -leading-edge|3"
  "батч 1 с, 1 коммитер|-batch-interval=1s|1"
  "батч 1 с, 10 коммитеров|-batch-interval=1s|10"
  "сразу, lock row|-batch-interval=0 -lock=row|3"
  "батч 1 с, лимит 500 листьев|-batch-interval=1s -leaf-limit=500|3"
)
# BIG=1 — масштаб к лимиту листьев (ARCHITECTURE §4.3: 5 000): JOINERS по умолчанию 4000.
if [[ -n "${BIG:-}" ]]; then
  J="${JOINERS:-4000}"
  matrix=(
    "батч 1 с, max 100|-batch-interval=1s -max-batch=100|3"
    "батч 1 с, max 500|-batch-interval=1s -max-batch=500|3"
  )
fi
for rep in $(seq 1 "${REPEAT:-3}"); do
  for row in "${matrix[@]}"; do
    IFS='|' read -r name flags k <<<"$row"
    if [[ -n "${SCENARIOS:-}" && ";${SCENARIOS};" != *";${name};"* ]]; then continue; fi
    echo ">>> [$rep] $name ($flags, коммитеров $k)" >&2
    DS_FLAGS="$flags" scripts/with-ds.sh "$load" run --joiners "$J" --committers "$k" \
      --label "$name" --out "$out"
  done
done
"$load" summarize "$out" | tee "$base.md"
