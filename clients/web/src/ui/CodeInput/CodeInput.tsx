// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import fieldStyles from "../Input/Input.module.css";
import { formatMessage, useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./CodeInput.module.css";

export interface CodeInputProps {
  /** Число ячеек: 6 (по умолчанию) или 4. */
  length?: 4 | 6;
  /** Подпись над ячейками. Без неё нужен `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Все ячейки заполнены. */
  onComplete?: (value: string) => void;
  isDisabled?: boolean;
  isInvalid?: boolean;
  errorMessage?: ReactNode;
  autoFocus?: boolean;
  className?: string;
}

const DIGITS = /\d/g;

/**
 * `CodeInput`: 6 (или 4) ячеек 44×52 с одной цифрой; ввод сам переходит к следующей, вставка
 * заполняет все, Backspace возвращает к предыдущей.
 */
export function CodeInput({
  length = 6,
  label,
  value: controlled,
  defaultValue = "",
  onChange,
  onComplete,
  isDisabled,
  isInvalid,
  errorMessage,
  autoFocus,
  className,
  "aria-label": ariaLabel,
}: CodeInputProps) {
  const strings = useUiStrings();
  const labelId = useId();
  const errorId = useId();
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const [inner, setInner] = useState(defaultValue.slice(0, length));
  const value = (controlled ?? inner).slice(0, length);
  const invalid = isInvalid ?? Boolean(errorMessage);

  const focusCell = (index: number) => {
    cells.current[Math.min(length - 1, Math.max(0, index))]?.focus();
  };

  const commit = (next: string) => {
    const digits = (next.match(DIGITS) ?? []).join("").slice(0, length);
    setInner(digits);
    onChange?.(digits);
    if (digits.length === length) onComplete?.(digits);
    return digits;
  };

  const setDigit = (index: number, digit: string) => {
    const chars = Array.from(value.padEnd(index, " ").slice(0, index));
    const next = commit(`${chars.join("")}${digit}${value.slice(index + 1)}`.replace(/ /g, ""));
    focusCell(Math.min(next.length, length - 1));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Backspace": {
        event.preventDefault();
        if (value[index]) {
          commit(value.slice(0, index));
          focusCell(index);
        } else {
          commit(value.slice(0, Math.max(0, index - 1)));
          focusCell(index - 1);
        }
        return;
      }
      case "ArrowLeft":
        event.preventDefault();
        focusCell(index - 1);
        return;
      case "ArrowRight":
        event.preventDefault();
        focusCell(index + 1);
        return;
      default:
        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          setDigit(index, event.key);
        }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const next = commit(event.clipboardData.getData("text"));
    focusCell(Math.min(next.length, length - 1));
  };

  return (
    <div className={cx(fieldStyles.field, className)}>
      {label && (
        <span id={labelId} className={fieldStyles.label}>
          {label}
        </span>
      )}
      <div
        role="group"
        aria-label={ariaLabel}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={errorMessage ? errorId : undefined}
        className={styles.cells}
        data-invalid={invalid || undefined}
      >
        {Array.from({ length }, (_, index) => (
          <input
            key={index}
            ref={(element) => {
              cells.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={value[index] ?? ""}
            onChange={(event) => {
              // Ввод с экранной клавиатуры и автозаполнение приходят сюда, а не в onKeyDown.
              const typed = event.target.value;
              if (typed.length > 1) commit(value.slice(0, index) + typed);
              else if (/^\d$/.test(typed)) setDigit(index, typed);
            }}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={onPaste}
            onFocus={(event) => event.target.select()}
            disabled={isDisabled}
            aria-label={formatMessage(strings.codeInput.cell, { index: index + 1, total: length })}
            aria-invalid={invalid || undefined}
            autoFocus={autoFocus && index === 0}
            className={styles.cell}
          />
        ))}
      </div>
      {errorMessage && (
        <span id={errorId} className={fieldStyles.error}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
