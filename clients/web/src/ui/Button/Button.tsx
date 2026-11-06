// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  ToggleButton,
  type ButtonProps as AriaButtonProps,
  type ToggleButtonProps,
} from "react-aria-components";
import { Icon, type IconComponent } from "../icons/Icon";
import { icons } from "../icons/icons";
import { useUiStrings } from "../strings/UiProvider";
import { Tooltip, type TooltipProps } from "../Tooltip/Tooltip";
import { cx } from "../utils/cx";
import styles from "./Button.module.css";
import { Spinner } from "./Spinner";

type BaseButtonProps = Omit<AriaButtonProps, "children" | "className" | "style">;

export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerOutline" | "link" | "pill";

export interface ButtonProps extends BaseButtonProps {
  /**
   * Вид из COMPONENTS §2: `Button/Primary`, `/Secondary`, `/Danger`, `/DangerOutline`, `/Link`,
   * `/Pill`.
   */
  variant?: ButtonVariant;
  /** Высота 40 (m) или 32 (s). `link` и `pill` размер не меняют. */
  size?: "m" | "s";
  /** Иконка слева от текста (обязательна по смыслу у `pill`). */
  icon?: IconComponent;
  /** Растянуть на ширину контейнера (две кнопки пополам в подвале окна). */
  isFullWidth?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Текстовая кнопка. Состояния — обычное, наведение, нажатие, фокус с клавиатуры, неактивное
 * (`isDisabled`), загрузка (`isPending`: спиннер вместо текста, ширина не меняется).
 */
export function Button({
  variant = "primary",
  size = "m",
  icon,
  isFullWidth,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={cx(styles.button, className)}
      data-variant={variant}
      data-size={size}
      data-full-width={isFullWidth || undefined}
    >
      {({ isPending }) => (
        <>
          <span className={styles.content}>
            {icon && <Icon icon={icon} size={variant === "pill" || size === "s" ? 16 : 20} />}
            {children}
          </span>
          {isPending && (
            <span className={styles.pending}>
              <Spinner />
            </span>
          )}
        </>
      )}
    </AriaButton>
  );
}

export interface IconButtonProps extends Omit<BaseButtonProps, "aria-label"> {
  icon: IconComponent;
  /** Подпись: она же `aria-label` и текст обязательной подсказки (COMPONENTS §2, §8). */
  label: string;
  /** Квадрат 32 (m) или 24 (s). */
  size?: "m" | "s";
  tooltipPlacement?: TooltipProps["placement"];
  className?: string;
}

/** `Button/Icon`: квадратная кнопка с иконкой без фона; подсказка обязательна. */
export function IconButton({
  icon,
  label,
  size = "m",
  tooltipPlacement,
  className,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip content={label} placement={tooltipPlacement}>
      <AriaButton
        {...props}
        aria-label={label}
        className={cx(styles.iconButton, className)}
        data-size={size}
      >
        <Icon icon={icon} size={size === "s" ? 16 : 20} />
      </AriaButton>
    </Tooltip>
  );
}

export interface IconToggleButtonProps extends Omit<
  ToggleButtonProps,
  "children" | "className" | "style" | "aria-label"
> {
  icon: IconComponent;
  /** Иконка включённого состояния (например, перечёркнутый микрофон). */
  selectedIcon?: IconComponent;
  /** Подпись и подсказка; меняй её вместе с состоянием («Выключить микрофон» / «Включить…»). */
  label: string;
  /**
   * Смысл включённого состояния: `danger` — фон Брусника 20 % (микрофон выключен), `positive` —
   * фон Шалфей 20 % (стрим идёт).
   */
  tone?: "danger" | "positive";
  size?: "m" | "s";
  tooltipPlacement?: TooltipProps["placement"];
  className?: string;
}

/** `Button/IconToggle`: кнопка-иконка с включённым состоянием. */
export function IconToggleButton({
  icon,
  selectedIcon,
  label,
  tone = "positive",
  size = "m",
  tooltipPlacement,
  className,
  ...props
}: IconToggleButtonProps) {
  return (
    <Tooltip content={label} placement={tooltipPlacement}>
      <ToggleButton
        {...props}
        aria-label={label}
        className={cx(styles.iconButton, className)}
        data-size={size}
        data-tone={tone}
      >
        {({ isSelected }) => (
          <Icon
            icon={isSelected && selectedIcon ? selectedIcon : icon}
            size={size === "s" ? 16 : 20}
          />
        )}
      </ToggleButton>
    </Tooltip>
  );
}

export interface HangupButtonProps extends Omit<BaseButtonProps, "aria-label"> {
  /** Подпись и подсказка; по умолчанию «Отключиться». */
  label?: string;
  className?: string;
}

/** `Button/Hangup`: капсула 64×48 с трубкой, заливка Брусникой. */
export function HangupButton({ label, className, ...props }: HangupButtonProps) {
  const strings = useUiStrings();
  const text = label ?? strings.button.hangup;
  return (
    <Tooltip content={text}>
      <AriaButton {...props} aria-label={text} className={cx(styles.hangup, className)}>
        <Icon icon={icons.hangup} size={24} />
      </AriaButton>
    </Tooltip>
  );
}
