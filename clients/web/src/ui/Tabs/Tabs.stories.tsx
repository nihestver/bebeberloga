// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Forced, Stack, State, States } from "../stories/States";
import { Tabs, type TabItem } from "./Tabs";

const meta: Meta = { title: "Tabs" };
export default meta;
type Story = StoryObj;

const friends: TabItem[] = [
  { id: "online", label: "В сети", content: "Все спят. Берлога подождёт." },
  { id: "all", label: "Все", content: "Список всех друзей" },
  { id: "pending", label: "Запросы", content: "Входящие и исходящие запросы" },
  { id: "blocked", label: "Заблокированные", content: "Пусто", isDisabled: true },
];

const bare: TabItem[] = friends.map(({ id, label, isDisabled }) => ({ id, label, isDisabled }));
const SECOND = "[role=tab]:nth-of-type(2)";

export const Default: Story = {
  render: () => (
    <Stack gap={32}>
      <div style={{ width: 480 }}>
        <Tabs aria-label="Друзья" items={friends} defaultSelectedId="online" />
      </div>
      <States>
        <State label="Наведение на вторую">
          <Forced state="hovered" selector={SECOND}>
            <Tabs aria-label="Друзья" items={bare} />
          </Forced>
        </State>
        <State label="Фокус на второй">
          <Forced state={["focused", "focus-visible"]} selector={SECOND}>
            <Tabs aria-label="Друзья" items={bare} />
          </Forced>
        </State>
      </States>
    </Stack>
  ),
};
