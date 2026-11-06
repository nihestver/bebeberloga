// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import storybook from "eslint-plugin-storybook";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // src/gen — код из buf generate, src/ui/tokens.ts — из pnpm gen (design/tokens).
    ignores: ["src/gen/**", "src/ui/tokens.ts", "storybook-static/**", "dist/**", "coverage/**"],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat.recommended,
  storybook.configs["flat/recommended"],
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Числа в шаблонных строках — обычное дело для размеров и подписей.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `flag || undefined` — принятый способ не выводить data-атрибут для false.
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { boolean: true, string: true } },
      ],
      // Автофокус ставят примитивы доступности (модальные окна, меню) — по правилам WAI-ARIA.
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js", "vite.config.ts", ".storybook/**"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Конфигурация и скрипты сборки — обычный JavaScript без проверки типов.
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
