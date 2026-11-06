// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./SegmentedControl.module.css";

export interface SegmentOption<T extends string = string> {
  id: T;
  label: ReactNode;
  isDisabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  /** Название группы для экранного диктора. */
  "aria-label": string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  isDisabled?: boolean;
  className?: string;
}

/**
 * `SegmentedControl`: ряд кнопок на общей подложке Панели, активная — `--color-panel-active`
 * («Приложения / Весь экран / Устройства», «SD / HD»). Один вариант выбран всегда.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  isDisabled,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = keys;
        if (next !== undefined && next !== value) onChange(next as T);
      }}
      isDisabled={isDisabled}
      className={cx(styles.segmented, className)}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          isDisabled={option.isDisabled}
          className={styles.segment}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export type TriStateValue = "deny" | "inherit" | "allow";

export interface TriStateProps {
  /** Название права для экранного диктора. */
  "aria-label": string;
  value: TriStateValue;
  onChange: (value: TriStateValue) => void;
  isDisabled?: boolean;
  className?: string;
}

const TRI_STATE = [
  { id: "deny", icon: icons.close },
  { id: "inherit", icon: icons.slash },
  { id: "allow", icon: icons.check },
] as const;

/**
 * `TriState`: сегмент из трёх кнопок 32×26 — «запретить» (✕, Брусника), «наследовать» (/,
 * нейтрально), «разрешить» (✓, Шалфей). Выбранный сегмент залит своим цветом на 20 %.
 */
export function TriState({
  value,
  onChange,
  isDisabled,
  className,
  "aria-label": ariaLabel,
}: TriStateProps) {
  const strings = useUiStrings();
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = keys;
        if (next !== undefined && next !== value) onChange(next as TriStateValue);
      }}
      isDisabled={isDisabled}
      className={cx(styles.triState, className)}
    >
      {TRI_STATE.map(({ id, icon }) => (
        <ToggleButton
          key={id}
          id={id}
          aria-label={strings.triState[id]}
          className={styles.triSegment}
          data-tone={id}
        >
          <Icon icon={icon} size={16} />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
