// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  GridList,
  GridListItem,
  Text,
  type GridListItemProps,
  type GridListProps,
  type Key,
} from "react-aria-components";
import { IconButton } from "../Button/Button";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./List.module.css";

export interface RowListProps<T extends { id: string }> extends Omit<
  GridListProps<T>,
  "children" | "className" | "style" | "items" | "onAction" | "aria-label"
> {
  /** Название списка для экранного диктора. */
  "aria-label": string;
  items: readonly T[];
  /** Рисует строку: `ListRow` с `id` элемента. */
  children: (item: T) => ReactNode;
  /** Клик или Enter по строке. */
  onAction?: (id: string) => void;
  /** Текст, когда список пуст (обычно — `EmptyState`). */
  renderEmptyState?: () => ReactNode;
  className?: string;
}

/**
 * Список строк `ListRow` с навигацией стрелками (роль `grid`, COMPONENTS §8): ↑↓ ходят по строкам,
 * ←→ — по кнопкам действий внутри строки, Home и End — к крайним.
 */
export function RowList<T extends { id: string }>({
  items,
  children,
  onAction,
  renderEmptyState,
  className,
  ...props
}: RowListProps<T>) {
  return (
    <GridList
      {...props}
      items={items}
      onAction={onAction ? (key: Key) => onAction(String(key)) : undefined}
      renderEmptyState={renderEmptyState}
      className={cx(styles.list, className)}
    >
      {children}
    </GridList>
  );
}

export interface ListRowProps extends Omit<
  GridListItemProps,
  "children" | "className" | "style" | "textValue"
> {
  /** Основной текст строки. */
  children: ReactNode;
  /** Содержимое слева: иконка канала, `Avatar` 32. */
  leading?: ReactNode;
  /** Вторая строка Лишайником (статус, последнее сообщение). */
  description?: ReactNode;
  /** Содержимое справа, видимое всегда: `CountBadge`, время. */
  trailing?: ReactNode;
  /** Кнопки действий справа: появляются при наведении и при фокусе. */
  actions?: ReactNode;
  /** Высота 32 (список каналов) … 42 (личные сообщения с двумя строками). */
  height?: 32 | 36 | 42;
  /** Текст для набора первых букв; нужен, если `children` — не строка. */
  textValue?: string;
  /** Строка Брусникой: «Выйти». */
  isDanger?: boolean;
  className?: string;
}

/**
 * `ListRow`: строка высотой 32–42, отступ слева 8, радиус `--radius-s`; при наведении фон
 * `--color-panel-hover`, выбранная — `--color-panel-active` и текст Туманом. Живёт в `RowList`.
 */
export function ListRow({
  children,
  leading,
  description,
  trailing,
  actions,
  height = 32,
  textValue,
  isDanger,
  className,
  ...props
}: ListRowProps) {
  return (
    <GridListItem
      {...props}
      textValue={textValue ?? (typeof children === "string" ? children : undefined)}
      className={cx(styles.row, className)}
      data-height={height}
      data-danger={isDanger || undefined}
    >
      {leading && <span className={styles.leading}>{leading}</span>}
      <span className={styles.text}>
        <span className={styles.title}>{children}</span>
        {description && (
          <Text slot="description" className={styles.description}>
            {description}
          </Text>
        )}
      </span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
      {actions && <span className={styles.actions}>{actions}</span>}
    </GridListItem>
  );
}

export interface SectionHeaderProps {
  children: ReactNode;
  /**
   * `collapsible` — заглавными со стрелкой сворачивания (список каналов); `action` — обычным
   * регистром с кнопкой «+» справа (список личных сообщений); `plain` — просто подпись.
   */
  variant?: "plain" | "collapsible" | "action";
  isExpanded?: boolean;
  onToggle?: (isExpanded: boolean) => void;
  /** Подпись кнопки «+» для экранного диктора: «Новое сообщение». */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/** `SectionHeader`: мелкий текст 12 px Лишайником. */
export function SectionHeader({
  children,
  variant = "plain",
  isExpanded = true,
  onToggle,
  actionLabel,
  onAction,
  className,
}: SectionHeaderProps) {
  const strings = useUiStrings();
  return (
    <div className={cx(styles.section, className)} data-variant={variant}>
      {variant === "collapsible" ? (
        <AriaButton
          className={styles.sectionToggle}
          aria-expanded={isExpanded}
          onPress={() => onToggle?.(!isExpanded)}
        >
          <Icon icon={icons.chevronRight} size={12} className={styles.chevron} />
          <span>{children}</span>
        </AriaButton>
      ) : (
        <span className={styles.sectionText}>{children}</span>
      )}
      {variant === "action" && (
        <IconButton
          icon={icons.add}
          label={actionLabel ?? strings.common.search}
          size="s"
          onPress={onAction}
        />
      )}
    </div>
  );
}

export interface DividerProps {
  /** `date` — дата по центру; `new` — линия Брусникой с капсулой «Новое» справа. */
  variant?: "plain" | "date" | "new";
  /** Текст даты для `date`. */
  children?: ReactNode;
  className?: string;
}

/** `Divider`, `Divider/Date`, `Divider/New`: линия 1 px `--color-border`. */
export function Divider({ variant = "plain", children, className }: DividerProps) {
  const strings = useUiStrings();
  const label = variant === "new" ? strings.badge.new : children;
  return (
    <div
      role="separator"
      aria-label={typeof label === "string" ? label : undefined}
      className={cx(styles.divider, className)}
      data-variant={variant}
    >
      {label && (
        <span className={styles.dividerLabel} aria-hidden="true">
          {label}
        </span>
      )}
    </div>
  );
}
