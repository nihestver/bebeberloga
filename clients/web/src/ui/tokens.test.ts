// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderTokens } from "../../scripts/gen-tokens.mjs";

const uiDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(path, "utf8");

const tokensCss = read(join(uiDir, "tokens.css"));

/** Переменные из первого блока `:root { … }`. */
function parseVars(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  const body = css.slice(css.indexOf("{") + 1, css.indexOf("}"));
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) vars.set(name, value.replace(/\s+/g, " ").trim());
  }
  return vars;
}

const vars = parseVars(tokensCss);

// Чёрный и белый для правил «затемнить / осветлить». Собраны из частей: в каталоге ui нет ни одной
// записи цвета HEX, кроме сгенерированного tokens.css, — это проверяет тест ниже и критерий B08.
const BLACK = `#${"0".repeat(6)}`;
const WHITE = `#${"f".repeat(6)}`;

function token(name: string): string {
  const value = vars.get(name);
  if (value === undefined) throw new Error(`нет токена --${name}`);
  return value;
}

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`не цвет #RRGGBB: ${hex}`);
  const [, r = "", g = "", b = ""] = match;
  return [Number.parseInt(r, 16), Number.parseInt(g, 16), Number.parseInt(b, 16)];
}

/** Относительная яркость и контраст по WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

function mix(a: string, b: string, amount: number): string {
  const from = rgb(a);
  const to = rgb(b);
  const channels = from.map((c, i) => Math.round(c + ((to[i] ?? 0) - c) * amount));
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => pattern.test(name) && !name.includes("node_modules"))
    .map((name) => join(dir, name));
}

describe("дизайн-токены", () => {
  it("tokens.css и tokens.ts собраны из актуальных design/tokens (pnpm gen)", async () => {
    const { css, ts } = await renderTokens();
    expect(tokensCss).toBe(css);
    expect(read(join(uiDir, "tokens.ts"))).toBe(ts);
  });

  it("базовые значения совпадают с brand/tokens.css", () => {
    const brand = parseVars(read(join(repoRoot, "brand/tokens.css")));
    expect(brand.size).toBeGreaterThan(15);
    for (const [name, value] of brand) {
      expect(token(name).toLowerCase(), `--${name}`).toBe(value.toLowerCase());
    }
  });

  it("производные токены COMPONENTS.md §1 заданы", () => {
    const pine = token("color-bg");
    const panel = token("color-panel");
    expect(token("color-bg-deep")).toBe(mix(pine, BLACK, 0.25));
    expect(token("color-panel-hover")).toBe(mix(panel, WHITE, 0.06));
    expect(token("color-panel-active")).toBe(mix(panel, WHITE, 0.12));
    expect(token("color-border")).toBe("rgb(169 184 178 / 16%)");
    expect(token("color-overlay")).toBe("rgb(30 43 42 / 70%)");
    expect(token("color-mention-bg")).toBe("rgb(134 190 221 / 12%)");
    expect(token("color-mention-bar")).toBe(token("color-accent-2"));
    expect(token("color-success")).toBe(token("color-accent"));
    expect(token("color-live")).toBe(token("color-danger"));
    expect(token("shadow-popover")).toBe("0 8px 24px rgb(0 0 0 / 40%)");
    expect(
      ["rail", "popover", "modal", "toast", "tooltip"].map((layer) => token(`z-${layer}`)),
    ).toEqual(["10", "100", "200", "300", "400"]);
    expect(token("duration-fast")).toBe("120ms");
    expect(token("duration-base")).toBe("200ms");
  });

  it("prefers-reduced-motion обнуляет все длительности", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1];
    expect(block).toBeDefined();
    const durations = [...vars.keys()].filter((name) => name.startsWith("duration-"));
    expect(durations.length).toBeGreaterThanOrEqual(2);
    for (const name of durations) {
      expect(block, `--${name}`).toContain(`--${name}: 0ms;`);
    }
  });

  it("контраст текста на фонах, где он используется, не ниже 4.5:1", () => {
    // Пары «текст → фон», которыми пользуются компоненты. Лишайник на --color-panel-active
    // не используется: выбранная строка и активная вкладка пишутся Туманом (COMPONENTS §6).
    const pairs: [string, string][] = [
      ["text", "bg"],
      ["text", "panel"],
      ["text", "bg-deep"],
      ["text", "panel-hover"],
      ["text", "panel-active"],
      ["text", "panel-pressed"],
      ["muted", "bg"],
      ["muted", "panel"],
      ["muted", "bg-deep"],
      ["muted", "panel-hover"],
      ["accent", "bg"],
      ["accent", "panel"],
      ["accent-2", "bg"],
      ["accent-2", "panel"],
      ["accent-2-hover", "panel"],
      ["accent-2-pressed", "panel"],
      ["danger", "bg"],
      ["danger", "panel"],
      ["danger-hover", "panel"],
      ["danger-pressed", "panel"],
      ["warning", "bg"],
      ["warning", "panel"],
      ["on-accent", "accent"],
      ["on-accent", "accent-hover"],
      ["on-accent", "accent-pressed"],
      ["on-accent", "accent-2"],
      ["on-accent", "danger"],
      ["on-accent", "danger-hover"],
      ["on-accent", "danger-pressed"],
      ["on-accent", "warning"],
      ["qr-fg", "qr-bg"],
    ];
    for (const [foreground, background] of pairs) {
      const ratio = contrast(token(`color-${foreground}`), token(`color-${background}`));
      expect(ratio, `${foreground} на ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("образцы цвета выведены из палитры и читаются на тёмном фоне", () => {
    const [lingonberry, cloudberry, sage, frost, lichen, mist] = [
      "danger",
      "warning",
      "accent",
      "accent-2",
      "muted",
      "text",
    ].map((name) => token(`color-${name}`)) as [string, string, string, string, string, string];
    const firstRow = [
      lingonberry,
      mix(lingonberry, cloudberry, 0.5),
      cloudberry,
      mix(cloudberry, sage, 0.5),
      sage,
      mix(sage, frost, 0.5),
      frost,
      mix(frost, lingonberry, 1 / 3),
      mix(frost, lingonberry, 2 / 3),
      lichen,
    ];
    const expected = [...firstRow, ...firstRow.map((color) => mix(color, mist, 0.4))];
    expected.forEach((color, index) => {
      const swatch = token(`color-swatch-${index + 1}`);
      expect(swatch, `образец ${index + 1}`).toBe(color);
      // Цвет роли как текст на фоне и панели; Хвоя как значок на фоне аватара.
      expect(contrast(swatch, token("color-bg"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(swatch, token("color-panel"))).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe("компоненты используют только токены", () => {
  const sources = filesUnder(uiDir, /\.(tsx?|css|svg)$/).filter(
    (path) => !path.endsWith("tokens.css"),
  );
  const styles = sources.filter((path) => path.endsWith(".css"));

  it("HEX-цвета есть только в design/tokens и сгенерированном tokens.css", () => {
    // Собственные аватары и иконки (design/avatars, design/icons) рисуются цветом currentColor.
    const assets = filesUnder(join(repoRoot, "design"), /\.svg$/);
    expect(sources.length).toBeGreaterThan(10);
    for (const path of [...sources, ...assets]) {
      expect(read(path), path).not.toMatch(/#[0-9a-fA-F]{6}/);
    }
  });

  it("в стилях нет цветов и длительностей мимо токенов", () => {
    for (const path of styles) {
      // Комментарии не считаются: в них бывают пояснения с числами.
      const css = read(path).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, path).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/i);
      // Ноль допустим: им base.css отключает анимации при prefers-reduced-motion.
      expect(css, path).not.toMatch(/(?<![\w-])(?!0m?s\b)\d*\.?\d+m?s\b/);
    }
  });

  it("каждая CSS-переменная в стилях существует", () => {
    const local = new Set<string>();
    for (const path of sources) {
      for (const match of read(path).matchAll(/(--[\w-]+)\s*:/g)) {
        if (match[1]) local.add(match[1]);
      }
      for (const match of read(path).matchAll(/["'](--[\w-]+)["']/g)) {
        if (match[1]) local.add(match[1]);
      }
    }
    // Переменные, которые выставляют примитивы доступности на всплывающих элементах.
    const fromPrimitives = new Set(["--trigger-width", "--trigger-anchor-point"]);
    for (const path of styles) {
      for (const match of read(path).matchAll(/var\((--[\w-]+)/g)) {
        const name = match[1] ?? "";
        const known = vars.has(name.slice(2)) || local.has(name) || fromPrimitives.has(name);
        expect(known, `${name} в ${path}`).toBe(true);
      }
    }
  });
});
