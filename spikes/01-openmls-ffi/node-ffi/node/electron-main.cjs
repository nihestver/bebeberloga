// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Electron 33, main-процесс: грузит тот же .node (Node-API не зависит от ABI Electron),
// прогоняет обмен и завершает приложение. Окно не нужно.

const { app } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const { exchange } = await import(path.join(__dirname, "exchange.mjs"));
  const addon = require(path.join(__dirname, "s1.node"));
  console.log(`electron ${process.versions.electron}, node ${process.versions.node}`);
  for (const line of exchange(addon)) console.log(line);
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
