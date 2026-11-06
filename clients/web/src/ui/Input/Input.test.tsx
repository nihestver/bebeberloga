// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ActionInput,
  ChannelNameInput,
  normalizeChannelName,
  RichTextInput,
  SearchInput,
  Textarea,
  TextInput,
} from "./Input";

describe("TextInput", () => {
  it("связывает подпись, пояснение и ошибку с полем", () => {
    render(
      <TextInput
        label="Имя пользователя"
        isRequired
        description="Латиница и цифры"
        errorMessage="Такое имя уже занято"
      />,
    );

    const input = screen.getByRole("textbox", { name: /Имя пользователя/ });
    expect(input).toBeRequired();
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(/Латиница и цифры/);
    expect(input).toHaveAccessibleDescription(/Такое имя уже занято/);
  });

  it("без ошибки поле валидно и текст ошибки не выводится", () => {
    render(<TextInput label="Имя" />);
    expect(screen.getByRole("textbox", { name: "Имя" })).toBeValid();
  });
});

describe("ActionInput", () => {
  it("кнопка неактивна, пока поле пустое, и отдаёт введённое значение", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <ActionInput label="Добавить друга" actionLabel="Отправить запрос" onAction={onAction} />,
    );

    const button = screen.getByRole("button", { name: "Отправить запрос" });
    expect(button).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Добавить друга" }), "  ");
    expect(button).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Добавить друга" }), "lisa");
    expect(button).toBeEnabled();

    await user.click(button);
    expect(onAction).toHaveBeenCalledWith("  lisa");
  });
});

describe("SearchInput", () => {
  it("крестик очищает поле", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput aria-label="Поиск" onChange={onChange} />);

    const input = screen.getByRole("searchbox", { name: "Поиск" });
    await user.type(input, "чай");
    expect(input).toHaveValue("чай");

    await user.click(screen.getByRole("button"));

    expect(input).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("Textarea", () => {
  it("счётчик появляется за 20 % до лимита", async () => {
    const user = userEvent.setup();
    render(<Textarea label="О себе" maxLength={10} />);
    const field = screen.getByRole("textbox", { name: "О себе" });

    await user.type(field, "1234567");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    await user.type(field, "8");
    expect(screen.getByRole("note", { name: "Осталось символов: 2" })).toHaveTextContent("2");
  });

  it("с counter=always счётчик виден сразу", () => {
    render(<Textarea label="Тема канала" maxLength={1024} counter="always" />);
    expect(screen.getByRole("note")).toHaveTextContent("1024");
  });
});

describe("RichTextInput", () => {
  it("кнопки панели сообщают выбранное форматирование; панель обходится стрелками", async () => {
    const onFormat = vi.fn();
    const onEmoji = vi.fn();
    const user = userEvent.setup();
    render(<RichTextInput label="Тема канала" onFormat={onFormat} onEmoji={onEmoji} />);

    expect(screen.getByRole("toolbar", { name: "Форматирование" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Жирный" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Курсив" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Эмодзи" }));

    expect(onFormat.mock.calls).toEqual([["bold"], ["italic"]]);
    expect(onEmoji).toHaveBeenCalledTimes(1);
  });
});

describe("ChannelNameInput", () => {
  it.each([
    ["Новый Канал", "новый-канал"],
    ["  general  chat ", "general-chat-"],
    ["Привет, мир!", "привет-мир"],
    ["a--b___c", "a-b___c"],
    ["чай🍵 и плюшки", "чай🍵-и-плюшки"],
    ["#@$%", ""],
  ])("нормализует «%s» → «%s»", (raw, expected) => {
    expect(normalizeChannelName(raw)).toBe(expected);
  });

  it("обрезает имя до 64 символов", () => {
    expect(Array.from(normalizeChannelName("я".repeat(80)))).toHaveLength(64);
  });

  it("нормализует ввод на лету", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChannelNameInput label="Название канала" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Название канала" });

    await user.type(input, "Новый Канал!");

    expect(input).toHaveValue("новый-канал");
    expect(onChange).toHaveBeenLastCalledWith("новый-канал");
  });
});
