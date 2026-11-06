// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { SwitchButton, SwitchField, Text, type SwitchFieldProps } from "react-aria-components";
import { cx } from "../utils/cx";
import styles from "./Toggle.module.css";

export interface ToggleProps extends Omit<SwitchFieldProps, "children" | "className" | "style"> {
  /** Подпись строки слева. Без неё нужен `aria-label`. */
  children?: ReactNode;
  /** Пояснение под подписью. */
  description?: ReactNode;
  className?: string;
}

/**
 * `Toggle`: переключатель 40×24, всегда справа в строке. Включён — заливка Шалфеем, бегунок
 * Хвоей; выключен — Панель с рамкой.
 */
export function Toggle({ children, description, className, ...props }: ToggleProps) {
  return (
    <SwitchField {...props} className={cx(styles.row, className)}>
      <SwitchButton className={styles.toggle}>
        {children && <span className={styles.label}>{children}</span>}
        <span className={styles.track}>
          <span className={styles.thumb} />
        </span>
      </SwitchButton>
      {description && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
    </SwitchField>
  );
}
