// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useState, type ReactElement, type ReactNode } from "react";
import { Dialog, DialogTrigger, Heading, Popover, type PopoverProps } from "react-aria-components";
import { Icon, type IconComponent } from "../icons/Icon";
import { EscLayer, useEscapeLayer } from "../shortcuts/escape";
import { cx } from "../utils/cx";
import styles from "./PopoverPanel.module.css";

export interface PopoverPanelProps {
  /** Кнопка-источник: кнопка дизайн-системы. Повторный клик по ней закрывает панель. */
  trigger: ReactElement;
  /** Заголовок в шапке. */
  title: ReactNode;
  /** Иконка слева от заголовка. */
  icon?: IconComponent;
  /** Кнопки в шапке справа. */
  actions?: ReactNode;
  children: ReactNode;
  /** Ширина панели, 420–520 px; по умолчанию 440. */
  width?: number;
  placement?: PopoverProps["placement"];
  isOpen?: boolean;
  /** Открыть панель сразу (неуправляемый режим). */
  defaultOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  className?: string;
}

/**
 * `Popover/Panel`: панель 420–520 px с шапкой под кнопкой-источником — закреплённые, ветки,
 * входящие, soundboard, карточка профиля. Закрывается Esc, кликом вне и повторным кликом по
 * источнику; действия внутри панель не закрывают.
 */
export function PopoverPanel({
  trigger,
  title,
  icon,
  actions,
  children,
  width = 440,
  placement = "bottom end",
  isOpen: controlled,
  defaultOpen = false,
  onOpenChange,
  className,
}: PopoverPanelProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = controlled ?? inner;
  const setOpen = (open: boolean) => {
    setInner(open);
    onOpenChange?.(open);
  };
  useEscapeLayer(EscLayer.panel, () => setOpen(false), isOpen);

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      {trigger}
      <Popover
        placement={placement}
        offset={8}
        className={cx(styles.panel, className)}
        style={{ width }}
      >
        <Dialog className={styles.dialog}>
          <header className={styles.header}>
            {icon && <Icon icon={icon} className={styles.icon} />}
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            {actions && <div className={styles.actions}>{actions}</div>}
          </header>
          <div className={styles.body}>{children}</div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
