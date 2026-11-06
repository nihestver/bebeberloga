// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useId, type ReactNode } from "react";
import {
  FieldError,
  Label,
  RadioButton,
  RadioField,
  RadioGroup as AriaRadioGroup,
  Text,
  type RadioFieldProps,
  type RadioGroupProps as AriaRadioGroupProps,
} from "react-aria-components";
import { Icon, type IconComponent } from "../icons/Icon";
import fieldStyles from "../Input/Input.module.css";
import { cx } from "../utils/cx";
import styles from "./Radio.module.css";

export interface RadioGroupProps extends Omit<
  AriaRadioGroupProps,
  "children" | "className" | "style"
> {
  /** Заголовок группы. Без него нужен `aria-label`. */
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  /** Варианты: `Radio` (список) или `RadioCard` (карточки). */
  children: ReactNode;
  className?: string;
}

/**
 * `RadioGroup`: вертикальный список вариантов; стрелки ↑↓ меняют выбор. Для `RadioCard` задай
 * `orientation="horizontal"`, если карточки стоят в ряд.
 */
export function RadioGroup({
  label,
  description,
  errorMessage,
  children,
  className,
  ...props
}: RadioGroupProps) {
  return (
    <AriaRadioGroup
      {...props}
      isInvalid={props.isInvalid ?? Boolean(errorMessage)}
      className={cx(styles.group, className)}
    >
      {label && <Label className={fieldStyles.label}>{label}</Label>}
      {description && (
        <Text slot="description" className={fieldStyles.description}>
          {description}
        </Text>
      )}
      <div className={styles.options}>{children}</div>
      <FieldError className={fieldStyles.error}>{errorMessage}</FieldError>
    </AriaRadioGroup>
  );
}

export interface RadioProps extends Omit<RadioFieldProps, "children" | "className" | "style"> {
  /** Заголовок варианта (Nunito 700). */
  children: ReactNode;
  /** Пояснение Лишайником под заголовком. */
  description?: ReactNode;
  className?: string;
}

function RadioOption({
  children,
  description,
  icon,
  isCard,
  className,
  ...props
}: RadioProps & { icon?: IconComponent; isCard?: boolean }) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <RadioField
      {...props}
      // Имя варианта — только заголовок; пояснение читается как описание.
      aria-labelledby={props["aria-labelledby"] ?? titleId}
      aria-describedby={description ? descriptionId : props["aria-describedby"]}
      className={styles.option}
    >
      <RadioButton className={cx(styles.radio, isCard && styles.card, className)}>
        <span className={styles.circle} />
        {icon && <Icon icon={icon} size={24} className={styles.icon} />}
        <span className={styles.text}>
          <span id={titleId} className={styles.title}>
            {children}
          </span>
          {description && (
            <span id={descriptionId} className={styles.description}>
              {description}
            </span>
          )}
        </span>
      </RadioButton>
    </RadioField>
  );
}

/** `Radio`: круг 20; выбран — кольцо Шалфеем с точкой. Строка с заголовком и пояснением. */
export function Radio(props: RadioProps) {
  return <RadioOption {...props} />;
}

export interface RadioCardProps extends RadioProps {
  /** Иконка варианта (значок типа канала). */
  icon?: IconComponent;
}

/** `RadioCard`: радио в виде карточки с рамкой; при выборе рамка Шалфеем. */
export function RadioCard(props: RadioCardProps) {
  return <RadioOption {...props} isCard />;
}
