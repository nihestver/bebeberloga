// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Stack, State, States } from "../stories/States";
import { SaveBar } from "./Banner";

const meta: Meta = { title: "SaveBar" };
export default meta;
type Story = StoryObj;

const noop = () => undefined;

function Demo() {
  const [attention, setAttention] = useState(0);
  return (
    <Stack gap={16}>
      <SaveBar isVisible attention={attention} onSave={noop} onReset={noop} />
      <Button variant="secondary" size="s" onPress={() => setAttention((count) => count + 1)}>
        Попытаться уйти со страницы
      </Button>
    </Stack>
  );
}

export const Default: Story = {
  render: () => (
    <States>
      <State label="Есть несохранённые изменения">
        <SaveBar isVisible onSave={noop} onReset={noop} />
      </State>
      <State label="Сохранение">
        <SaveBar isVisible isSaving onSave={noop} onReset={noop} />
      </State>
      <State label="Живой пример: вздрагивает и краснеет на 1 с">
        <Demo />
      </State>
    </States>
  ),
};
