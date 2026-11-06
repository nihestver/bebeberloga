// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Переключатели выбора: TriState, SegmentedControl, RadioGroup, Toggle, Checkbox, Chip.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { pick } from "../../test/pick";
import { Checkbox } from "../Checkbox/Checkbox";
import { ChipGroup } from "../Chip/Chip";
import { Radio, RadioGroup } from "../Radio/Radio";
import { Toggle } from "../Toggle/Toggle";
import { SegmentedControl, TriState, type TriStateValue } from "./SegmentedControl";

describe("TriState", () => {
  function Demo({ onChange }: { onChange: (value: TriStateValue) => void }) {
    const [value, setValue] = useState<TriStateValue>("inherit");
    return (
      <TriState
        aria-label="Видеть канал"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }

  it("три подписанных варианта, выбран ровно один, выбор нельзя снять", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo onChange={onChange} />);

    const group = screen.getByRole("radiogroup", { name: "Видеть канал" });
    expect(group).toBeInTheDocument();
    const deny = screen.getByRole("radio", { name: "Запретить" });
    const inherit = screen.getByRole("radio", { name: "Наследовать" });
    const allow = screen.getByRole("radio", { name: "Разрешить" });
    expect(inherit).toBeChecked();

    await user.click(allow);
    expect(onChange).toHaveBeenLastCalledWith("allow");
    expect(allow).toBeChecked();
    expect(inherit).not.toBeChecked();

    // Повторный клик по выбранному ничего не меняет.
    await user.click(allow);
    expect(onChange).toHaveBeenCalledTimes(1);

    await user.click(deny);
    expect(onChange).toHaveBeenLastCalledWith("deny");
  });
});

describe("SegmentedControl", () => {
  it("стрелки переходят между сегментами, пробел выбирает", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentedControl
        aria-label="Источник стрима"
        options={[
          { id: "apps", label: "Приложения" },
          { id: "screen", label: "Весь экран" },
        ]}
        value="apps"
        onChange={onChange}
      />,
    );

    await user.tab();
    expect(screen.getByRole("radio", { name: "Приложения" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Весь экран" })).toHaveFocus();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith("screen");
  });
});

describe("RadioGroup", () => {
  it("стрелки ↑↓ меняют выбор; пояснение привязано к варианту", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RadioGroup label="Профиль ввода" defaultValue="clean" onChange={onChange}>
        <Radio value="clean" description="Вся обработка">
          Чистый голос
        </Radio>
        <Radio value="raw" description="Без обработки">
          Как есть
        </Radio>
        <Radio value="custom">Пользовательский</Radio>
      </RadioGroup>,
    );

    expect(screen.getByRole("radiogroup", { name: "Профиль ввода" })).toBeInTheDocument();
    const raw = screen.getByRole("radio", { name: "Как есть" });
    expect(raw).toHaveAccessibleDescription("Без обработки");

    await user.tab();
    expect(screen.getByRole("radio", { name: "Чистый голос" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(raw).toBeChecked();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Чистый голос" })).toBeChecked();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "Пользовательский" })).toBeChecked();

    expect(onChange.mock.calls.map(([value]) => value as string)).toEqual([
      "raw",
      "custom",
      "clean",
      "custom",
    ]);
  });
});

describe("Toggle и Checkbox", () => {
  it("Toggle — переключатель с ролью switch, пробел меняет состояние", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Toggle description="Эхо пропадёт" onChange={onChange}>
        Эхоподавление
      </Toggle>,
    );

    const toggle = screen.getByRole("switch", { name: "Эхоподавление" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription("Эхо пропадёт");

    await user.tab();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith(true);
    expect(toggle).toBeChecked();
  });

  it("Checkbox отмечается кликом по подписи; неактивный — нет", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Checkbox onChange={onChange}>Заглушить для себя</Checkbox>
        <Checkbox isDisabled onChange={onChange}>
          Недоступно
        </Checkbox>
      </>,
    );

    await user.click(screen.getByText("Заглушить для себя"));
    await user.click(screen.getByText("Недоступно"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: "Заглушить для себя" })).toBeChecked();
  });
});

describe("ChipGroup", () => {
  it("капсула удаляется крестиком", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <ChipGroup
        label="Получатели"
        items={[
          { id: "misha", label: "Миша" },
          { id: "lisa", label: "Лиса" },
        ]}
        onRemove={onRemove}
      />,
    );

    await user.click(pick(screen.getAllByRole("button", { name: /Убрать/ })));
    expect(onRemove).toHaveBeenLastCalledWith(["misha"]);
  });

  it("стрелки переходят между капсулами, Backspace удаляет ту, что в фокусе", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <ChipGroup
        label="Получатели"
        items={[
          { id: "misha", label: "Миша" },
          { id: "lisa", label: "Лиса" },
        ]}
        onRemove={onRemove}
      />,
    );

    await user.tab();
    await user.keyboard("{ArrowRight}{Backspace}");
    expect(onRemove).toHaveBeenLastCalledWith(["lisa"]);
  });

  it("без onRemove крестика нет", () => {
    render(<ChipGroup aria-label="Фильтры" items={[{ id: "a", label: "автор: Миша" }]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
