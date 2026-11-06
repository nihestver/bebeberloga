// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { SortDescriptor } from "react-aria-components";
import { Avatar } from "../Avatar/Avatar";
import { PillBadge } from "../Badge/Badge";
import { IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { Stack, State, States } from "../stories/States";
import { Card, LinkCard, Table, type TableColumn } from "./Card";

const meta: Meta = { title: "Card" };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <States>
      <State label="Карточка">
        <Card>
          <Stack gap={4}>
            <strong>Ключ восстановления</strong>
            <span style={{ color: "var(--color-muted)" }}>
              Понадобится, если не останется ни одного устройства.
            </span>
          </Stack>
        </Card>
      </State>
      <State label="Карточка-ссылка">
        <div style={{ width: 320 }}>
          <LinkCard onPress={() => undefined}>
            <Stack gap={2}>
              <strong>Мои устройства</strong>
              <span style={{ color: "var(--color-muted)" }}>3 подтверждённых</span>
            </Stack>
          </LinkCard>
        </div>
      </State>
      <State label="Без отступа">
        <Card isFlush>
          <div style={{ padding: 8 }}>содержимое со своими полями</div>
        </Card>
      </State>
    </States>
  ),
};

interface Member {
  id: string;
  name: string;
  avatar: string;
  role: string;
  joined: string;
  isOwner?: boolean;
}

const members: Member[] = [
  {
    id: "misha",
    name: "Миша",
    avatar: "bear",
    role: "Владелец",
    joined: "2026-01-12",
    isOwner: true,
  },
  { id: "lisa", name: "Лиса", avatar: "fox", role: "Модератор", joined: "2026-02-03" },
  { id: "ezh", name: "Ёж", avatar: "hedgehog", role: "Участник", joined: "2026-03-20" },
  { id: "sova", name: "Сова", avatar: "owl", role: "Участник", joined: "2026-04-08" },
];

const columns: TableColumn[] = [
  { id: "name", label: "Участник", isRowHeader: true, allowsSorting: true },
  { id: "role", label: "Роль", allowsSorting: true },
  { id: "joined", label: "Вступил", allowsSorting: true },
  { id: "actions", label: "", width: 48, align: "end" },
];

function MembersTable() {
  const [sort, setSort] = useState<SortDescriptor>({ column: "name", direction: "ascending" });
  const rows = [...members].sort((a, b) => {
    const key = sort.column as keyof Member;
    const result = String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "ru");
    return sort.direction === "descending" ? -result : result;
  });
  return (
    <div style={{ width: 560 }}>
      <Table
        aria-label="Участники"
        columns={columns}
        rows={rows}
        sortDescriptor={sort}
        onSortChange={setSort}
        renderCell={(row, column) => {
          switch (column) {
            case "name":
              return (
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <Avatar name={row.name} avatarId={row.avatar} size={32} isDecorative />
                  <strong>{row.name}</strong>
                  {row.isOwner && <PillBadge tone="accent">Владелец</PillBadge>}
                </span>
              );
            case "role":
              return row.role;
            case "joined":
              return new Date(row.joined).toLocaleDateString("ru-RU");
            default:
              return <IconButton icon={icons.more} label="Действия" size="s" />;
          }
        }}
      />
    </div>
  );
}

/** `Table` — отдельный компонент каталога: сортировка по клику на заголовок, первая колонка — аватар + имя. */
export const TableStory: Story = {
  name: "Table",
  render: () => <MembersTable />,
};
