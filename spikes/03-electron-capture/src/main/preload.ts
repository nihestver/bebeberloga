// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Мост между окнами и main-процессом: окна не получают ни Node, ни модуль electron.

import { contextBridge, ipcRenderer } from "electron";
import type { S3Api } from "./types";

const api: S3Api = {
  env: () => ipcRenderer.invoke("env"),
  listSources: (types, thumb) => ipcRenderer.invoke("sources:list", types, thumb),
  selectSource: (req) => ipcRenderer.invoke("capture:select", req),
  permissions: () => ipcRenderer.invoke("perm:status"),
  openScreenSettings: () => ipcRenderer.invoke("perm:open-settings"),
  token: (room, identity) => ipcRenderer.invoke("token", room, identity),
  log: (msg) => ipcRenderer.send("log", msg),
};

contextBridge.exposeInMainWorld("s3", api);
