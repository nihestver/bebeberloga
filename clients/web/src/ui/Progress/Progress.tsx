// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { Label, Meter, ProgressBar as AriaProgressBar } from "react-aria-components";
import { formatMessage, useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Progress.module.css";

export interface ProgressBarProps {
  /** От 0 до 100; без значения — неопределённый вариант (бегущий отрезок). */
  value?: number;
  /** Подпись слева над полосой. Без неё нужен `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  className?: string;
}

/** `ProgressBar`: полоса 4 px, заполнение Шалфеем, подпись сверху справа «N %». */
export function ProgressBar({
  value,
  label,
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const strings = useUiStrings();
  const isIndeterminate = value === undefined;
  return (
    <AriaProgressBar
      aria-label={ariaLabel}
      value={value}
      isIndeterminate={isIndeterminate}
      className={cx(styles.progress, className)}
    >
      {({ percentage }) => (
        <>
          <div className={styles.header}>
            {label !== undefined && <Label className={styles.label}>{label}</Label>}
            {!isIndeterminate && (
              <span className={styles.value}>
                {formatMessage(strings.progress.percent, { value: Math.round(percentage ?? 0) })}
              </span>
            )}
          </div>
          <div className={styles.track}>
            <div
              className={styles.fill}
              data-indeterminate={isIndeterminate || undefined}
              style={isIndeterminate ? undefined : { width: `${percentage ?? 0}%` }}
            />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}

/** Оценка надёжности пароля: 0 — пусто, 1 — слабый … 4 — отличный. Считает вызывающий. */
export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrengthProps {
  score: PasswordScore;
  className?: string;
}

/**
 * `PasswordStrength`: 4 сегмента под полем пароля — 1 Брусника «слабый», 2 Морошка «так себе»,
 * 3–4 Шалфей «хороший» и «отличный».
 */
export function PasswordStrength({ score, className }: PasswordStrengthProps) {
  const strings = useUiStrings();
  const labels: Record<PasswordScore, string> = {
    0: "",
    1: strings.password.weak,
    2: strings.password.soso,
    3: strings.password.good,
    4: strings.password.great,
  };
  const tone = score <= 1 ? "weak" : score === 2 ? "soso" : "good";
  return (
    <Meter
      value={score}
      minValue={0}
      maxValue={4}
      aria-label={strings.password.label}
      valueLabel={labels[score]}
      className={cx(styles.strength, className)}
      data-tone={tone}
    >
      <div className={styles.segments}>
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={styles.segment}
            data-filled={segment <= score || undefined}
          />
        ))}
      </div>
      {score > 0 && <span className={styles.strengthLabel}>{labels[score]}</span>}
    </Meter>
  );
}

export interface SkeletonProps {
  /** Ширина и высота: число px или CSS-значение. */
  width?: number | string;
  height?: number | string;
  /** Круг (аватар). */
  isRound?: boolean;
  className?: string;
}

/** `Skeleton`: серый прямоугольник-заглушка с мерцанием на время загрузки списков и ленты. */
export function Skeleton({ width = "100%", height = 16, isRound, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, className)}
      data-round={isRound || undefined}
      style={{ width, height }}
    />
  );
}

export interface SkeletonTextProps {
  /** Число строк; последняя короче. */
  lines?: number;
  className?: string;
}

/** Несколько строк-заглушек текста. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={cx(styles.lines, className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} height={12} width={index === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}
