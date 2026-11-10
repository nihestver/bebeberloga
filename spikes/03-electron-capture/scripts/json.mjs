// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// JSON в том виде, который не меняет Prettier репозитория (printWidth 100): объекты — по ключу на
// строку, массив простых значений — в одну строку, если помещается. Сгенерированные файлы results/
// проходят pre-commit без переформатирования.

const WIDTH = 100;
const simple = (v) => v === null || typeof v !== "object";

function write(value, indent, prefixLen) {
  if (simple(value)) return JSON.stringify(value);
  const pad = " ".repeat(indent + 2);
  const end = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(simple)) {
      const inline = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      // +1 — запятая после значения
      if (indent + prefixLen + inline.length + 1 <= WIDTH) return inline;
    }
    return `[\n${value.map((v) => pad + write(v, indent + 2, 0)).join(",\n")}\n${end}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([k, v]) => {
      const key = `${JSON.stringify(k)}: `;
      return pad + key + write(v, indent + 2, key.length);
    })
    .join(",\n")}\n${end}}`;
}

export const stableJson = (value) => `${write(value, 0, 0)}\n`;
