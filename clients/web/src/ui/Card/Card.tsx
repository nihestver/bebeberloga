// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Cell,
  Column,
  Link,
  Row,
  Table as AriaTable,
  TableBody,
  TableHeader,
  type SortDescriptor,
  type TableProps as AriaTableProps,
} from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { cx } from "../utils/cx";
import styles from "./Card.module.css";

export interface CardProps {
  children: ReactNode;
  /** Без внутреннего отступа 16 (содержимое само задаёт поля). */
  isFlush?: boolean;
  className?: string;
}

/** `Card`: фон Панель, радиус `--radius-l`, отступ 16. */
export function Card({ children, isFlush, className }: CardProps) {
  return (
    <div className={cx(styles.card, className)} data-flush={isFlush || undefined}>
      {children}
    </div>
  );
}

export interface LinkCardProps {
  children: ReactNode;
  /** Переход по адресу — карточка-ссылка. */
  href?: string;
  /** Действие без адреса — карточка-кнопка. */
  onPress?: () => void;
  isDisabled?: boolean;
  className?: string;
}

/** Карточка-ссылка со стрелкой справа. */
export function LinkCard({ children, href, onPress, isDisabled, className }: LinkCardProps) {
  const content = (
    <>
      <span className={styles.linkContent}>{children}</span>
      <Icon icon={icons.chevronRight} className={styles.arrow} />
    </>
  );
  const classes = cx(styles.card, styles.link, className);
  return href ? (
    <Link href={href} isDisabled={isDisabled} className={classes}>
      {content}
    </Link>
  ) : (
    <AriaButton onPress={onPress} isDisabled={isDisabled} className={classes}>
      {content}
    </AriaButton>
  );
}

export interface TableColumn {
  id: string;
  label: ReactNode;
  allowsSorting?: boolean;
  /** Колонка с именем строки (первая: аватар + имя). */
  isRowHeader?: boolean;
  /** Ширина колонки в px или долях (`"2fr"`), как у `ColumnSize` примитива. */
  width?: number | `${number}fr` | `${number}%`;
  align?: "start" | "end";
}

export interface TableProps<R extends { id: string }> extends Pick<
  AriaTableProps,
  "selectionMode" | "selectedKeys" | "onSelectionChange" | "disabledKeys"
> {
  /** Название таблицы для экранного диктора. */
  "aria-label": string;
  columns: readonly TableColumn[];
  rows: readonly R[];
  /** Содержимое ячейки. */
  renderCell: (row: R, columnId: string) => ReactNode;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  /** Клик или Enter по строке. */
  onRowAction?: (id: string) => void;
  className?: string;
}

/**
 * `Table`: заголовки колонок мелким текстом с иконкой сортировки, строки без зебры, разделители
 * `--color-border`. Навигация стрелками по строкам и ячейкам (роль `grid`).
 */
export function Table<R extends { id: string }>({
  columns,
  rows,
  renderCell,
  sortDescriptor,
  onSortChange,
  onRowAction,
  className,
  "aria-label": ariaLabel,
  ...props
}: TableProps<R>) {
  return (
    <AriaTable
      {...props}
      aria-label={ariaLabel}
      sortDescriptor={sortDescriptor}
      onSortChange={onSortChange}
      onRowAction={onRowAction ? (key) => onRowAction(String(key)) : undefined}
      className={cx(styles.table, className)}
    >
      <TableHeader className={styles.head}>
        {columns.map((column) => (
          <Column
            key={column.id}
            id={column.id}
            isRowHeader={column.isRowHeader}
            allowsSorting={column.allowsSorting}
            width={column.width}
            className={styles.column}
            data-align={column.align}
          >
            {({ sortDirection, allowsSorting }) => (
              <span className={styles.columnContent}>
                {column.label}
                {allowsSorting && (
                  <Icon
                    icon={
                      sortDirection === "ascending"
                        ? icons.sortAscending
                        : sortDirection === "descending"
                          ? icons.sortDescending
                          : icons.sort
                    }
                    size={14}
                    className={styles.sortIcon}
                  />
                )}
              </span>
            )}
          </Column>
        ))}
      </TableHeader>
      <TableBody items={rows} className={styles.body}>
        {(row) => (
          <Row id={row.id} className={styles.row}>
            {columns.map((column) => (
              <Cell key={column.id} className={styles.cell} data-align={column.align}>
                {renderCell(row, column.id)}
              </Cell>
            ))}
          </Row>
        )}
      </TableBody>
    </AriaTable>
  );
}
