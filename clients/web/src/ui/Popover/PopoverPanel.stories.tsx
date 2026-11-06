// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { Stack } from "../stories/States";
import { PopoverPanel } from "./PopoverPanel";

const meta: Meta = { title: "Popover" };
export default meta;
type Story = StoryObj;

const pinned = [
  ["Миша", "Правила берлоги: не шуметь после полуночи."],
  ["Лиса", "Ссылка на таблицу с настолками."],
  ["Ёж", "Сбор в голосовом по пятницам в 20:00."],
] as const;

/** `Popover/Panel`: закреплённые сообщения под кнопкой в шапке канала. */
export const Panel: Story = {
  render: () => (
    <div style={{ padding: "24px 24px 360px 360px" }}>
      <PopoverPanel
        trigger={<IconButton icon={icons.pin} label="Закреплённые" />}
        title="Закреплённые"
        icon={icons.pin}
        actions={<IconButton icon={icons.help} label="Как закрепить сообщение" size="s" />}
        defaultOpen
      >
        <Stack gap={12}>
          {pinned.map(([author, text]) => (
            <div key={author}>
              <strong>{author}</strong>
              <div style={{ color: "var(--color-muted)" }}>{text}</div>
            </div>
          ))}
          <Button variant="link">Показать все</Button>
        </Stack>
      </PopoverPanel>
    </div>
  ),
};
