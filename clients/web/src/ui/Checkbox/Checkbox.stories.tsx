// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { InteractionStates, Stack, State, States } from "../stories/States";
import { Checkbox } from "./Checkbox";

const meta: Meta = { title: "Checkbox" };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Stack gap={32}>
      <InteractionStates
        selector="label"
        render={(extra) => <Checkbox {...extra}>Заглушить для себя</Checkbox>}
      />
      <InteractionStates
        selector="label"
        render={(extra) => (
          <Checkbox defaultSelected {...extra}>
            Заглушить для себя
          </Checkbox>
        )}
      />
      <States>
        <State label="Частично">
          <Checkbox isIndeterminate>Все каналы категории</Checkbox>
        </State>
        <State label="Ошибка">
          <Checkbox isInvalid>Я сохранил ключ восстановления</Checkbox>
        </State>
        <State label="Без подписи">
          <Checkbox aria-label="Показывать статистику" defaultSelected />
        </State>
      </States>
    </Stack>
  ),
};
