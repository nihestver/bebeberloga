// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Собственные ассеты (аватары, иконки) и токены лежат в design/ в корне репозитория:
// ими пользуются все клиенты. Клиент берёт их оттуда при сборке (алиас @design).
const designDir = fileURLToPath(new URL("../../design", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@design": designDir },
  },
  server: {
    fs: { allow: [repoRoot] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Имена классов CSS Modules в тестах совпадают с исходными: по ним удобно искать элементы.
    css: { modules: { classNameStrategy: "non-scoped" } },
    restoreMocks: true,
  },
});
