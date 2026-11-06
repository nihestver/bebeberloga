// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Forced, Stack, State, States, Surface } from "../stories/States";
import { TriState, type TriStateValue } from "./SegmentedControl";

const meta: Meta = { title: "TriState" };
export default meta;
type Story = StoryObj;

function Demo({ initial = "inherit" }: { initial?: TriStateValue }) {
  const [value, setValue] = useState<TriStateValue>(initial);
  return <TriState aria-label="Видеть канал" value={value} onChange={setValue} />;
}

const noop = () => undefined;
const FIRST = "button:nth-of-type(1)";

export const Default: Story = {
  render: () => (
    <Stack gap={32}>
      <States>
        <State label="Запретить">
          <TriState aria-label="Видеть канал" value="deny" onChange={noop} />
        </State>
        <State label="Наследовать">
          <TriState aria-label="Видеть канал" value="inherit" onChange={noop} />
        </State>
        <State label="Разрешить">
          <TriState aria-label="Видеть канал" value="allow" onChange={noop} />
        </State>
        <State label="Наведение на первый">
          <Forced state="hovered" selector={FIRST}>
            <TriState aria-label="Видеть канал" value="inherit" onChange={noop} />
          </Forced>
        </State>
        <State label="Нажатие на первый">
          <Forced state={["hovered", "pressed"]} selector={FIRST}>
            <TriState aria-label="Видеть канал" value="inherit" onChange={noop} />
          </Forced>
        </State>
        <State label="Фокус на первом">
          <Forced state={["focused", "focus-visible"]} selector={FIRST}>
            <TriState aria-label="Видеть канал" value="inherit" onChange={noop} />
          </Forced>
        </State>
        <State label="Неактивное">
          <TriState aria-label="Видеть канал" value="allow" onChange={noop} isDisabled />
        </State>
      </States>
      <Surface width={360}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Видеть канал</span>
          <Demo />
        </div>
      </Surface>
    </Stack>
  ),
};
