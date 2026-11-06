// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { icons } from "../icons/icons";
import { Stack } from "../stories/States";
import { Banner } from "./Banner";

const meta: Meta = { title: "Banner", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Stack gap={12}>
      <Banner actionLabel="Показать" icon={icons.spoilerOff}>
        Этот канал скрыт
      </Banner>
      <Banner tone="info" icon={icons.info}>
        Пока открыта эта страница, сочетания отключены
      </Banner>
      <Banner tone="warning" icon={icons.laptop} actionLabel="Подтвердить">
        Новое устройство ждёт подтверждения
      </Banner>
      <Banner tone="danger" icon={icons.warning}>
        Медведь споткнулся. Переподключаемся…
      </Banner>
    </Stack>
  ),
};
