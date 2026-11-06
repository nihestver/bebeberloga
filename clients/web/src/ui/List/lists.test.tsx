// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// ListRow, SectionHeader, Divider, Table, Card, ProgressBar, PasswordStrength, Skeleton,
// CodeInput, WaveformTrimmer.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { pick } from "../../test/pick";
import { IconButton } from "../Button/Button";
import { LinkCard, Table } from "../Card/Card";
import { CodeInput } from "../CodeInput/CodeInput";
import { icons } from "../icons/icons";
import { PasswordStrength, ProgressBar, Skeleton } from "../Progress/Progress";
import { formatDuration, WaveformTrimmer } from "../WaveformTrimmer/WaveformTrimmer";
import { Divider, ListRow, RowList, SectionHeader } from "./List";

const channels = [
  { id: "general", name: "берлога" },
  { id: "games", name: "настолки" },
  { id: "music", name: "музыка" },
];

describe("RowList и ListRow", () => {
  it("роль grid: ↑↓ ходят по строкам, → заходит в кнопки действий, Enter выбирает", async () => {
    const onAction = vi.fn();
    const onInvite = vi.fn();
    const user = userEvent.setup();
    render(
      <RowList aria-label="Каналы" items={channels} onAction={onAction}>
        {(channel) => (
          <ListRow
            id={channel.id}
            actions={<IconButton icon={icons.add} label="Пригласить" size="s" onPress={onInvite} />}
          >
            {channel.name}
          </ListRow>
        )}
      </RowList>,
    );

    expect(screen.getByRole("grid", { name: "Каналы" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);

    await user.tab();
    expect(pick(rows, 0)).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(pick(rows, 2)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(pick(rows, 1)).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith("games");

    await user.keyboard("{ArrowRight}");
    expect(within(pick(rows, 1)).getByRole("button", { name: "Пригласить" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it("выбранная строка помечена; набор первых букв переносит фокус", async () => {
    const user = userEvent.setup();
    render(
      <RowList
        aria-label="Каналы"
        items={channels}
        selectionMode="single"
        defaultSelectedKeys={["games"]}
      >
        {(channel) => <ListRow id={channel.id}>{channel.name}</ListRow>}
      </RowList>,
    );
    const rows = screen.getAllByRole("row");
    expect(pick(rows, 1)).toHaveAttribute("aria-selected", "true");

    await user.tab();
    await user.keyboard("м");
    expect(pick(rows, 2)).toHaveFocus();
  });
});

describe("SectionHeader и Divider", () => {
  it("сворачиваемый заголовок — кнопка с aria-expanded; заголовок с «+» вызывает действие", async () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <SectionHeader variant="collapsible" isExpanded onToggle={onToggle}>
          Текстовые каналы
        </SectionHeader>
        <SectionHeader variant="action" actionLabel="Новое сообщение" onAction={onAction}>
          Личные сообщения
        </SectionHeader>
      </>,
    );

    const toggle = screen.getByRole("button", { name: "Текстовые каналы" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Новое сообщение" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("разделители — separator с подписью даты или «Новое»", () => {
    render(
      <>
        <Divider />
        <Divider variant="date">12 ноября</Divider>
        <Divider variant="new" />
      </>,
    );
    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(3);
    expect(pick(separators, 1)).toHaveAccessibleName("12 ноября");
    expect(pick(separators, 2)).toHaveAccessibleName("Новое");
  });
});

describe("Table", () => {
  const columns = [
    { id: "name", label: "Участник", isRowHeader: true, allowsSorting: true },
    { id: "role", label: "Роль", allowsSorting: true },
  ];
  const rows = [
    { id: "misha", name: "Миша", role: "Владелец" },
    { id: "lisa", name: "Лиса", role: "Модератор" },
  ];

  it("клик по заголовку сообщает сортировку; стрелки ходят по строкам", async () => {
    const onSortChange = vi.fn();
    const onRowAction = vi.fn();
    const user = userEvent.setup();
    render(
      <Table
        aria-label="Участники"
        columns={columns}
        rows={rows}
        sortDescriptor={{ column: "name", direction: "ascending" }}
        onSortChange={onSortChange}
        onRowAction={onRowAction}
        renderCell={(row, column) => (column === "name" ? row.name : row.role)}
      />,
    );

    expect(screen.getByRole("grid", { name: "Участники" })).toBeInTheDocument();
    const nameHeader = screen.getByRole("columnheader", { name: /Участник/ });
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    await user.click(nameHeader);
    expect(onSortChange).toHaveBeenCalledWith({ column: "name", direction: "descending" });

    await user.click(screen.getByRole("columnheader", { name: /Роль/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ column: "role", direction: "ascending" });

    const bodyRows = screen.getAllByRole("row").slice(1);
    pick(bodyRows, 0).focus();
    await user.keyboard("{ArrowDown}");
    expect(pick(bodyRows, 1)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRowAction).toHaveBeenCalledWith("lisa");
  });
});

describe("Card, ProgressBar, PasswordStrength, Skeleton", () => {
  it("карточка-ссылка — кнопка или ссылка со стрелкой", async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <LinkCard onPress={onPress}>Мои устройства</LinkCard>
        <LinkCard href="/settings/devices">Настройки</LinkCard>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Мои устройства" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Настройки" })).toHaveAttribute(
      "href",
      "/settings/devices",
    );
  });

  it("прогресс показывает «N %»; без значения — неопределённый", () => {
    const view = render(<ProgressBar label="Загрузка" value={35} />);
    const bar = screen.getByRole("progressbar", { name: "Загрузка" });
    expect(bar).toHaveAttribute("aria-valuenow", "35");
    expect(bar).toHaveTextContent("35 %");

    view.rerender(<ProgressBar aria-label="Подключение" />);
    expect(screen.getByRole("progressbar", { name: "Подключение" })).not.toHaveAttribute(
      "aria-valuenow",
    );
  });

  it("надёжность пароля — meter с подписью, у каждой оценки свой тон", () => {
    const view = render(<PasswordStrength score={1} />);
    const meter = () => screen.getByRole("meter", { name: "Надёжность пароля" });
    expect(meter()).toHaveAttribute("aria-valuetext", "Слабый");
    expect(meter()).toHaveAttribute("data-tone", "weak");

    view.rerender(<PasswordStrength score={2} />);
    expect(meter()).toHaveAttribute("aria-valuetext", "Так себе");
    expect(meter()).toHaveAttribute("data-tone", "soso");

    view.rerender(<PasswordStrength score={4} />);
    expect(meter()).toHaveAttribute("aria-valuetext", "Отличный");
    expect(meter()).toHaveAttribute("data-tone", "good");
    expect(meter().querySelectorAll("[data-filled]")).toHaveLength(4);
  });

  it("скелетон скрыт от экранного диктора", () => {
    const { container } = render(<Skeleton width={40} height={40} isRound />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("CodeInput", () => {
  function Demo({ onComplete }: { onComplete: (value: string) => void }) {
    const [code, setCode] = useState("");
    return <CodeInput label="Код" value={code} onChange={setCode} onComplete={onComplete} />;
  }

  it("ввод сам переходит к следующей ячейке, Backspace возвращает, в конце — onComplete", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Demo onComplete={onComplete} />);
    const cells = screen.getAllByRole("textbox");
    expect(cells).toHaveLength(6);
    expect(pick(cells, 0)).toHaveAccessibleName("Цифра 1 из 6");

    await user.click(pick(cells, 0));
    await user.keyboard("12");
    expect(pick(cells, 2)).toHaveFocus();
    expect(pick(cells, 1)).toHaveValue("2");

    await user.keyboard("{Backspace}");
    expect(pick(cells, 1)).toHaveFocus();
    expect(pick(cells, 1)).toHaveValue("");

    await user.keyboard("a");
    expect(pick(cells, 1)).toHaveValue("");

    await user.keyboard("23456");
    expect(onComplete).toHaveBeenCalledWith("123456");
    expect(pick(cells, 5)).toHaveFocus();
  });

  it("вставка заполняет все ячейки, лишнее отбрасывается", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Demo onComplete={onComplete} />);
    const cells = screen.getAllByRole("textbox");

    await user.click(pick(cells, 0));
    await user.paste("48 15-16 2342");

    expect(cells.map((cell) => (cell as HTMLInputElement).value).join("")).toBe("481516");
    expect(onComplete).toHaveBeenCalledWith("481516");
  });

  it("ошибка привязана к группе ячеек", () => {
    render(<CodeInput label="Код" defaultValue="123456" errorMessage="Код не подошёл" />);
    expect(screen.getByRole("group", { name: "Код" })).toHaveAccessibleDescription(
      "Код не подошёл",
    );
    expect(pick(screen.getAllByRole("textbox"), 0)).toBeInvalid();
  });
});

describe("WaveformTrimmer", () => {
  it.each([
    [3.24, true, "0:03.2"],
    [300, false, "5:00"],
    [65.5, true, "1:05.5"],
    [0, true, "0:00.0"],
  ])("длительность %s → «%s»", (seconds, tenths, expected) => {
    expect(formatDuration(seconds, tenths)).toBe(expected);
  });

  it("две ручки — ползунки начала и конца; стрелки двигают их; показана длительность фрагмента", async () => {
    const onChange = vi.fn();
    const onPlayToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <WaveformTrimmer
        peaks={[0.2, 0.8, 0.5, 0.9, 0.3]}
        duration={10}
        limit={300}
        value={[1, 4.2]}
        onChange={onChange}
        onPlayToggle={onPlayToggle}
      />,
    );

    expect(screen.getByText("0:03.2 / 5:00")).toBeInTheDocument();
    const start = screen.getByRole("slider", { name: /Начало фрагмента/ });
    const end = screen.getByRole("slider", { name: /Конец фрагмента/ });
    expect(end).toHaveValue("4.2");

    start.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith([1.1, 4.2]);

    await user.click(screen.getByRole("button", { name: "Прослушать фрагмент" }));
    expect(onPlayToggle).toHaveBeenCalledTimes(1);
  });
});
