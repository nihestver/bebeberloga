// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button/Button";
import { State, States } from "../stories/States";
import { EmptyState, SearchingBear, SleepingBear } from "./EmptyState";

const meta: Meta = { title: "EmptyState" };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <States>
      <State label="Никого нет в сети">
        <EmptyState illustration={<SleepingBear />} title="Все спят. Берлога подождёт.">
          Загляни позже или разбуди кого-нибудь сообщением.
        </EmptyState>
      </State>
      <State label="Ничего не нашлось">
        <EmptyState
          illustration={<SearchingBear />}
          title="Медведь искал везде, но ничего не нашёл"
          action={<Button>Сбросить фильтры</Button>}
        >
          Попробуй другие слова или убери фильтры.
        </EmptyState>
      </State>
      <State label="Без иллюстрации">
        <EmptyState title="Тут пока тихо">Разбуди кого-нибудь.</EmptyState>
      </State>
    </States>
  ),
};
