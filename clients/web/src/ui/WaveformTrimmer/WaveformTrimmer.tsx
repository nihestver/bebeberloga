// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useId } from "react";
import { Label, Slider, SliderThumb, SliderTrack } from "react-aria-components";
import { IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./WaveformTrimmer.module.css";

/** Размер волны, px (COMPONENTS §6). */
export const WAVEFORM_WIDTH = 400;
export const WAVEFORM_HEIGHT = 64;

/** «0:03.2» — минуты, секунды и десятые для выбранного; «5:00» — без десятых для предела. */
export function formatDuration(seconds: number, withTenths = false): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const whole = Math.floor(rest);
  const base = `${minutes}:${String(whole).padStart(2, "0")}`;
  return withTenths ? `${base}.${Math.floor((rest - whole) * 10)}` : base;
}

export interface WaveformTrimmerProps {
  /** Пики громкости от 0 до 1, слева направо (их считает вызывающий по аудиоданным). */
  peaks: readonly number[];
  /** Длительность звука, с. */
  duration: number;
  /** Наибольшая длительность фрагмента, с (подпись «… / 5:00»); по умолчанию — вся запись. */
  limit?: number;
  /** Границы выбранного фрагмента, с. */
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** Фрагмент проигрывается: кнопка показывает «остановить». */
  isPlaying?: boolean;
  onPlayToggle?: () => void;
  isDisabled?: boolean;
  className?: string;
}

/**
 * `WaveformTrimmer`: волна звука 400×64 Лишайником, выбранный участок Шалфеем между двумя ручками;
 * над волной — длительность выбранного «0:03.2 / 5:00» и кнопка ▶. Ручки — ползунки, их двигают
 * стрелки.
 */
export function WaveformTrimmer({
  peaks,
  duration,
  limit,
  value,
  onChange,
  isPlaying,
  onPlayToggle,
  isDisabled,
  className,
}: WaveformTrimmerProps) {
  const strings = useUiStrings();
  const clipId = useId();
  const [start, end] = value;
  const columns = Math.max(1, peaks.length);
  const barWidth = WAVEFORM_WIDTH / columns;
  const bars = peaks.map((peak, index) => {
    const height = Math.max(2, Math.min(1, Math.max(0, peak)) * WAVEFORM_HEIGHT);
    return (
      <rect
        key={index}
        x={index * barWidth + barWidth * 0.15}
        y={(WAVEFORM_HEIGHT - height) / 2}
        width={barWidth * 0.7}
        height={height}
        rx={1}
      />
    );
  });
  const toX = (seconds: number) => (duration > 0 ? (seconds / duration) * WAVEFORM_WIDTH : 0);

  return (
    <Slider
      minValue={0}
      maxValue={duration}
      step={0.1}
      value={[start, end]}
      onChange={(next) => {
        if (Array.isArray(next) && next.length === 2) onChange([next[0] ?? 0, next[1] ?? 0]);
      }}
      isDisabled={isDisabled}
      className={cx(styles.trimmer, className)}
    >
      <div className={styles.header}>
        <Label className={styles.label}>{strings.waveform.label}</Label>
        <span className={styles.time}>
          {formatDuration(end - start, true)} / {formatDuration(limit ?? duration)}
        </span>
        <IconButton
          icon={isPlaying ? icons.stop : icons.play}
          label={isPlaying ? strings.waveform.stop : strings.waveform.play}
          size="s"
          isDisabled={isDisabled}
          onPress={onPlayToggle}
        />
      </div>
      <SliderTrack className={styles.track}>
        <svg
          viewBox={`0 0 ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT}`}
          preserveAspectRatio="none"
          className={styles.wave}
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={toX(start)}
                y={0}
                width={Math.max(0, toX(end) - toX(start))}
                height={WAVEFORM_HEIGHT}
              />
            </clipPath>
          </defs>
          <g className={styles.peaks}>{bars}</g>
          <g className={styles.selected} clipPath={`url(#${clipId})`}>
            {bars}
          </g>
        </svg>
        <SliderThumb index={0} aria-label={strings.waveform.start} className={styles.handle} />
        <SliderThumb index={1} aria-label={strings.waveform.end} className={styles.handle} />
      </SliderTrack>
    </Slider>
  );
}
