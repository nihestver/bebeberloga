// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Node 22: два «устройства» в одном процессе обмениваются E2EE-сообщениями через MLS.
// Байты между устройствами передаются как Buffer — так же они пойдут через сервер.

import { createRequire } from "node:module";
import { exchange } from "./exchange.mjs";

const require = createRequire(import.meta.url);
const addon = require("./s1.node");

const lines = exchange(addon);
for (const line of lines) console.log(line);
