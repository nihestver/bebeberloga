// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
import type { S3Api } from "../main/types";

declare global {
  interface Window {
    s3: S3Api;
    __spike: Record<string, (...args: never[]) => unknown>;
  }
}
export {};
