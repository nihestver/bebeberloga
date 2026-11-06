// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import {
  Header,
  Keyboard,
  Menu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Popover,
  Separator,
  SubmenuTrigger,
  Text,
  type MenuItemProps as AriaMenuItemProps,
  type MenuSectionProps as AriaMenuSectionProps,
  type PopoverProps,
} from "react-aria-components";
import { Icon, type IconComponent } from "../icons/Icon";
import { icons } from "../icons/icons";
import { ShortcutKeys } from "../Kbd/Kbd";
import { EscLayer, useEscapeLayer } from "../shortcuts/escape";
import type { ShortcutId } from "../shortcuts/registry";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Menu.module.css";

/** Задержка открытия подменю при наведении, мс (COMPONENTS §4). */
export const SUBMENU_DELAY_MS = 150;

export interface MenuItemProps extends Omit<
  AriaMenuItemProps,
  "children" | "className" | "style" | "textValue"
> {
  /** Текст пункта. */
  children: ReactNode;
  /** Иконка 18 слева. */
  icon?: IconComponent;
  /** Вторая строка серым пояснением. */
  description?: ReactNode;
  /** Подпись-сочетание справа: действие из реестра сочетаний (SHORTCUTS.md). */
  shortcut?: ShortcutId;
  /** Опасный пункт: цветом Брусники; такие пункты ставят последними. */
  isDanger?: boolean;
  /** Текст для набора первых букв; нужен, если `children` — не строка. */
  textValue?: string;
  className?: string;
}

/**
 * Пункт меню: высота 32, иконка 18 слева, текст, справа — стрелка подменю, галочка выбранного
 * или сочетание клавиш.
 */
export function MenuItem({
  children,
  icon,
  description,
  shortcut,
  isDanger,
  textValue,
  className,
  ...props
}: MenuItemProps) {
  return (
    <AriaMenuItem
      {...props}
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={cx(styles.item, className)}
      data-danger={isDanger || undefined}
    >
      {({ hasSubmenu, isSelected }) => (
        <>
          {icon && <Icon icon={icon} size={18} className={styles.itemIcon} />}
          <span className={styles.itemText}>
            <Text slot="label">{children}</Text>
            {description && (
              <Text slot="description" className={styles.itemDescription}>
                {description}
              </Text>
            )}
          </span>
          {shortcut && (
            <Keyboard className={styles.itemShortcut}>
              <ShortcutKeys id={shortcut} />
            </Keyboard>
          )}
          {isSelected && <Icon icon={icons.check} size={16} className={styles.itemMark} />}
          {hasSubmenu && <Icon icon={icons.chevronRight} size={16} className={styles.itemMark} />}
        </>
      )}
    </AriaMenuItem>
  );
}

export interface MenuSectionProps extends Omit<
  AriaMenuSectionProps<object>,
  "children" | "className" | "style"
> {
  /** Заголовок группы. */
  title?: ReactNode;
  children: ReactNode;
}

/** Группа пунктов; с `selectionMode` пункты получают галочку выбранного. */
export function MenuSection({ title, children, ...props }: MenuSectionProps) {
  return (
    <AriaMenuSection {...props} className={styles.section}>
      {title && <Header className={styles.sectionTitle}>{title}</Header>}
      {children}
    </AriaMenuSection>
  );
}

/** Линия между группами пунктов. */
export function MenuSeparator() {
  return <Separator className={styles.separator} />;
}

export interface SubmenuProps {
  /** Текст пункта, открывающего подменю. */
  label: ReactNode;
  icon?: IconComponent;
  description?: ReactNode;
  isDisabled?: boolean;
  /** Пункты подменю. */
  children: ReactNode;
}

/**
 * Пункт с подменю: открывается при наведении через 150 мс или стрелкой →, справа от пункта (или
 * слева, если не помещается).
 */
export function Submenu({ label, icon, description, isDisabled, children }: SubmenuProps) {
  return (
    <SubmenuTrigger delay={SUBMENU_DELAY_MS}>
      <MenuItem icon={icon} description={description} isDisabled={isDisabled}>
        {label}
      </MenuItem>
      <Popover offset={-4} crossOffset={-8} className={styles.popover}>
        <Menu className={styles.menu}>{children}</Menu>
      </Popover>
    </SubmenuTrigger>
  );
}

export interface QuickReactionsProps {
  /** Последние эмодзи пользователя; показываются первые четыре. */
  emojis: readonly string[];
  onReact: (emoji: string) => void;
}

/**
 * Быстрые реакции — первая строка меню сообщения: четыре квадратные кнопки 44×44 с последними
 * эмодзи.
 */
export function QuickReactions({ emojis, onReact }: QuickReactionsProps) {
  const strings = useUiStrings();
  return (
    <AriaMenuSection aria-label={strings.menu.quickReactions} className={styles.reactions}>
      {emojis.slice(0, 4).map((emoji) => (
        <AriaMenuItem
          key={emoji}
          id={`reaction:${emoji}`}
          textValue={emoji}
          onAction={() => onReact(emoji)}
          className={styles.reaction}
        >
          {emoji}
        </AriaMenuItem>
      ))}
    </AriaMenuSection>
  );
}

export interface ContextMenuProps {
  /** Название меню для экранного диктора. */
  "aria-label": string;
  /** Область, по правому клику на которой открывается меню. */
  children: ReactNode;
  /** Пункты меню: `MenuItem`, `MenuSection`, `MenuSeparator`, `Submenu`, `QuickReactions`. */
  menu: ReactNode;
  isDisabled?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * `Menu/Context`: открывается правым кликом (или клавишей контекстного меню и Shift+F10) в точке
 * указателя. Ширина 220–300, прокрутка, если меню выше 70 % окна; навигация стрелками, Enter, Esc.
 * Вариант «с кнопкой ⋯» — `PopoverMenu` с теми же пунктами.
 */
export function ContextMenu({
  children,
  menu,
  isDisabled,
  onOpenChange,
  "aria-label": ariaLabel,
}: ContextMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const isOpen = point !== null;

  const setOpen = (next: { x: number; y: number } | null) => {
    setPoint(next);
    onOpenChange?.(next !== null);
  };
  useEscapeLayer(EscLayer.menu, () => setOpen(null), isOpen);

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    event.preventDefault();
    let { clientX: x, clientY: y } = event;
    if (x === 0 && y === 0 && event.target instanceof Element) {
      // Вызов с клавиатуры: указателя нет, меню открывается у самого элемента.
      const rect = event.target.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    setOpen({ x, y });
  };

  return (
    <>
      <div className={styles.contextTarget} onContextMenu={onContextMenu}>
        {children}
      </div>
      <span
        ref={anchor}
        aria-hidden="true"
        className={styles.anchor}
        style={point ? { left: point.x, top: point.y } : undefined}
      />
      <Popover
        triggerRef={anchor}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) setOpen(null);
        }}
        placement="bottom start"
        offset={0}
        className={styles.popover}
      >
        <Menu
          aria-label={ariaLabel}
          autoFocus="first"
          onClose={() => setOpen(null)}
          className={styles.menu}
        >
          {menu}
        </Menu>
      </Popover>
    </>
  );
}

export interface PopoverMenuProps {
  /** Кнопка-источник: кнопка дизайн-системы (`IconButton`, `Button`). */
  trigger: ReactElement;
  /** Пункты меню. */
  children: ReactNode;
  /** Название меню, если у кнопки-источника нет текста. */
  "aria-label"?: string;
  /** Содержимое над пунктами: слайдеры, `LevelMeter` (меню устройств). */
  header?: ReactNode;
  /** Содержимое под пунктами. */
  footer?: ReactNode;
  placement?: PopoverProps["placement"];
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

/**
 * `Menu/Popover`: меню под кнопкой (шеврон сервера, «⋯» звонка, стрелки устройств). Те же
 * правила, что у `Menu/Context`, плюс может содержать слайдеры и `LevelMeter`.
 */
export function PopoverMenu({
  trigger,
  children,
  header,
  footer,
  placement = "bottom start",
  isOpen: controlled,
  onOpenChange,
  "aria-label": ariaLabel,
}: PopoverMenuProps) {
  const [inner, setInner] = useState(false);
  const isOpen = controlled ?? inner;
  const setOpen = (open: boolean) => {
    setInner(open);
    onOpenChange?.(open);
  };
  useEscapeLayer(EscLayer.menu, () => setOpen(false), isOpen);

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setOpen}>
      {trigger}
      <Popover placement={placement} offset={4} className={styles.popover}>
        {header && <div className={styles.extra}>{header}</div>}
        <Menu aria-label={ariaLabel} className={styles.menu}>
          {children}
        </Menu>
        {footer && <div className={styles.extra}>{footer}</div>}
      </Popover>
    </MenuTrigger>
  );
}
