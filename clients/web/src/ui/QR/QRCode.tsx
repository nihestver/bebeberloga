// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { encodeQR } from "qr";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./QR.module.css";

/** Сторона квадрата по умолчанию и отступ подложки, px (COMPONENTS §6). */
export const QR_SIZE = 200;
export const QR_PADDING = 12;
/** Размер символа проекта в центре, px. */
export const QR_CENTER = 32;

/** Модули QR-кода: `true` — тёмный. Коррекция ошибок H: центр может закрывать символ проекта. */
export function qrModules(value: string): boolean[][] {
  // Библиотека добавляет поле не меньше одного модуля; отступ рисует сам компонент — поле срезается.
  const padded = encodeQR(value, "raw", { ecc: "high", border: 1 });
  return padded.slice(1, -1).map((row) => row.slice(1, -1));
}

/** Контур всех тёмных модулей одним путём SVG (единица — модуль). */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join("");
}

export interface QRCodeProps {
  /** Содержимое кода. */
  value: string;
  /** Сторона квадрата в px; по умолчанию 200. */
  size?: number;
  /** Символ проекта 32 px в центре; по умолчанию — ничего. */
  center?: ReactNode;
  /** Подпись для экранного диктора; по умолчанию «QR-код». */
  "aria-label"?: string;
  className?: string;
}

/**
 * `QRCode`: квадрат 200 на светлой подложке с отступом 12, в центре символ проекта 32. Подложка —
 * Туман, модули — Хвоя (белого в палитре нет: вопрос в OPEN-QUESTIONS). Коррекция ошибок H.
 */
export function QRCode({
  value,
  size = QR_SIZE,
  center,
  className,
  "aria-label": ariaLabel,
}: QRCodeProps) {
  const strings = useUiStrings();
  const modules = useMemo(() => qrModules(value), [value]);
  const count = modules.length;
  const style = { "--qr-size": `${size}px` } as CSSProperties;
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? strings.qr.code}
      className={cx(styles.code, className)}
      style={style}
    >
      <svg
        viewBox={`0 0 ${count} ${count}`}
        shapeRendering="crispEdges"
        className={styles.modules}
        data-modules={count}
        aria-hidden="true"
      >
        <path d={qrPath(modules)} />
      </svg>
      {center && (
        <span className={styles.center} aria-hidden="true">
          {center}
        </span>
      )}
    </div>
  );
}
