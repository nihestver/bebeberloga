// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./Select";

const options: SelectOption[] = [
  { id: "click", label: "По клику" },
  { id: "hover", label: "При наведении" },
  { id: "always", label: "Всегда" },
];

const many: SelectOption[] = Array.from({ length: 12 }, (_, index) => ({
  id: `m${index + 1}`,
  label: `Микрофон ${index + 1}`,
}));

describe("Select: клавиатура", () => {
  it("открывается с клавиатуры, стрелки двигают фокус, Enter выбирает", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select label="Спойлеры" options={options} defaultValue="click" onChange={onChange} />);

    await user.tab();
    const trigger = screen.getByRole("button", { name: /Спойлеры/ });
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    const listbox = await screen.findByRole("listbox");
    const items = within(listbox).getAllByRole("option");
    expect(items).toHaveLength(3);
    // Фокус встаёт на выбранный вариант; у него галочка.
    expect(items[0]).toHaveFocus();
    expect(items[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("hover");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent("При наведении");
    // Фокус возвращается на поле после закрытия списка (на следующем кадре).
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("Esc закрывает список, ничего не меняя, и возвращает фокус на поле", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select label="Спойлеры" options={options} defaultValue="click" onChange={onChange} />);

    await user.tab();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /Спойлеры/ })).toHaveFocus());
  });

  it("набор первых букв переносит фокус на вариант", async () => {
    const user = userEvent.setup();
    render(<Select label="Спойлеры" options={options} />);

    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("В");

    expect(screen.getByRole("option", { name: "Всегда" })).toHaveFocus();
  });

  it("если вариантов больше 10, появляется поиск по вводу", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select label="Микрофон" options={many} onChange={onChange} />);

    await user.tab();
    await user.keyboard("{Enter}");
    const search = await screen.findByRole("searchbox");
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(12);

    await user.keyboard("12");
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("m12");
  });

  it("у короткого списка поиска нет", async () => {
    const user = userEvent.setup();
    render(<Select label="Спойлеры" options={options} />);

    await user.click(screen.getByRole("button", { name: /Спойлеры/ }));
    await screen.findByRole("listbox");

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
