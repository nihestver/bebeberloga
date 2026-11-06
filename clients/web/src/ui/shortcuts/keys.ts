// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Сочетания клавиш: разбор записи из SHORTCUTS.md («Mod+Shift+K»), сравнение с событием клавиатуры
// и подписи для капсул Kbd.

export type Platform = "mac" | "other";

/**
 * Сочетание клавиш. Если нажатая клавиша печатает латинскую букву или цифру, сравнение идёт по
 * символу (`key`): на AZERTY и QWERTZ «Mod+A» — это клавиша с буквой A. Иначе (русская и другие
 * нелатинские раскладки, знаки) — по физической клавише (`code`): «Mod+K» срабатывает на клавише,
 * которая печатает «л». В `code` хранится каноническое имя: `KeyK`, `Digit1`, `BracketLeft`.
 */
export interface KeyCombo {
  /** `Cmd` на macOS, `Ctrl` на Windows и Linux. */
  mod?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Физическая клавиша: значение `KeyboardEvent.code` («KeyK», «ArrowUp», «BracketLeft»). */
  code?: string;
  /** Символ `KeyboardEvent.key` — только для клавиш, чьё место зависит от раскладки («+»). */
  key?: string;
}

/** Минимум полей события клавиатуры, нужный для сравнения. */
export interface KeyEventLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_TOKENS = new Set(["Mod", "Ctrl", "Meta", "Alt", "Shift"]);

/** Имена клавиш в записи сочетания → `KeyboardEvent.code`. */
const NAMED_CODES: Record<string, string> = {
  Esc: "Escape",
  Escape: "Escape",
  Enter: "Enter",
  Tab: "Tab",
  Space: "Space",
  Backspace: "Backspace",
  Delete: "Delete",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Home: "Home",
  End: "End",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "\\": "Backslash",
  "-": "Minus",
  "=": "Equal",
};

/**
 * Разбирает запись вида «Mod+Shift+K». Клавиша «+» записывается словом `Plus`: она сравнивается
 * по символу, потому что на разных раскладках стоит на разных клавишах.
 */
export function parseCombo(text: string): KeyCombo {
  const combo: KeyCombo = {};
  for (const token of text.split("+")) {
    if (MODIFIER_TOKENS.has(token)) {
      combo[token.toLowerCase() as "mod" | "ctrl" | "meta" | "alt" | "shift"] = true;
    } else if (token === "Plus") {
      combo.key = "+";
    } else if (/^[A-Z]$/.test(token)) {
      combo.code = `Key${token}`;
    } else if (/^[0-9]$/.test(token)) {
      combo.code = `Digit${token}`;
    } else if (/^F([1-9]|1[0-2])$/.test(token)) {
      combo.code = token;
    } else {
      const code = NAMED_CODES[token];
      if (!code) throw new Error(`неизвестная клавиша «${token}» в сочетании «${text}»`);
      combo.code = code;
    }
  }
  if (!combo.code && !combo.key) throw new Error(`в сочетании «${text}» нет клавиши`);
  return combo;
}

/**
 * Каноническое имя клавиши события: латинская буква или цифра — по символу (`KeyA`, `Digit1`),
 * остальное — физическая клавиша (`code`).
 */
export function canonicalCode(event: Pick<KeyEventLike, "code" | "key">): string {
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  if (/^[0-9]$/.test(event.key)) return `Digit${event.key}`;
  return event.code;
}

/** Совпадает ли событие с сочетанием: модификаторы — точно, клавиша — по символу или `code`. */
export function matchesCombo(event: KeyEventLike, combo: KeyCombo, platform: Platform): boolean {
  const mac = platform === "mac";
  const wantCtrl = Boolean(combo.ctrl) || (Boolean(combo.mod) && !mac);
  const wantMeta = Boolean(combo.meta) || (Boolean(combo.mod) && mac);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta) return false;
  if (event.altKey !== Boolean(combo.alt)) return false;
  if (combo.key !== undefined) {
    // Символ уже учитывает Shift («+» на большинстве раскладок набирается с ним).
    return event.key === combo.key;
  }
  return event.shiftKey === Boolean(combo.shift) && canonicalCode(event) === combo.code;
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

/**
 * Сочетание из события — для `KeyRecorder`. Возвращает `null`, пока нажаты только модификаторы.
 * Модификаторы записываются как есть (`ctrl`, `meta`), без обобщённого `mod`; клавиша — в
 * каноническом имени, поэтому подпись совпадает с буквой на клавише в любой латинской раскладке.
 */
export function comboFromEvent(event: KeyEventLike): KeyCombo | null {
  if (!event.code || MODIFIER_CODES.test(event.code)) return null;
  const combo: KeyCombo = { code: canonicalCode(event) };
  if (event.ctrlKey) combo.ctrl = true;
  if (event.metaKey) combo.meta = true;
  if (event.altKey) combo.alt = true;
  if (event.shiftKey) combo.shift = true;
  return combo;
}

const CODE_LABELS: Record<string, string> = {
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
};

function codeLabel(code: string, spaceLabel: string): string {
  if (code === "Space") return spaceLabel;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1];
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit?.[1]) return digit[1];
  return CODE_LABELS[code] ?? code;
}

/**
 * Подписи клавиш сочетания по порядку — по одной на капсулу `Kbd`: `["Ctrl", "Shift", "K"]`.
 * `spaceLabel` — локализованное название пробела.
 */
export function comboLabels(combo: KeyCombo, platform: Platform, spaceLabel = "Space"): string[] {
  const mac = platform === "mac";
  const labels: string[] = [];
  if (combo.ctrl || (combo.mod && !mac)) labels.push("Ctrl");
  if (combo.meta || (combo.mod && mac)) labels.push(mac ? "Cmd" : "Win");
  if (combo.alt) labels.push(mac ? "Option" : "Alt");
  if (combo.shift) labels.push("Shift");
  if (combo.key !== undefined) labels.push(combo.key);
  else if (combo.code) labels.push(codeLabel(combo.code, spaceLabel));
  return labels;
}

/** Платформа по данным браузера: от неё зависит, что такое `Mod`. */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  return /mac|iphone|ipad/i.test(navigator.userAgent) ? "mac" : "other";
}

/** Находится ли фокус в поле, куда пользователь печатает текст. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset"].includes(
      target.type,
    );
  }
  return false;
}
