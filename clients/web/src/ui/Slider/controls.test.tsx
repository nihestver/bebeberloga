// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Slider, Slider/Threshold, LevelMeter, KeyRecorder, ColorSwatches.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { pick } from "../../test/pick";
import { ColorSwatches, defaultSwatches } from "../ColorSwatches/ColorSwatches";
import { KeyRecorder } from "../KeyRecorder/KeyRecorder";
import type { KeyCombo } from "../shortcuts/keys";
import { LevelMeter, litBars, Slider, ThresholdSlider } from "./Slider";

describe("Slider", () => {
  it("стрелки меняют значение на шаг, Home и End ведут к границам", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Slider label="Громкость" defaultValue={50} step={10} onChange={onChange} />);

    const slider = screen.getByRole("slider", { name: "Громкость" });
    await user.tab();
    expect(slider).toHaveFocus();

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(60);
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith(100);
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("при фокусе с клавиатуры значение показано подсказкой в заданном формате", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Slider label="Громкость" defaultValue={120} maxValue={200} formatValue={(v) => `${v} %`} />,
    );

    // Подсказку над бегунком показывает CSS по этим атрибутам (Slider.module.css).
    const thumb = container.querySelector(".thumb");
    expect(thumb).not.toHaveAttribute("data-focus-visible");
    await user.tab();
    expect(thumb).toHaveAttribute("data-focus-visible", "true");
    expect(container.querySelector(".bubble")).toHaveTextContent("120 %");
  });
});

describe("ThresholdSlider", () => {
  it("индикатор уровня отмечает, пройден ли порог", () => {
    const view = render(<ThresholdSlider aria-label="Порог" level={0.2} defaultValue={50} />);
    expect(view.container.querySelector(".level")).not.toHaveAttribute("data-open");

    view.rerender(<ThresholdSlider aria-label="Порог" level={0.75} defaultValue={50} />);
    expect(view.container.querySelector(".level")).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("slider", { name: "Порог" })).toHaveValue("50");
  });
});

describe("LevelMeter", () => {
  it.each([
    [0, 0],
    [0.5, 20],
    [1, 40],
    [1.7, 40],
    [-1, 0],
    [Number.NaN, 0],
  ])("уровень %s зажигает %s штрихов из 40", (level, expected) => {
    expect(litBars(level, 40)).toBe(expected);
  });

  it("штрихи заливаются слева направо, уровень доступен экранному диктору", () => {
    const { container } = render(<LevelMeter level={0.25} bars={8} />);

    const bars = [...container.querySelectorAll(".bar")];
    expect(bars.map((bar) => bar.hasAttribute("data-lit"))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(screen.getByRole("meter", { name: "Уровень звука" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
  });
});

describe("KeyRecorder", () => {
  function Demo({ onChange }: { onChange: (combo: KeyCombo) => void }) {
    const [combo, setCombo] = useState<KeyCombo | null>(null);
    return (
      <KeyRecorder
        label="Сочетание"
        value={combo}
        platform="other"
        onChange={(next) => {
          setCombo(next);
          onChange(next);
        }}
      />
    );
  }

  it("записывает следующее нажатие и показывает его клавишами", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo onChange={onChange} />);
    const field = screen.getByRole("group", { name: "Сочетание" });
    expect(field).toHaveTextContent("Не назначено");

    await user.click(screen.getByRole("button", { name: "Записать" }));
    expect(field).toHaveAttribute("data-recording", "true");
    expect(field).toHaveTextContent("Нажми сочетание клавиш");

    // Одни модификаторы — ещё не сочетание.
    fireEvent.keyDown(window, { code: "ControlLeft", key: "Control", ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { code: "KeyM", key: "ь", ctrlKey: true, shiftKey: true });

    expect(onChange).toHaveBeenCalledWith({ code: "KeyM", ctrl: true, shift: true });
    expect(field).not.toHaveAttribute("data-recording");
    expect(within(field).getAllByText(/^(Ctrl|Shift|M)$/)).toHaveLength(3);
  });

  it("Esc отменяет запись и не доходит до остального интерфейса", async () => {
    const onChange = vi.fn();
    const outer = vi.fn();
    const user = userEvent.setup();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- проверка всплытия
      <div onKeyDown={outer}>
        <Demo onChange={onChange} />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Записать" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Готово" }), {
      code: "Escape",
      key: "Escape",
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Сочетание" })).not.toHaveAttribute("data-recording");
  });
});

describe("ColorSwatches", () => {
  it("по умолчанию показывает 20 образцов из токенов сеткой и отмечает текущий", () => {
    const current = defaultSwatches[4] ?? "";
    render(<ColorSwatches label="Цвет роли" value={current} onChange={() => undefined} />);

    expect(defaultSwatches).toHaveLength(20);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(20);
    expect(options.filter((option) => option.getAttribute("aria-selected") === "true")).toEqual([
      options[4],
    ]);
    expect(screen.getByRole("button", { name: "Свой цвет" })).toBeInTheDocument();
  });

  it("выбор образца отдаёт цвет в записи #RRGGBB", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const current = defaultSwatches[0] ?? "";
    render(<ColorSwatches label="Цвет роли" value={current} onChange={onChange} />);

    await user.click(pick(screen.getAllByRole("option"), 7));

    expect(onChange).toHaveBeenCalledWith(defaultSwatches[7]);
  });
});
