// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "../Button/Button";
import fieldStyles from "../Input/Input.module.css";
import { KeyComboView } from "../Kbd/Kbd";
import { comboFromEvent, type KeyCombo, type Platform } from "../shortcuts/keys";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./KeyRecorder.module.css";

export interface KeyRecorderProps {
  /** Подпись над полем. Без неё нужен `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  /** Записанное сочетание; `null` — не назначено. */
  value: KeyCombo | null;
  onChange: (combo: KeyCombo) => void;
  isDisabled?: boolean;
  /** Платформа для подписей клавиш; по умолчанию определяется по браузеру. */
  platform?: Platform;
  className?: string;
}

/**
 * `KeyRecorder`: поле показывает сочетание капсулами `Kbd`; кнопка «Записать» включает запись —
 * поле подсвечивается Инеем и принимает следующее нажатие. Esc отменяет запись.
 */
export function KeyRecorder({
  label,
  value,
  onChange,
  isDisabled,
  platform,
  className,
  "aria-label": ariaLabel,
}: KeyRecorderProps) {
  const strings = useUiStrings();
  const labelId = useId();
  const [isRecording, setRecording] = useState(false);

  useEffect(() => {
    if (!isRecording) return;
    // Пока идёт запись, нажатие принадлежит полю: до меню, сочетаний и порядка Esc оно не доходит.
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) return;
      setRecording(false);
      onChange(combo);
    };
    const stop = () => setRecording(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", stop);
    };
  }, [isRecording, onChange]);

  return (
    <div className={cx(fieldStyles.field, className)}>
      {label && (
        <span id={labelId} className={fieldStyles.label}>
          {label}
        </span>
      )}
      <div className={styles.row}>
        <div
          role="group"
          aria-label={ariaLabel}
          aria-labelledby={label ? labelId : undefined}
          className={styles.field}
          data-recording={isRecording || undefined}
          data-disabled={isDisabled || undefined}
        >
          <span aria-live="polite" className={styles.value}>
            {isRecording ? (
              <span className={styles.hint}>{strings.keyRecorder.recording}</span>
            ) : value ? (
              <KeyComboView combo={value} platform={platform} />
            ) : (
              <span className={styles.hint}>{strings.keyRecorder.empty}</span>
            )}
          </span>
        </div>
        <Button
          variant="secondary"
          size="s"
          isDisabled={isDisabled}
          onPress={() => setRecording((current) => !current)}
        >
          {isRecording ? strings.keyRecorder.stop : strings.keyRecorder.record}
        </Button>
      </div>
    </div>
  );
}
