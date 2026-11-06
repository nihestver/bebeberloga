// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception
//
// Сгенерировано из design/tokens (pnpm gen). Не править руками.

/** Ссылки на CSS-переменные: `cssVar.color.accent` → `var(--color-accent)`. */
export const cssVar = {
  font: {
    heading: "var(--font-heading)",
    body: "var(--font-body)",
    mono: "var(--font-mono)",
    size: {
      heading: "var(--font-size-heading)",
      title: "var(--font-size-title)",
      body: "var(--font-size-body)",
      caption: "var(--font-size-caption)",
      small: "var(--font-size-small)",
      micro: "var(--font-size-micro)",
    },
    weight: {
      regular: "var(--font-weight-regular)",
      heading: "var(--font-weight-heading)",
      bold: "var(--font-weight-bold)",
    },
    leading: {
      tight: "var(--font-leading-tight)",
      body: "var(--font-leading-body)",
    },
  },
  radius: {
    xs: "var(--radius-xs)",
    s: "var(--radius-s)",
    m: "var(--radius-m)",
    l: "var(--radius-l)",
    full: "var(--radius-full)",
  },
  space: {
    "1": "var(--space-1)",
    "2": "var(--space-2)",
    "3": "var(--space-3)",
    "4": "var(--space-4)",
    "5": "var(--space-5)",
    "6": "var(--space-6)",
  },
  size: {
    controlM: "var(--size-control-m)",
    controlS: "var(--size-control-s)",
    controlXs: "var(--size-control-xs)",
    icon: "var(--size-icon)",
    iconS: "var(--size-icon-s)",
    iconXs: "var(--size-icon-xs)",
    border: "var(--size-border)",
    focusRing: "var(--size-focus-ring)",
    focusOffset: "var(--size-focus-offset)",
  },
  opacity: {
    disabled: "var(--opacity-disabled)",
  },
  z: {
    rail: "var(--z-rail)",
    popover: "var(--z-popover)",
    modal: "var(--z-modal)",
    toast: "var(--z-toast)",
    tooltip: "var(--z-tooltip)",
  },
  duration: {
    fast: "var(--duration-fast)",
    base: "var(--duration-base)",
    loop: "var(--duration-loop)",
  },
  shadow: {
    popover: "var(--shadow-popover)",
  },
  color: {
    swatch: {
      "1": "var(--color-swatch-1)",
      "2": "var(--color-swatch-2)",
      "3": "var(--color-swatch-3)",
      "4": "var(--color-swatch-4)",
      "5": "var(--color-swatch-5)",
      "6": "var(--color-swatch-6)",
      "7": "var(--color-swatch-7)",
      "8": "var(--color-swatch-8)",
      "9": "var(--color-swatch-9)",
      "10": "var(--color-swatch-10)",
      "11": "var(--color-swatch-11)",
      "12": "var(--color-swatch-12)",
      "13": "var(--color-swatch-13)",
      "14": "var(--color-swatch-14)",
      "15": "var(--color-swatch-15)",
      "16": "var(--color-swatch-16)",
      "17": "var(--color-swatch-17)",
      "18": "var(--color-swatch-18)",
      "19": "var(--color-swatch-19)",
      "20": "var(--color-swatch-20)",
    },
    bg: "var(--color-bg)",
    panel: "var(--color-panel)",
    accent: "var(--color-accent)",
    accent2: "var(--color-accent-2)",
    text: "var(--color-text)",
    muted: "var(--color-muted)",
    danger: "var(--color-danger)",
    warning: "var(--color-warning)",
    onAccent: "var(--color-on-accent)",
    bgDeep: "var(--color-bg-deep)",
    panelHover: "var(--color-panel-hover)",
    panelActive: "var(--color-panel-active)",
    panelPressed: "var(--color-panel-pressed)",
    border: "var(--color-border)",
    overlay: "var(--color-overlay)",
    mentionBg: "var(--color-mention-bg)",
    mentionBar: "var(--color-mention-bar)",
    success: "var(--color-success)",
    live: "var(--color-live)",
    accentHover: "var(--color-accent-hover)",
    accentPressed: "var(--color-accent-pressed)",
    accent2Hover: "var(--color-accent-2-hover)",
    accent2Pressed: "var(--color-accent-2-pressed)",
    dangerHover: "var(--color-danger-hover)",
    dangerPressed: "var(--color-danger-pressed)",
    successSoft: "var(--color-success-soft)",
    dangerSoft: "var(--color-danger-soft)",
    warningSoft: "var(--color-warning-soft)",
    successZone: "var(--color-success-zone)",
    dangerZone: "var(--color-danger-zone)",
    qrBg: "var(--color-qr-bg)",
    qrFg: "var(--color-qr-fg)",
  },
} as const;

/** Числовые значения токенов (px, мс, слои) — для расчётов в коде; цветов здесь нет. */
export const tokenValue = {
  font: {
    size: {
      heading: 28,
      title: 20,
      body: 16,
      caption: 14,
      small: 12,
      micro: 10,
    },
    weight: {
      regular: 400,
      heading: 600,
      bold: 700,
    },
    leading: {
      tight: 1.2,
      body: 1.4,
    },
  },
  radius: {
    xs: 6,
    s: 8,
    m: 12,
    l: 20,
    full: 999,
  },
  space: {
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 24,
    "6": 32,
  },
  size: {
    controlM: 40,
    controlS: 32,
    controlXs: 24,
    icon: 20,
    iconS: 18,
    iconXs: 14,
    border: 1,
    focusRing: 2,
    focusOffset: 2,
  },
  opacity: {
    disabled: 0.5,
  },
  z: {
    rail: 10,
    popover: 100,
    modal: 200,
    toast: 300,
    tooltip: 400,
  },
  duration: {
    fast: 120,
    base: 200,
    loop: 1200,
  },
} as const;

/** Темы, для которых заданы значения; первая — по умолчанию. */
export const themes = ["dark"] as const;

export type Theme = (typeof themes)[number];
export type ColorToken = keyof typeof cssVar.color;
export type SpaceToken = keyof typeof cssVar.space;
export type RadiusToken = keyof typeof cssVar.radius;
