// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { act, render, screen, waitFor } from "@testing-library/react";
import jsQR from "jsqr";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QR_CENTER, QR_PADDING, QR_SIZE, QRCode, qrModules } from "./QRCode";
import { QR_SCAN_INTERVAL_MS, QRScanner, type QRFrame } from "./QRScanner";

// Цвета берутся из собранных токенов: тест проверяет настоящую пару Туман/Хвоя.
const tokensCss = readFileSync(join(process.cwd(), "src/ui/tokens.css"), "utf8");

/** Значение цвета из tokens.css → составляющие RGB. */
function tokenRgb(name: string): [number, number, number] {
  const match = new RegExp(`--${name}: #([0-9a-f]{6});`).exec(tokensCss);
  if (!match?.[1]) throw new Error(`нет цвета --${name}`);
  const hex = match[1];
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Модули, которые реально отрисованы в SVG: разбор пути `M x y h1 v1 h-1 z`. */
function renderedModules(svg: SVGElement): Set<string> {
  const d = svg.querySelector("path")?.getAttribute("d") ?? "";
  const cells = new Set<string>();
  for (const match of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) cells.add(`${match[1]},${match[2]}`);
  return cells;
}

/**
 * Растр отрисованного кода в масштабе компонента: 200 px с отступом 12, цвета Хвоя на Тумане,
 * по центру — непрозрачный квадрат 32 px (символ проекта закрывает модули).
 */
function rasterize(svg: SVGElement, options: { center: boolean }): QRFrame {
  const count = Number(svg.getAttribute("data-modules"));
  const cells = renderedModules(svg);
  const scale = 4;
  const area = (QR_SIZE - 2 * QR_PADDING) * scale;
  const module = area / count;
  const size = QR_SIZE * scale;
  const [fr, fg, fb] = tokenRgb("color-qr-fg");
  const [br, bg, bb] = tokenRgb("color-qr-bg");
  const data = new Uint8ClampedArray(size * size * 4);
  const centerFrom = (size - QR_CENTER * scale) / 2;
  const centerTo = centerFrom + QR_CENTER * scale;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor((x - QR_PADDING * scale) / module);
      const my = Math.floor((y - QR_PADDING * scale) / module);
      const inCenter =
        options.center && x >= centerFrom && x < centerTo && y >= centerFrom && y < centerTo;
      const dark =
        !inCenter && mx >= 0 && my >= 0 && mx < count && my < count && cells.has(`${mx},${my}`);
      // Символ проекта в тесте — сплошной тёмный квадрат: худший случай для распознавания.
      const [r, g, b] = inCenter || dark ? [fr, fg, fb] : [br, bg, bb];
      const offset = (y * size + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

describe("QRCode", () => {
  const value = "https://berloga.example/device/verify?c=7Q2N-4KXP-9HZT&k=0123456789abcdef";

  it("собирается с коррекцией ошибок H и рисуется одним путём SVG", () => {
    const modules = qrModules(value);
    const { container } = render(<QRCode value={value} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(Number(svg?.getAttribute("data-modules"))).toBe(modules.length);
    expect(renderedModules(svg as SVGElement).size).toBe(modules.flat().filter(Boolean).length);
    expect(screen.getByRole("img", { name: "QR-код" })).toBeInTheDocument();
  });

  it("отрисованный код читается независимым декодером (jsQR) — с символом в центре и без", () => {
    const { container } = render(<QRCode value={value} center={<span>лого</span>} />);
    const svg = container.querySelector("svg") as SVGElement;

    for (const center of [false, true]) {
      const frame = rasterize(svg, { center });
      const result = jsQR(frame.data, frame.width, frame.height);
      expect(result?.data, center ? "с символом в центре" : "без символа").toBe(value);
    }
  });

  it("короткое и длинное содержимое дают коды разного размера, оба читаются", () => {
    for (const text of ["bb", "x".repeat(300)]) {
      const { container, unmount } = render(<QRCode value={text} />);
      const svg = container.querySelector("svg") as SVGElement;
      const frame = rasterize(svg, { center: true });
      expect(jsQR(frame.data, frame.width, frame.height)?.data).toBe(text);
      unmount();
    }
  });
});

describe("QRScanner", () => {
  function fakeStream(): MediaStream {
    const track = { stop: vi.fn() };
    return { getTracks: () => [track] } as unknown as MediaStream;
  }

  it("запрашивает камеру, читает кадры и сообщает распознанный код", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getStream = vi.fn(() => Promise.resolve(stream));
    const decode = vi.fn((_frame: QRFrame) => "berloga://verify/1");
    const onDecode = vi.fn();
    const onStateChange = vi.fn();
    // jsdom не рисует видео: подменяем размеры кадра и холст.
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      value: 8,
      configurable: true,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      value: 6,
      configurable: true,
    });
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve());
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          drawImage: vi.fn(),
          getImageData: () => ({ width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) }),
        }) as unknown as CanvasRenderingContext2D,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const view = render(
      <QRScanner
        getStream={getStream}
        decode={decode}
        onDecode={onDecode}
        onStateChange={onStateChange}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Включаем камеру…");

    await act(async () => {
      await Promise.resolve();
    });
    expect(onStateChange).toHaveBeenLastCalledWith("active");
    expect(screen.getByRole("status")).toHaveTextContent("Наведи камеру на QR-код");

    act(() => {
      vi.advanceTimersByTime(QR_SCAN_INTERVAL_MS + 10);
    });
    expect(decode).toHaveBeenCalledWith(expect.objectContaining({ width: 8, height: 6 }));
    expect(onDecode).toHaveBeenCalledWith("berloga://verify/1");

    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("без доступа к камере объясняет, что делать", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    render(<QRScanner getStream={() => Promise.reject(denied)} onDecode={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Нет доступа к камере"),
    );
  });

  it("без камеры сообщает, что она не найдена", async () => {
    const missing = Object.assign(new Error("missing"), { name: "NotFoundError" });
    render(<QRScanner getStream={() => Promise.reject(missing)} onDecode={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Камера не найдена"));
    expect(fakeStream().getTracks()).toHaveLength(1);
  });
});
