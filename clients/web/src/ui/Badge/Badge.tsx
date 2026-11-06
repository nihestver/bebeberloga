// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { Icon, type IconComponent } from "../icons/Icon";
import { icons } from "../icons/icons";
import { formatMessage, useUiStrings, type UiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Badge.module.css";

/**
 * Текст счётчика (COMPONENTS §5): до 999 — число; больше 999 — тысячи с плюсом («1K+»); больше
 * 9999 — «9K+». Между 1000 и 9999 показываются целые тысячи — так прочитана запись спецификации
 * «> 999 → 1K+, > 9999 → 9K+» (вопрос в docs/spec/OPEN-QUESTIONS.md).
 */
export function formatCount(count: number, template: string): string {
  const value = Math.max(0, Math.floor(count));
  if (value <= 999) return String(value);
  return formatMessage(template, { count: Math.min(9, Math.floor(value / 1000)) });
}

export interface CountBadgeProps {
  count: number;
  /** Подпись для экранного диктора: «3 упоминания». Без неё бейдж декоративный. */
  "aria-label"?: string;
  /** Бейдж стоит на иконке: вырез цветом фона по контуру. */
  hasCutout?: boolean;
  className?: string;
}

/** `Badge/Count`: капсула Брусникой с числом цветом Хвои, высота 16, минимальная ширина 16. */
export function CountBadge({
  count,
  hasCutout,
  className,
  "aria-label": ariaLabel,
}: CountBadgeProps) {
  const strings = useUiStrings();
  if (count <= 0) return null;
  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cx(styles.count, className)}
      data-cutout={hasCutout || undefined}
    >
      {formatCount(count, strings.badge.thousands)}
    </span>
  );
}

export interface PillBadgeProps {
  /** Короткий текст: «Новое», «3 новых», «Бот» (заглавными его делает оформление). */
  children: ReactNode;
  /** `danger` — «НОВОЕ» Брусникой; `accent` — Шалфей; `neutral` — «БОТ». */
  tone?: "neutral" | "accent" | "danger";
  className?: string;
}

/** `Badge/Pill`: капсула с текстом 10–12 px заглавными. */
export function PillBadge({ children, tone = "neutral", className }: PillBadgeProps) {
  return (
    <span className={cx(styles.pill, className)} data-tone={tone}>
      {children}
    </span>
  );
}

export interface LiveBadgeProps {
  /** Свой текст; по умолчанию «В эфире». */
  children?: ReactNode;
  className?: string;
}

/** `Badge/Live`: «В ЭФИРЕ» — капсула `--color-live`, текст Хвоей, заглавные 10 px. */
export function LiveBadge({ children, className }: LiveBadgeProps) {
  const strings = useUiStrings();
  return <span className={cx(styles.live, className)}>{children ?? strings.badge.live}</span>;
}

export interface UnreadPipProps {
  /**
   * `unread` — точка 8 px (есть непрочитанное); `hover` — полоса 20 px (наведение); `selected` —
   * полоса 40 px (выбрано); `none` — ничего.
   */
  state: "none" | "unread" | "hover" | "selected";
  className?: string;
}

/**
 * `UnreadPip`: индикатор у левого края рейла или списка каналов. Декоративный: о непрочитанном
 * экранному диктору сообщает подпись самой строки.
 */
export function UnreadPip({ state, className }: UnreadPipProps) {
  return <span aria-hidden="true" className={cx(styles.pip, className)} data-state={state} />;
}

export type E2EEState = "verified" | "unverified" | "warning";

const E2EE_ICONS: Record<E2EEState, IconComponent> = {
  verified: icons.shieldCheck,
  unverified: icons.e2ee,
  warning: icons.shieldWarning,
};

function e2eeDescription(state: E2EEState, strings: UiStrings): string {
  return strings.e2ee[state];
}

export interface E2EEBadgeProps {
  /**
   * `verified` — всё проверено (Шалфей); `unverified` — шифрование есть, участники не проверены
   * (нейтральный); `warning` — ключи собеседника изменились после проверки или сообщение не
   * расшифровалось (Брусника). Отправка при этом не блокируется (ADR-0013 п. 3).
   */
  state: E2EEState;
  /** Свой текст; по умолчанию «Зашифровано». */
  children?: ReactNode;
  className?: string;
}

/**
 * `E2EEBadge`: значок лапы или щита (не замок — BRAND) и текст «Зашифровано». Состояние передано
 * не только цветом: у каждого свой значок и своё пояснение для экранного диктора и подсказки.
 */
export function E2EEBadge({ state, children, className }: E2EEBadgeProps) {
  const strings = useUiStrings();
  const description = e2eeDescription(state, strings);
  return (
    <span className={cx(styles.e2ee, className)} data-state={state} title={description}>
      <Icon icon={E2EE_ICONS[state]} size={14} />
      <span>{children ?? strings.e2ee.label}</span>
      <span className={styles.hidden}>. {description}</span>
    </span>
  );
}
