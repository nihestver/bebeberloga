// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useState, type ReactNode } from "react";
import {
  Button as AriaButton,
  FieldError,
  Group,
  Input,
  Label,
  SearchField,
  Text,
  TextArea,
  TextField,
  Toolbar,
  type SearchFieldProps,
  type TextFieldProps,
} from "react-aria-components";
import { Button, IconButton } from "../Button/Button";
import { Icon, type IconComponent } from "../icons/Icon";
import { icons } from "../icons/icons";
import { formatMessage, useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Input.module.css";

type FieldBase = Omit<TextFieldProps, "children" | "className" | "style">;

interface FieldChrome {
  /** Подпись над полем (Nunito 700, 14 px). Без неё нужен `aria-label`. */
  label?: ReactNode;
  /** Пояснение под полем (Лишайник, 12 px). */
  description?: ReactNode;
  /** Текст ошибки под полем; его наличие включает состояние ошибки (рамка Брусникой). */
  errorMessage?: ReactNode;
  className?: string;
}

function FieldLabel({ children, isRequired }: { children: ReactNode; isRequired?: boolean }) {
  return (
    <Label className={styles.label}>
      {children}
      {isRequired && (
        <span className={styles.required} aria-hidden="true">
          {" *"}
        </span>
      )}
    </Label>
  );
}

function FieldNotes({
  description,
  errorMessage,
}: Pick<FieldChrome, "description" | "errorMessage">) {
  return (
    <>
      {description && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
      <FieldError className={styles.error}>{errorMessage}</FieldError>
    </>
  );
}

/** Значение поля для счётчиков и нормализации: управляемое снаружи или собственное. */
function useFieldValue(props: Pick<FieldBase, "value" | "defaultValue" | "onChange">) {
  const [inner, setInner] = useState(props.defaultValue ?? "");
  const value = props.value ?? inner;
  const change = (next: string) => {
    setInner(next);
    props.onChange?.(next);
  };
  return [value, change] as const;
}

export interface TextInputProps extends FieldBase, FieldChrome {
  placeholder?: string;
  /** Высота 40 (m) или 32 (s). */
  size?: "m" | "s";
  /** Содержимое слева от текста (иконка). */
  prefix?: ReactNode;
  /** Содержимое справа от текста (кнопка-иконка). */
  suffix?: ReactNode;
}

/** `Input/Text`: однострочное поле с подписью, пояснением и ошибкой. */
export function TextInput({
  label,
  description,
  errorMessage,
  placeholder,
  size = "m",
  prefix,
  suffix,
  className,
  ...props
}: TextInputProps) {
  const isInvalid = props.isInvalid ?? Boolean(errorMessage);
  return (
    <TextField {...props} isInvalid={isInvalid} className={cx(styles.field, className)}>
      {label && <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>}
      <Group
        role="presentation"
        className={styles.control}
        data-control
        data-size={size}
        isDisabled={props.isDisabled}
        isInvalid={isInvalid}
      >
        {prefix}
        <Input className={styles.input} placeholder={placeholder} />
        {suffix}
      </Group>
      <FieldNotes description={description} errorMessage={errorMessage} />
    </TextField>
  );
}

export interface ActionInputProps extends Omit<TextInputProps, "suffix" | "size"> {
  /** Подпись встроенной кнопки: «Отправить запрос», «Копировать». */
  actionLabel: string;
  onAction: (value: string) => void;
  isActionPending?: boolean;
}

/**
 * `Input/WithAction`: поле со встроенной справа кнопкой `Button/Primary` (S). Кнопка неактивна,
 * пока поле пустое.
 */
export function ActionInput({
  actionLabel,
  onAction,
  isActionPending,
  className,
  ...props
}: ActionInputProps) {
  const [value, change] = useFieldValue(props);
  return (
    <TextInput
      {...props}
      value={value}
      onChange={change}
      className={cx(styles.withAction, className)}
      suffix={
        <Button
          size="s"
          isDisabled={props.isDisabled === true || value.trim() === ""}
          isPending={isActionPending}
          onPress={() => onAction(value)}
        >
          {actionLabel}
        </Button>
      }
    />
  );
}

export interface SearchInputProps extends Omit<
  SearchFieldProps,
  "children" | "className" | "style"
> {
  /** Видимая подпись; если её нет, задай `aria-label`. */
  label?: ReactNode;
  placeholder?: string;
  /** Высота 32 в шапках (s), 40 в диалогах (m). */
  size?: "m" | "s";
  className?: string;
}

/** `Input/Search`: лупа слева, крестик очистки справа, когда есть текст. */
export function SearchInput({
  label,
  placeholder,
  size = "m",
  className,
  ...props
}: SearchInputProps) {
  return (
    <SearchField {...props} className={cx(styles.field, styles.search, className)}>
      {label && <Label className={styles.label}>{label}</Label>}
      <Group
        role="presentation"
        className={styles.control}
        data-control
        data-size={size}
        isDisabled={props.isDisabled}
      >
        <Icon icon={icons.search} size={16} className={styles.affix} />
        <Input className={styles.input} placeholder={placeholder} />
        <AriaButton className={styles.clear}>
          <Icon icon={icons.close} size={14} />
        </AriaButton>
      </Group>
    </SearchField>
  );
}

export interface TextareaProps extends FieldBase, FieldChrome {
  placeholder?: string;
  rows?: number;
  /**
   * Счётчик оставшихся символов (нужен `maxLength`): `auto` — появляется за 20 % до лимита,
   * `always` — всегда (тема канала), `never` — не показывать.
   */
  counter?: "auto" | "always" | "never";
  /** Панель над текстом (её задаёт `RichTextInput`). */
  toolbar?: ReactNode;
}

/** `Input/Textarea`: многострочное поле со счётчиком в правом нижнем углу. */
export function Textarea({
  label,
  description,
  errorMessage,
  placeholder,
  rows = 3,
  counter = "auto",
  toolbar,
  className,
  ...props
}: TextareaProps) {
  const strings = useUiStrings();
  const [value, change] = useFieldValue(props);
  const isInvalid = props.isInvalid ?? Boolean(errorMessage);
  const limit = props.maxLength;
  const left = limit === undefined ? undefined : limit - value.length;
  const showCounter =
    left !== undefined &&
    limit !== undefined &&
    (counter === "always" || (counter === "auto" && left <= limit * 0.2));

  return (
    <TextField
      {...props}
      value={value}
      onChange={change}
      isInvalid={isInvalid}
      className={cx(styles.field, className)}
    >
      {label && <FieldLabel isRequired={props.isRequired}>{label}</FieldLabel>}
      <Group
        role="presentation"
        className={cx(styles.control, styles.multiline)}
        data-control
        isDisabled={props.isDisabled}
        isInvalid={isInvalid}
      >
        {toolbar}
        <TextArea className={styles.textarea} placeholder={placeholder} rows={rows} />
        {showCounter && (
          <span
            className={styles.counter}
            data-low={left <= 0 || undefined}
            role="note"
            aria-label={formatMessage(strings.input.charsLeft, { count: left })}
          >
            {left}
          </span>
        )}
      </Group>
      <FieldNotes description={description} errorMessage={errorMessage} />
    </TextField>
  );
}

export type RichTextFormat = "bold" | "italic" | "underline" | "strikethrough" | "spoiler";

const FORMATS: readonly { format: RichTextFormat; icon: IconComponent }[] = [
  { format: "bold", icon: icons.bold },
  { format: "italic", icon: icons.italic },
  { format: "underline", icon: icons.underline },
  { format: "strikethrough", icon: icons.strikethrough },
  { format: "spoiler", icon: icons.spoiler },
];

export interface RichTextInputProps extends Omit<TextareaProps, "toolbar"> {
  /**
   * Нажата кнопка форматирования. Как разметка попадает в текст (Markdown-подмножество формата
   * сообщений), решает вызывающий: поле разметку не знает.
   */
  onFormat?: (format: RichTextFormat) => void;
  /** Нажата кнопка эмодзи справа. */
  onEmoji?: () => void;
}

/**
 * `Input/RichText`: `Textarea` с панелью форматирования сверху — жирный, курсив, подчёркнутый,
 * зачёркнутый, спойлер; справа эмодзи.
 */
export function RichTextInput({ onFormat, onEmoji, ...props }: RichTextInputProps) {
  const strings = useUiStrings();
  return (
    <Textarea
      {...props}
      toolbar={
        <Toolbar aria-label={strings.richText.toolbar} className={styles.toolbar}>
          {FORMATS.map(({ format, icon }) => (
            <IconButton
              key={format}
              icon={icon}
              label={strings.richText[format]}
              size="s"
              isDisabled={props.isDisabled}
              onPress={() => onFormat?.(format)}
            />
          ))}
          <span className={styles.toolbarSpacer} />
          <IconButton
            icon={icons.emoji}
            label={strings.richText.emoji}
            size="s"
            isDisabled={props.isDisabled}
            onPress={() => onEmoji?.()}
          />
        </Toolbar>
      }
    />
  );
}

/** Наибольшая длина имени канала (контракт: `Channel.name`, 1–64 символа). */
export const CHANNEL_NAME_MAX = 64;

/**
 * Нормализация имени канала на лету (COMPONENTS §3): нижний регистр, пробелы → дефисы,
 * запрещённые символы удаляются. Спецификация не перечисляет запрещённые символы; временно
 * остаются буквы и цифры любого алфавита, дефис, подчёркивание и эмодзи (вопрос в
 * docs/spec/OPEN-QUESTIONS.md).
 */
const CHANNEL_NAME_CHAR = /^[\p{L}\p{N}\p{M}\p{Extended_Pictographic}_-]$/u;
/** Соединитель и селектор начертания: из них собраны составные эмодзи. */
const EMOJI_JOINERS = new Set(["\u200D", "\uFE0F"]);

export function normalizeChannelName(raw: string): string {
  const characters = Array.from(raw.toLocaleLowerCase().replace(/\s+/gu, "-")).filter(
    (char) => CHANNEL_NAME_CHAR.test(char) || EMOJI_JOINERS.has(char),
  );
  const cleaned = characters.join("").replace(/-{2,}/g, "-").replace(/^-/, "");
  return Array.from(cleaned).slice(0, CHANNEL_NAME_MAX).join("");
}

export interface ChannelNameInputProps extends Omit<TextInputProps, "prefix" | "type"> {
  /** Значок типа канала; по умолчанию — текстовый канал. */
  icon?: IconComponent;
}

/** `Input/ChannelName`: префикс-значок типа канала слева, ввод нормализуется сразу. */
export function ChannelNameInput({ icon = icons.textChannel, ...props }: ChannelNameInputProps) {
  const [value, change] = useFieldValue(props);
  return (
    <TextInput
      {...props}
      value={value}
      onChange={(raw) => change(normalizeChannelName(raw))}
      prefix={<Icon icon={icon} size={16} className={styles.affix} />}
    />
  );
}
