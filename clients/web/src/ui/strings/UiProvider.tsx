// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { createContext, use, type ReactNode } from "react";
import { I18nProvider } from "react-aria-components";
import en from "../../locales/en/ui.json";
import ru from "../../locales/ru/ui.json";

/** Тексты, встроенные в компоненты дизайн-системы (подписи кнопок, aria-подписи). */
export type UiStrings = typeof ru;
export type UiLocale = "ru" | "en";

const dictionaries: Record<UiLocale, UiStrings> = { ru, en };
const bcp47: Record<UiLocale, string> = { ru: "ru-RU", en: "en-US" };

const StringsContext = createContext<UiStrings>(ru);

export interface UiProviderProps {
  /** Язык интерфейса; по умолчанию русский. */
  locale?: UiLocale;
  children: ReactNode;
}

/**
 * Задаёт язык встроенных текстов дизайн-системы и локаль примитивов доступности (форматы чисел,
 * подписи для экранных дикторов). Тексты лежат в `src/locales/<язык>/ui.json`; библиотеку i18n
 * для остального приложения выбирает оболочка клиента и оборачивает ею этот провайдер.
 */
export function UiProvider({ locale = "ru", children }: UiProviderProps) {
  return (
    <I18nProvider locale={bcp47[locale]}>
      <StringsContext value={dictionaries[locale]}>{children}</StringsContext>
    </I18nProvider>
  );
}

export function useUiStrings(): UiStrings {
  return use(StringsContext);
}

/** Подставляет значения в шаблон вида «{name} звонит». */
export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}
