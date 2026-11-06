// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import {
  Label,
  Slider as AriaSlider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  type SliderProps as AriaSliderProps,
} from "react-aria-components";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Slider.module.css";

export interface SliderProps extends Omit<
  AriaSliderProps<number>,
  "children" | "className" | "style" | "orientation"
> {
  /** Подпись над слайдером. Без неё нужен `aria-label`. */
  label?: ReactNode;
  /** Свой текст значения («120 %», «0,4 с»); по умолчанию — число по `formatOptions`. */
  formatValue?: (value: number) => string;
  /** Показывать значение справа от подписи постоянно (в подсказке оно видно всегда). */
  showValue?: boolean;
  className?: string;
}

/**
 * `Slider`: дорожка 4 px, заполненная часть Шалфеем, бегунок 16 px; подпись над слайдером,
 * значение — подсказкой над бегунком при перетаскивании и при фокусе с клавиатуры.
 */
export function Slider({ label, formatValue, showValue, className, ...props }: SliderProps) {
  return (
    <AriaSlider {...props} className={cx(styles.slider, className)}>
      {(label !== undefined || showValue) && (
        <div className={styles.header}>
          {label !== undefined && <Label className={styles.label}>{label}</Label>}
          {showValue && (
            <SliderOutput className={styles.output}>
              {({ state }) => formatValue?.(state.values[0] ?? 0) ?? state.getThumbValueLabel(0)}
            </SliderOutput>
          )}
        </div>
      )}
      <SliderTrack className={styles.track}>
        {({ state }) => (
          <>
            <div className={styles.fill} style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
            <SliderThumb className={styles.thumb}>
              {/* Подсказку показывает CSS: при перетаскивании и при фокусе с клавиатуры. */}
              <span className={styles.bubble} aria-hidden="true">
                {formatValue?.(state.values[0] ?? 0) ?? state.getThumbValueLabel(0)}
              </span>
            </SliderThumb>
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}

export interface LevelMeterProps {
  /** Уровень звука от 0 до 1. */
  level: number;
  /** Число штрихов; по умолчанию 40. */
  bars?: number;
  /** Подпись для экранного диктора; по умолчанию «Уровень звука». */
  "aria-label"?: string;
  className?: string;
}

/** Сколько штрихов горит при данном уровне. */
export function litBars(level: number, bars: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  return Math.round(clamped * bars);
}

/** `LevelMeter`: ряд из ~40 штрихов 3×16; при звуке заливаются Шалфеем слева направо. */
export function LevelMeter({
  level,
  bars = 40,
  className,
  "aria-label": ariaLabel,
}: LevelMeterProps) {
  const strings = useUiStrings();
  const lit = litBars(level, bars);
  return (
    <div
      role="meter"
      aria-label={ariaLabel ?? strings.levelMeter.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((lit / bars) * 100)}
      className={cx(styles.meter, className)}
    >
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} className={styles.bar} data-lit={index < lit || undefined} />
      ))}
    </div>
  );
}

export interface ThresholdSliderProps extends Omit<SliderProps, "showValue"> {
  /** Живой уровень микрофона от 0 до 1 — индикатор под порогом. */
  level: number;
}

/**
 * `Slider/Threshold`: порог активации голоса поверх живого индикатора уровня. Зона ниже порога —
 * Брусника 30 %, выше — Шалфей 30 %; индикатор уровня окрашивается по тому, пройден ли порог.
 */
export function ThresholdSlider({
  level,
  label,
  formatValue,
  className,
  ...props
}: ThresholdSliderProps) {
  const min = props.minValue ?? 0;
  const max = props.maxValue ?? 100;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  return (
    <AriaSlider {...props} className={cx(styles.slider, className)}>
      {label !== undefined && (
        <div className={styles.header}>
          <Label className={styles.label}>{label}</Label>
        </div>
      )}
      <SliderTrack className={cx(styles.track, styles.threshold)}>
        {({ state }) => {
          const threshold = state.getThumbPercent(0);
          const value = state.values[0] ?? min;
          const open = min + clamped * (max - min) >= value;
          return (
            <>
              <div className={styles.zoneBelow} style={{ width: `${threshold * 100}%` }} />
              <div
                className={styles.level}
                data-open={open || undefined}
                style={{ width: `${clamped * 100}%` }}
              />
              <SliderThumb className={cx(styles.thumb, styles.thresholdThumb)}>
                <span className={styles.bubble} aria-hidden="true">
                  {formatValue?.(value) ?? state.getThumbValueLabel(0)}
                </span>
              </SliderThumb>
            </>
          );
        }}
      </SliderTrack>
    </AriaSlider>
  );
}
