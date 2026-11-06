// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { CheckboxButton, CheckboxField, type CheckboxFieldProps } from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { cx } from "../utils/cx";
import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<
  CheckboxFieldProps,
  "children" | "className" | "style"
> {
  /** Подпись справа от квадрата. Без неё нужен `aria-label`. */
  children?: ReactNode;
  className?: string;
}

/** `Checkbox`: квадрат 20, радиус 6; включён — заливка Шалфеем с галочкой Хвоей. */
export function Checkbox({ children, className, ...props }: CheckboxProps) {
  return (
    <CheckboxField {...props} className={cx(styles.field, className)}>
      <CheckboxButton className={styles.checkbox}>
        {({ isSelected, isIndeterminate }) => (
          <>
            <span className={styles.box}>
              {isIndeterminate ? (
                <Icon icon={icons.minus} size={14} />
              ) : (
                isSelected && <Icon icon={icons.check} size={14} />
              )}
            </span>
            {children && <span className={styles.label}>{children}</span>}
          </>
        )}
      </CheckboxButton>
    </CheckboxField>
  );
}
