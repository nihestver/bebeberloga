// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Forced, State, States } from "../stories/States";
import { ChipGroup, type ChipItem } from "./Chip";

const meta: Meta = { title: "Chip" };
export default meta;
type Story = StoryObj;

const people: ChipItem[] = [
  { id: "misha", label: "Миша" },
  { id: "lisa", label: "Лиса" },
  { id: "ezh", label: "Ёж" },
];

function Removable() {
  const [items, setItems] = useState(people);
  return (
    <ChipGroup
      label="Получатели"
      items={items}
      emptyText="Никого не выбрано"
      onRemove={(ids) => setItems((current) => current.filter((item) => !ids.includes(item.id)))}
    />
  );
}

const noop = () => undefined;
const FIRST = "[role=row]";

export const Default: Story = {
  render: () => (
    <States>
      <State label="С удалением (живой пример)">
        <Removable />
      </State>
      <State label="Наведение на первую">
        <Forced state="hovered" selector={FIRST}>
          <ChipGroup aria-label="Получатели" items={people} onRemove={noop} />
        </Forced>
      </State>
      <State label="Фокус на первой">
        <Forced state={["focused", "focus-visible"]} selector={FIRST}>
          <ChipGroup aria-label="Получатели" items={people} onRemove={noop} />
        </Forced>
      </State>
      <State label="Без крестика: фильтры">
        <ChipGroup
          aria-label="Фильтры поиска"
          items={[
            { id: "author", label: "автор: Миша" },
            { id: "has", label: "есть: файл" },
          ]}
        />
      </State>
      <State label="Пусто">
        <ChipGroup aria-label="Получатели" items={[]} emptyText="Никого не выбрано" />
      </State>
    </States>
  ),
};
