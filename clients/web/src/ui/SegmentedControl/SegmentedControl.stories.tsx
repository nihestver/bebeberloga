// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Forced, State, States } from "../stories/States";
import { SegmentedControl } from "./SegmentedControl";

const meta: Meta = { title: "SegmentedControl" };
export default meta;
type Story = StoryObj;

const sources = [
  { id: "apps", label: "Приложения" },
  { id: "screen", label: "Весь экран" },
  { id: "devices", label: "Устройства" },
] as const;

function Demo({ isDisabled }: { isDisabled?: boolean }) {
  const [value, setValue] = useState<(typeof sources)[number]["id"]>("apps");
  return (
    <SegmentedControl
      aria-label="Источник стрима"
      options={sources}
      value={value}
      onChange={setValue}
      isDisabled={isDisabled}
    />
  );
}

const SECOND = "button:nth-of-type(2)";

export const Default: Story = {
  render: () => (
    <States>
      <State label="Обычное">
        <Demo />
      </State>
      <State label="Наведение на второй">
        <Forced state="hovered" selector={SECOND}>
          <Demo />
        </Forced>
      </State>
      <State label="Нажатие на второй">
        <Forced state={["hovered", "pressed"]} selector={SECOND}>
          <Demo />
        </Forced>
      </State>
      <State label="Фокус на втором">
        <Forced state={["focused", "focus-visible"]} selector={SECOND}>
          <Demo />
        </Forced>
      </State>
      <State label="Неактивное">
        <Demo isDisabled />
      </State>
      <State label="Два варианта">
        <SegmentedControl
          aria-label="Качество"
          options={[
            { id: "sd", label: "SD" },
            { id: "hd", label: "HD" },
          ]}
          value="hd"
          onChange={() => undefined}
        />
      </State>
    </States>
  ),
};
