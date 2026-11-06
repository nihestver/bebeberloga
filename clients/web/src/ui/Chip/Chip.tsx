// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { Button as AriaButton, Label, Tag, TagGroup, TagList } from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import fieldStyles from "../Input/Input.module.css";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Chip.module.css";

export interface ChipItem {
  id: string;
  /** Текст капсулы: имя получателя или фильтр «автор: имя». */
  label: string;
  /** Содержимое слева от текста (аватар 16). */
  leading?: ReactNode;
}

export interface ChipGroupProps {
  /** Подпись над набором. Без неё нужен `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  items: readonly ChipItem[];
  /** Удаление капсул крестиком или клавишами Backspace и Delete. Без него крестика нет. */
  onRemove?: (ids: string[]) => void;
  /** Что показать, когда набор пуст. */
  emptyText?: ReactNode;
  className?: string;
}

/**
 * `Chip`: капсула высотой 24, текст 12 px, крестик удаления — выбранные получатели, фильтры
 * поиска. Капсулы всегда живут в наборе: стрелки переходят между ними, Backspace удаляет.
 */
export function ChipGroup({
  label,
  items,
  onRemove,
  emptyText,
  className,
  "aria-label": ariaLabel,
}: ChipGroupProps) {
  const strings = useUiStrings();
  return (
    <TagGroup
      aria-label={ariaLabel}
      onRemove={onRemove ? (keys) => onRemove([...keys].map(String)) : undefined}
      className={cx(styles.group, className)}
    >
      {label && <Label className={fieldStyles.label}>{label}</Label>}
      <TagList
        items={items}
        className={styles.list}
        renderEmptyState={() => <span className={styles.empty}>{emptyText}</span>}
      >
        {(item) => (
          <Tag id={item.id} textValue={item.label} className={styles.chip}>
            {({ allowsRemoving }) => (
              <>
                {item.leading}
                <span className={styles.text}>{item.label}</span>
                {allowsRemoving && (
                  <AriaButton
                    slot="remove"
                    aria-label={strings.chip.remove}
                    className={styles.remove}
                  >
                    <Icon icon={icons.close} size={12} />
                  </AriaButton>
                )}
              </>
            )}
          </Tag>
        )}
      </TagList>
    </TagGroup>
  );
}
