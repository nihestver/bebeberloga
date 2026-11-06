// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { ProgressBar } from "react-aria-components";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Button.module.css";

export interface SpinnerProps {
  /** Диаметр в px. */
  size?: number;
  /** Подпись для экранного диктора; по умолчанию «Загрузка…». */
  label?: string;
  className?: string;
}

/** Спиннер — только для коротких ожиданий внутри кнопок и миниатюр (COMPONENTS §6, Skeleton). */
export function Spinner({ size = 18, label, className }: SpinnerProps) {
  const strings = useUiStrings();
  return (
    <ProgressBar
      isIndeterminate
      aria-label={label ?? strings.common.loading}
      className={cx(styles.spinner, className)}
      style={{ width: size, height: size }}
    />
  );
}
