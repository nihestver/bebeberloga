// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as AriaToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
} from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Toast.module.css";

/** Уведомление держится 3–5 с; одновременно видно не больше трёх (COMPONENTS §4). */
export const TOAST_MIN_MS = 3000;
export const TOAST_MAX_MS = 5000;
export const TOAST_LIMIT = 3;

export interface ToastMessage {
  /** Текст: «Ссылка скопирована». */
  message: ReactNode;
  /** `danger` — сбой: «Сообщение не отправлено». */
  tone?: "neutral" | "danger";
  /** Подпись действия: «Повторить». */
  actionLabel?: string;
  onAction?: () => void;
}

export type ToastQueue = AriaToastQueue<ToastMessage>;

/** Очередь уведомлений. Приложению обычно хватает общей `toastQueue`. */
export function createToastQueue(): ToastQueue {
  return new AriaToastQueue<ToastMessage>({ maxVisibleToasts: TOAST_LIMIT });
}

/** Общая очередь приложения: её показывает `ToastRegion` по умолчанию. */
export const toastQueue: ToastQueue = createToastQueue();

export interface ShowToastOptions {
  /** Время показа, мс; приводится к 3–5 с. По умолчанию 4 с. */
  timeout?: number;
  queue?: ToastQueue;
}

/** Показывает уведомление и возвращает его ключ (для `queue.close(key)`). */
export function showToast(
  message: ToastMessage | string,
  { timeout = 4000, queue = toastQueue }: ShowToastOptions = {},
): string {
  const content = typeof message === "string" ? { message } : message;
  return queue.add(content, {
    timeout: Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, timeout)),
  });
}

export interface ToastRegionProps {
  queue?: ToastQueue;
  className?: string;
}

/**
 * `Toast`: капсулы внизу по центру над полем ввода. Область ставится один раз в каркасе окна;
 * отступ снизу задаёт переменная `--toast-offset`. Таймер замирает, пока на уведомлении указатель
 * или фокус.
 */
export function ToastRegion({ queue = toastQueue, className }: ToastRegionProps) {
  const strings = useUiStrings();
  return (
    <AriaToastRegion
      queue={queue}
      aria-label={strings.toast.region}
      className={cx(styles.region, className)}
    >
      {({ toast }) => (
        <AriaToast toast={toast} className={styles.toast} data-tone={toast.content.tone}>
          <AriaToastContent className={styles.content}>
            <Text slot="title">{toast.content.message}</Text>
          </AriaToastContent>
          {toast.content.actionLabel && (
            <AriaButton
              className={styles.action}
              onPress={() => {
                toast.content.onAction?.();
                queue.close(toast.key);
              }}
            >
              {toast.content.actionLabel}
            </AriaButton>
          )}
          <AriaButton slot="close" aria-label={strings.toast.dismiss} className={styles.close}>
            <Icon icon={icons.close} size={14} />
          </AriaButton>
        </AriaToast>
      )}
    </AriaToastRegion>
  );
}
