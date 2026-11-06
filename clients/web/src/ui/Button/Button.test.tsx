// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { icons } from "../icons/icons";
import { Button, IconButton, IconToggleButton } from "./Button";

describe("Button", () => {
  it("вызывает onPress по клику и по Enter", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(<Button onPress={onPress}>Сохранить</Button>);

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.keyboard("{Enter}");

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it("неактивная кнопка не нажимается", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <Button isDisabled onPress={onPress}>
        Сохранить
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("в загрузке показывает спиннер, сохраняет текст в разметке и не нажимается", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <Button isPending onPress={onPress}>
        Сохранить
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-pending", "true");
    expect(screen.getByRole("progressbar", { name: "Загрузка…" })).toBeInTheDocument();
    // Текст остаётся в потоке: ширина кнопки не меняется.
    expect(button).toHaveTextContent("Сохранить");

    await user.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("подписана для экранного диктора тем же текстом, что в подсказке", async () => {
    const user = userEvent.setup();
    render(<IconButton icon={icons.settings} label="Настройки" />);

    const button = screen.getByRole("button", { name: "Настройки" });
    await user.tab();

    expect(button).toHaveFocus();
    // Подсказка появляется сразу при фокусе с клавиатуры.
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Настройки");
  });
});

describe("IconToggleButton", () => {
  it("переключается и сообщает состояние через aria-pressed", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IconToggleButton
        icon={icons.mic}
        label="Выключить микрофон"
        tone="danger"
        onChange={onChange}
      />,
    );

    const button = screen.getByRole("button", { name: "Выключить микрофон" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    expect(onChange).toHaveBeenCalledWith(true);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});
