// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Preview } from "@storybook/react-vite";
import "../src/ui/styles";
import { UiProvider, type UiLocale } from "../src/ui/strings/UiProvider";

const preview: Preview = {
  parameters: {
    layout: "centered",
    // Нарушения доступности уровня serious и critical валят проверку истории (addon-a11y).
    a11y: { test: "error" },
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
  globalTypes: {
    locale: {
      description: "Язык интерфейса",
      toolbar: {
        icon: "globe",
        items: [
          { value: "ru", title: "Русский" },
          { value: "en", title: "English" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { locale: "ru" },
  decorators: [
    (Story, context) => (
      <UiProvider locale={context.globals.locale as UiLocale}>
        <Story />
      </UiProvider>
    ),
  ],
};

export default preview;
