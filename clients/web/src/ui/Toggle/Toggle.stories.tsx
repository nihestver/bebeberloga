// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { InteractionStates, Stack, Surface } from "../stories/States";
import { Toggle } from "./Toggle";

const meta: Meta = { title: "Toggle" };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Stack gap={32}>
      <InteractionStates
        selector="label"
        render={(extra) => <Toggle aria-label="Показывать превью ссылок" {...extra} />}
      />
      <InteractionStates
        selector="label"
        render={(extra) => (
          <Toggle aria-label="Показывать превью ссылок" defaultSelected {...extra} />
        )}
      />
      <Surface width={420}>
        <Stack gap={16}>
          <div style={{ width: "100%" }}>
            <Toggle defaultSelected>Показывать превью ссылок</Toggle>
          </div>
          <div style={{ width: "100%" }}>
            <Toggle description="Эхо собственного голоса в наушниках пропадёт">
              Эхоподавление
            </Toggle>
          </div>
          <div style={{ width: "100%" }}>
            <Toggle isDisabled>Запускать вместе с системой</Toggle>
          </div>
        </Stack>
      </Surface>
    </Stack>
  ),
};
