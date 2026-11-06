// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useState, type ReactNode } from "react";
import {
  Autocomplete,
  Button as AriaButton,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  SearchField,
  Select as AriaSelect,
  SelectValue,
  Text,
  useFilter,
} from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import fieldStyles from "../Input/Input.module.css";
import { EscLayer, useEscapeLayer } from "../shortcuts/escape";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Select.module.css";

/** Поиск по вводу появляется, если вариантов больше этого числа (COMPONENTS §3). */
export const SELECT_SEARCH_THRESHOLD = 10;

export interface SelectOption {
  id: string;
  label: string;
  /** Вторая строка серым пояснением. */
  description?: string;
  isDisabled?: boolean;
}

export interface SelectProps {
  /** Подпись над полем; без неё нужен `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  description?: ReactNode;
  /** Текст ошибки; его наличие включает состояние ошибки. */
  errorMessage?: ReactNode;
  placeholder?: string;
  options: readonly SelectOption[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string) => void;
  isDisabled?: boolean;
  isRequired?: boolean;
  /** Имя поля формы. */
  name?: string;
  size?: "m" | "s";
  className?: string;
}

/**
 * `Select`: выглядит как `Input/Text` со стрелкой справа; список под полем (до 8 строк, дальше
 * прокрутка), выбранная строка с галочкой, поиск по вводу, если вариантов больше 10.
 */
export function Select({
  label,
  description,
  errorMessage,
  placeholder,
  options,
  value,
  defaultValue,
  onChange,
  isDisabled,
  isRequired,
  name,
  size = "m",
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const strings = useUiStrings();
  const [isOpen, setOpen] = useState(false);
  useEscapeLayer(EscLayer.menu, () => setOpen(false), isOpen);
  const { contains } = useFilter({ sensitivity: "base" });
  const searchable = options.length > SELECT_SEARCH_THRESHOLD;

  const list = (
    <ListBox
      className={styles.list}
      items={options}
      renderEmptyState={() => <div className={styles.empty}>{strings.common.nothingFound}</div>}
    >
      {(option) => (
        <ListBoxItem
          id={option.id}
          textValue={option.label}
          isDisabled={option.isDisabled}
          className={styles.option}
        >
          {({ isSelected }) => (
            <>
              <span className={styles.optionText}>
                <Text slot="label">{option.label}</Text>
                {option.description && (
                  <Text slot="description" className={styles.optionDescription}>
                    {option.description}
                  </Text>
                )}
              </span>
              {isSelected && <Icon icon={icons.check} size={16} className={styles.check} />}
            </>
          )}
        </ListBoxItem>
      )}
    </ListBox>
  );

  return (
    <AriaSelect
      aria-label={ariaLabel}
      value={value}
      defaultValue={defaultValue}
      onChange={(key) => {
        if (key !== null) onChange?.(String(key));
      }}
      isOpen={isOpen}
      onOpenChange={setOpen}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={Boolean(errorMessage)}
      placeholder={placeholder ?? strings.select.placeholder}
      name={name}
      className={cx(fieldStyles.field, className)}
    >
      {label && (
        <Label className={fieldStyles.label}>
          {label}
          {isRequired && (
            <span className={fieldStyles.required} aria-hidden="true">
              {" *"}
            </span>
          )}
        </Label>
      )}
      <AriaButton className={styles.trigger} data-control data-size={size}>
        <SelectValue className={styles.value} />
        <Icon icon={icons.chevronDown} size={16} className={styles.chevron} />
      </AriaButton>
      {description && (
        <Text slot="description" className={fieldStyles.description}>
          {description}
        </Text>
      )}
      <FieldError className={fieldStyles.error}>{errorMessage}</FieldError>
      <Popover className={styles.popover} offset={4}>
        {searchable ? (
          <Autocomplete filter={contains}>
            <SearchField aria-label={strings.common.search} autoFocus className={styles.search}>
              <Icon icon={icons.search} size={16} className={styles.searchIcon} />
              <Input
                placeholder={strings.select.searchPlaceholder}
                className={styles.searchInput}
              />
            </SearchField>
            {list}
          </Autocomplete>
        ) : (
          list
        )}
      </Popover>
    </AriaSelect>
  );
}
