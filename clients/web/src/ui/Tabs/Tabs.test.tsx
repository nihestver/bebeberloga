// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs, type TabItem } from "./Tabs";

const items: TabItem[] = [
  { id: "online", label: "В сети", content: "Кто в сети" },
  { id: "all", label: "Все", content: "Все друзья" },
  { id: "blocked", label: "Заблокированные", content: "Пусто", isDisabled: true },
  { id: "pending", label: "Запросы", content: "Запросы в друзья" },
];

describe("Tabs: клавиатура", () => {
  it("стрелки переключают вкладки, пропуская неактивную, и ходят по кругу", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Tabs aria-label="Друзья" items={items} onChange={onChange} />);

    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "Друзья" })).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Кто в сети");

    await user.tab();
    expect(tabs[0]).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Все друзья");

    // Неактивная вкладка пропускается.
    await user.keyboard("{ArrowRight}");
    expect(tabs[3]).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Запросы в друзья");

    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(tabs[3]).toHaveFocus();

    expect(onChange.mock.calls.map(([id]) => id as string)).toEqual([
      "all",
      "pending",
      "online",
      "pending",
    ]);
  });

  it("Home и End ведут к крайним вкладкам; Tab уходит с набора в панель", async () => {
    const user = userEvent.setup();
    render(<Tabs aria-label="Друзья" items={items} defaultSelectedId="all" />);
    const tabs = screen.getAllByRole("tab");

    await user.tab();
    expect(tabs[1]).toHaveFocus();

    await user.keyboard("{End}");
    expect(tabs[3]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });
});
