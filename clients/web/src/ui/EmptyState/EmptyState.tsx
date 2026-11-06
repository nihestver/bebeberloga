// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { cx } from "../utils/cx";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  /** Иллюстрация в стиле бренда; есть две заглушки: `SleepingBear`, `SearchingBear`. */
  illustration?: ReactNode;
  /** Заголовок Nunito 700 20. */
  title: ReactNode;
  /** Текст Лишайником в 1–2 строки. */
  children?: ReactNode;
  /** Действие: `Button/Primary`. */
  action?: ReactNode;
  className?: string;
}

/** `EmptyState`: иллюстрация, заголовок, текст и при необходимости кнопка. Тексты — в тоне BRAND. */
export function EmptyState({ illustration, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      {illustration && (
        <div className={styles.illustration} aria-hidden="true">
          {illustration}
        </div>
      )}
      <h3 className={styles.title}>{title}</h3>
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

/**
 * Заглушки иллюстраций: плоские формы из токенов. BRAND.md оставляет иллюстрации пустых состояний
 * на потом («Что ещё не сделано»); эти рисунки заменяются готовыми без изменения экранов.
 */
export function SleepingBear({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={styles.svg}>
      <circle cx="60" cy="64" r="34" className={styles.body} />
      <circle cx="35" cy="40" r="11" className={styles.body} />
      <circle cx="85" cy="40" r="11" className={styles.body} />
      <circle cx="35" cy="40" r="5" className={styles.detail} />
      <circle cx="85" cy="40" r="5" className={styles.detail} />
      <ellipse cx="60" cy="74" rx="14" ry="10" className={styles.detail} />
      <ellipse cx="60" cy="71" rx="5" ry="3.5" className={styles.ink} />
      <path d="M43 60q6-5 12 0M65 60q6-5 12 0" className={styles.stroke} />
      <path d="M86 18h10l-10 10h10M100 6h7l-7 7h7" className={styles.strokeAccent} />
    </svg>
  );
}

export function SearchingBear({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={styles.svg}>
      <circle cx="52" cy="66" r="32" className={styles.body} />
      <circle cx="29" cy="44" r="10" className={styles.body} />
      <circle cx="75" cy="44" r="10" className={styles.body} />
      <circle cx="29" cy="44" r="4.5" className={styles.detail} />
      <circle cx="75" cy="44" r="4.5" className={styles.detail} />
      <ellipse cx="52" cy="76" rx="13" ry="9" className={styles.detail} />
      <ellipse cx="52" cy="73" rx="4.5" ry="3" className={styles.ink} />
      <circle cx="40" cy="60" r="3" className={styles.ink} />
      <circle cx="64" cy="60" r="3" className={styles.ink} />
      <circle cx="90" cy="78" r="16" className={styles.lens} />
      <circle cx="90" cy="78" r="16" className={styles.strokeAccentWide} />
      <path d="M101 90l12 12" className={styles.strokeAccentWide} />
    </svg>
  );
}
