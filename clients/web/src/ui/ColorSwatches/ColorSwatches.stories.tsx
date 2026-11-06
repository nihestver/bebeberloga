// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack, State, States } from "../stories/States";
import { ColorSwatches, defaultSwatches } from "./ColorSwatches";

const meta: Meta = { title: "ColorSwatches" };
export default meta;
type Story = StoryObj;

const first = defaultSwatches[4] ?? "";
const second = defaultSwatches[16] ?? "";

function Demo({ initial }: { initial: string }) {
  const [color, setColor] = useState(initial);
  return (
    <Stack gap={8}>
      <ColorSwatches label="Цвет роли" value={color} onChange={setColor} />
      <span style={{ color, fontWeight: 700 }}>Так будет выглядеть имя участника</span>
    </Stack>
  );
}

export const Default: Story = {
  render: () => (
    <Stack gap={32}>
      <Demo initial={first} />
      <States>
        <State label="Без своего цвета">
          <ColorSwatches
            aria-label="Цвет баннера"
            value={second}
            onChange={() => undefined}
            allowCustom={false}
          />
        </State>
        <State label="Неактивное">
          <ColorSwatches
            aria-label="Цвет роли"
            value={first}
            onChange={() => undefined}
            isDisabled
          />
        </State>
      </States>
    </Stack>
  ),
};
