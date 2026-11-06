// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { OverlayArrow, Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components";
import { cx } from "../utils/cx";
import styles from "./Tooltip.module.css";

/** Задержка появления при наведении, мс (COMPONENTS §4); при фокусе с клавиатуры — сразу. */
export const TOOLTIP_DELAY_MS = 500;
/** Сколько держится подтверждение Tooltip/Success, мс. */
export const TOOLTIP_SUCCESS_MS = 1500;

export interface TooltipProps {
  /** Текст подсказки. */
  content: ReactNode;
  /** Источник: фокусируемый элемент дизайн-системы (кнопка, ссылка, поле). */
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  /** `success` — заливка Шалфеем для коротких подтверждений («Микрофон выключен»). */
  variant?: "default" | "success";
  /** Управляемое состояние: для `success` см. `useSuccessTooltip`. */
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  isDisabled?: boolean;
  className?: string;
}

/** `Tooltip` и `Tooltip/Success` из COMPONENTS §4. */
export function Tooltip({
  content,
  children,
  placement = "top",
  variant = "default",
  isOpen,
  onOpenChange,
  isDisabled,
  className,
}: TooltipProps) {
  return (
    <TooltipTrigger
      delay={TOOLTIP_DELAY_MS}
      closeDelay={0}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDisabled={isDisabled}
    >
      {children}
      <AriaTooltip
        placement={placement}
        offset={8}
        className={cx(styles.tooltip, className)}
        data-variant={variant}
      >
        <OverlayArrow className={styles.arrow}>
          <svg width={10} height={5} viewBox="0 0 10 5" aria-hidden>
            <path d="M0 0 5 5 10 0z" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

/**
 * Состояние для `Tooltip/Success`: `show()` открывает подсказку на 1.5 с.
 * Пример: `const done = useSuccessTooltip(); <Tooltip variant="success" isOpen={done.isOpen} …>`.
 */
export function useSuccessTooltip(durationMs = TOOLTIP_SUCCESS_MS) {
  const [isOpen, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(true);
    timer.current = setTimeout(() => setOpen(false), durationMs);
  }, [durationMs]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { isOpen, show };
}
