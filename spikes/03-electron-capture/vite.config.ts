// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "src/renderer");

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome140",
    rollupOptions: {
      input: {
        streamer: resolve(root, "streamer.html"),
        viewer: resolve(root, "viewer.html"),
        clock: resolve(root, "clock.html"),
      },
    },
  },
});
