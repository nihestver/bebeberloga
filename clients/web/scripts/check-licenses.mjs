// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Проверка лицензий npm-зависимостей клиента по списку из LICENSING.md («Разрешённые лицензии
// зависимостей»). Запуск: `pnpm check-licenses` (его вызывает `just lint-licenses`).
// Данные — из `pnpm licenses list --json`: все пакеты дерева, включая транзитивные.

import { execFileSync } from "node:child_process";

/** Список LICENSING.md: MIT, BSD-2/3, 0BSD, Apache-2.0, ISC, MPL-2.0, Zlib, Unlicense, CC0, Unicode, OFL. */
const LISTED = [
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "ISC",
  "MPL-2.0",
  "Zlib",
  "Unlicense",
  "CC0-1.0",
  "Unicode-3.0",
  "OFL-1.1",
];

// Лицензии, которых в списке LICENSING.md нет, но которые встречаются только у инструментов
// разработки (ADR-0023 §6): в сборку клиента не попадают. Список здесь — не решение, а перечень
// того, что ждёт строки в LICENSING.md; у зависимости сборки такая лицензия валит проверку.
const PENDING_DEV_ONLY = [
  "BlueOak-1.0.0", // glob, minimatch, minipass, lru-cache, path-scurry
  "CC-BY-4.0", // caniuse-lite: таблицы поддержки браузеров (данные, не код)
];

/** Выражение SPDX допустимо, если допустима каждая часть AND и хотя бы одна часть OR. */
function isAllowed(expression, allowed) {
  const text = expression.replace(/^\(|\)$/g, "").trim();
  if (text.includes(" OR ")) return text.split(" OR ").some((part) => isAllowed(part, allowed));
  if (text.includes(" AND ")) return text.split(" AND ").every((part) => isAllowed(part, allowed));
  return allowed.has(text);
}

function check(scope, args, allowed) {
  const output = execFileSync("pnpm", ["licenses", "list", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicense = JSON.parse(output);
  const rejected = [];
  let total = 0;
  for (const [license, packages] of Object.entries(byLicense)) {
    total += packages.length;
    if (isAllowed(license, allowed)) continue;
    for (const pkg of packages) rejected.push(`${pkg.name}@${pkg.versions.join(", ")}: ${license}`);
  }
  if (rejected.length > 0) {
    console.error(`licenses: ${scope} — лицензия вне списка LICENSING.md:`);
    for (const line of rejected.sort()) console.error(`  ${line}`);
    return false;
  }
  console.log(`licenses: ${scope} — ok (${total} пакетов)`);
  return true;
}

const runtime = new Set(LISTED);
const everything = new Set([...runtime, ...PENDING_DEV_ONLY]);

const ok = [
  check("зависимости сборки", ["--prod"], runtime),
  check("все зависимости, включая инструменты", [], everything),
].every(Boolean);

process.exit(ok ? 0 : 1);
