// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { comboLabels, detectPlatform, type KeyCombo, type Platform } from "../shortcuts/keys";
import { shortcutCombos, type ShortcutId } from "../shortcuts/registry";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Kbd.module.css";

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** `Kbd`: капсула клавиши 20×20+, рамка, моноширинный текст 12 px. */
export function Kbd({ children, className }: KbdProps) {
  return <kbd className={cx(styles.kbd, className)}>{children}</kbd>;
}

export interface KeyComboViewProps {
  combo: KeyCombo;
  /** По умолчанию определяется по браузеру: от неё зависит подпись `Mod` (Cmd или Ctrl). */
  platform?: Platform;
  className?: string;
}

/** Сочетание клавиш капсулами `Kbd`: «Ctrl» «Shift» «K». */
export function KeyComboView({ combo, platform, className }: KeyComboViewProps) {
  const strings = useUiStrings();
  const labels = comboLabels(combo, platform ?? detectPlatform(), strings.keys.space);
  return (
    <span className={cx(styles.combo, className)}>
      {labels.map((label, index) => (
        // Подписи в сочетании не повторяются по позиции: порядок фиксирован.
        <Kbd key={`${index}:${label}`}>{label}</Kbd>
      ))}
    </span>
  );
}

export interface ShortcutKeysProps {
  /** Действие из реестра сочетаний (SHORTCUTS.md). */
  id: ShortcutId;
  platform?: Platform;
  className?: string;
}

/**
 * Клавиши стандартного сочетания: для пунктов меню, подсказок и окна «Сочетания клавиш». Если у
 * действия несколько сочетаний, показывается первое; если ни одного — ничего.
 */
export function ShortcutKeys({ id, platform, className }: ShortcutKeysProps) {
  const [combo] = shortcutCombos(id);
  return combo ? <KeyComboView combo={combo} platform={platform} className={className} /> : null;
}
