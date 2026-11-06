// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom не реализует часть API браузера, на которые опираются всплывающие элементы.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    // размеры в jsdom не меняются
  }
  unobserve(): void {
    // размеры в jsdom не меняются
  }
  disconnect(): void {
    // размеры в jsdom не меняются
  }
}

const missing = (owner: object, name: string) => !(name in owner);
// Тесты с `@vitest-environment node` (сборка токенов) идут без DOM.
const hasDom = "window" in globalThis;

if (hasDom && missing(globalThis, "ResizeObserver")) {
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (hasDom && missing(window, "matchMedia")) {
  const noop = () => undefined;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (hasDom && missing(Element.prototype, "scrollIntoView")) {
  Element.prototype.scrollIntoView = () => undefined;
}
