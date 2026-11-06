// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Сборка дизайн-токенов: design/tokens/*.json (источник правды, формат Style Dictionary / DTCG)
// → src/ui/tokens.css (CSS-переменные) и src/ui/tokens.ts (типизированные имена, без значений цветов).
// Запуск: `pnpm gen` (его вызывает `just gen`). Тест src/ui/tokens.test.ts проверяет, что файлы свежие.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import StyleDictionary from "style-dictionary";

const tokensDir = fileURLToPath(new URL("../../../design/tokens/", import.meta.url));
const outDir = fileURLToPath(new URL("../src/ui/", import.meta.url));

/** Ключ расширения токена: производный цвет задаётся ссылкой на палитру и правилом. */
const COLOR_EXT = "org.bebeberloga.color";

/** Темы: первая — по умолчанию. Тема без заполненных цветов (светлая) в CSS не попадает. */
const THEMES = ["dark", "light"];

// Заголовок сгенерированных файлов. REUSE читает теги и в строках, поэтому блок от него скрыт.
// REUSE-IgnoreStart
const HEADER = [
  "SPDX-FileCopyrightText: 2026 Bebeberloga contributors",
  "SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception",
  "",
  "Сгенерировано из design/tokens (pnpm gen). Не править руками.",
];
// REUSE-IgnoreEnd

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`ожидался цвет #RRGGBB, получено: ${String(value)}`);
  const hex = match[1];
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * Правила производных цветов (COMPONENTS.md §1):
 *   { mix: "black" | "white", amount } — «затемнённая / осветлённая на N %»: смешивание в sRGB;
 *   { alpha } — «прозрачность N %».
 */
export function modifyColor(value, rule) {
  const rgb = parseHex(value);
  if (typeof rule.alpha === "number") {
    return `rgb(${rgb.join(" ")} / ${Math.round(rule.alpha * 100)}%)`;
  }
  if (rule.mix === "black" || rule.mix === "white") {
    const target = rule.mix === "black" ? 0 : 255;
    return toHex(rgb.map((c) => c + (target - c) * rule.amount));
  }
  throw new Error(`неизвестное правило цвета: ${JSON.stringify(rule)}`);
}

async function loadTheme(theme) {
  const sd = new StyleDictionary({
    source: ["palette.json", "core.json", "swatches.json", `themes/${theme}.json`].map(
      (file) => tokensDir + file,
    ),
    usesDtcg: true,
    log: { verbosity: "silent" },
    hooks: {
      transforms: {
        "bebeberloga/color-modify": {
          type: "value",
          transitive: true,
          filter: (token) => token.$extensions?.[COLOR_EXT] !== undefined,
          transform: (token) => modifyColor(token.$value, token.$extensions[COLOR_EXT]),
        },
      },
    },
    platforms: { web: { transforms: ["bebeberloga/color-modify"] } },
  });
  await sd.hasInitialized;
  const { allTokens } = await sd.getPlatformTokens("web");
  // Палитра — внутренняя: наружу выходят только смысловые токены.
  return allTokens
    .filter((token) => token.path[0] !== "palette")
    .map((token) => ({
      path: token.path,
      name: token.path.join("-"),
      type: token.$type,
      value: token.$value,
      description: token.$description,
    }));
}

function cssValue(token) {
  if (token.type === "color" && /^#[0-9a-f]{6}$/i.test(token.value)) {
    return token.value.toUpperCase();
  }
  return String(token.value);
}

function cssBlock(selector, tokens) {
  const lines = [];
  let group = "";
  for (const token of tokens) {
    if (token.path[0] !== group) {
      group = token.path[0];
      lines.push(`\n  /* ${group} */`);
    }
    if (token.description) lines.push(`  /* ${token.description} */`);
    lines.push(`  --${token.name}: ${cssValue(token)};`);
  }
  return `${selector} {${lines.join("\n")}\n}`;
}

function camel(segment) {
  return segment.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Вложенный объект «группа → имя → значение» по пути токена. */
function nest(tokens, leaf) {
  const root = {};
  for (const token of tokens) {
    let node = root;
    token.path.forEach((segment, i) => {
      const key = camel(segment);
      if (i === token.path.length - 1) node[key] = leaf(token);
      else node = node[key] ??= {};
    });
  }
  return root;
}

function numeric(token) {
  if (typeof token.value === "number") return token.value;
  const match = /^(-?\d+(?:\.\d+)?)(px|ms)$/.exec(token.value);
  return match ? Number(match[1]) : undefined;
}

/** Возвращает содержимое tokens.css и tokens.ts, не записывая файлы. */
export async function renderTokens() {
  const [defaultTheme, ...otherThemes] = THEMES;
  const base = await loadTheme(defaultTheme);

  const blocks = [cssBlock(`:root,\n:root[data-theme="${defaultTheme}"]`, base)];
  const filledThemes = [defaultTheme];
  for (const theme of otherThemes) {
    const themed = (await loadTheme(theme)).filter((token) => {
      const same = base.find((other) => other.name === token.name);
      return !same || same.value !== token.value;
    });
    if (themed.length === 0) continue;
    filledThemes.push(theme);
    blocks.push(cssBlock(`:root[data-theme="${theme}"]`, themed));
  }

  const durations = base.filter((token) => token.path[0] === "duration");
  blocks.push(
    [
      "/* Анимации отключены: все длительности равны нулю (COMPONENTS.md §8). */",
      "@media (prefers-reduced-motion: reduce) {",
      "  :root {",
      ...durations.map((token) => `    --${token.name}: 0ms;`),
      "  }",
      "}",
    ].join("\n"),
  );

  const css = `/*\n${HEADER.map((line) => ` * ${line}`.trimEnd()).join("\n")}\n */\n\n${blocks.join("\n\n")}\n`;

  const vars = nest(base, (token) => `var(--${token.name})`);
  const numbers = nest(
    base.filter((token) => numeric(token) !== undefined),
    numeric,
  );
  const ts = [
    ...HEADER.map((line) => `// ${line}`.trimEnd()),
    "",
    "/** Ссылки на CSS-переменные: `cssVar.color.accent` → `var(--color-accent)`. */",
    `export const cssVar = ${JSON.stringify(vars, null, 2)} as const;`,
    "",
    "/** Числовые значения токенов (px, мс, слои) — для расчётов в коде; цветов здесь нет. */",
    `export const tokenValue = ${JSON.stringify(numbers, null, 2)} as const;`,
    "",
    "/** Темы, для которых заданы значения; первая — по умолчанию. */",
    `export const themes = ${JSON.stringify(filledThemes)} as const;`,
    "",
    "export type Theme = (typeof themes)[number];",
    "export type ColorToken = keyof typeof cssVar.color;",
    "export type SpaceToken = keyof typeof cssVar.space;",
    "export type RadiusToken = keyof typeof cssVar.radius;",
    "",
  ].join("\n");

  return {
    css: await prettier.format(css, { parser: "css", printWidth: 100 }),
    ts: await prettier.format(ts, { parser: "typescript", printWidth: 100 }),
  };
}

async function writeIfChanged(file, content) {
  const current = await readFile(file, "utf8").catch(() => "");
  if (current === content) return false;
  await writeFile(file, content);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { css, ts } = await renderTokens();
  const changed = [
    (await writeIfChanged(`${outDir}tokens.css`, css)) && "tokens.css",
    (await writeIfChanged(`${outDir}tokens.ts`, ts)) && "tokens.ts",
  ].filter(Boolean);
  console.log(
    changed.length > 0 ? `tokens: обновлены ${changed.join(", ")}` : "tokens: без изменений",
  );
}
