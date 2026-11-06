// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Avatar } from "../Avatar/Avatar";
import { CountBadge } from "../Badge/Badge";
import { IconButton } from "../Button/Button";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { Forced, Stack, State, States, Surface } from "../stories/States";
import { Divider, ListRow, RowList, SectionHeader } from "./List";

const meta: Meta = { title: "List" };
export default meta;
type Story = StoryObj;

const channels = [
  { id: "general", name: "берлога", unread: 0 },
  { id: "games", name: "настолки", unread: 3 },
  { id: "music", name: "музыка", unread: 0 },
];

const dms = [
  { id: "misha", name: "Миша", last: "Чайник поставил", avatar: "bear" },
  { id: "lisa", name: "Лиса", last: "До завтра!", avatar: "fox" },
];

function ChannelList({ width = 240 }: { width?: number }) {
  const [selected, setSelected] = useState("general");
  return (
    <div style={{ width }}>
      <SectionHeader variant="collapsible">Текстовые каналы</SectionHeader>
      <RowList
        aria-label="Каналы"
        items={channels}
        selectionMode="single"
        selectedKeys={[selected]}
        onSelectionChange={(keys) => {
          const [next] = keys;
          if (typeof next === "string") setSelected(next);
        }}
      >
        {(channel) => (
          <ListRow
            id={channel.id}
            leading={<Icon icon={icons.textChannel} size={16} />}
            trailing={
              channel.unread > 0 && (
                <CountBadge count={channel.unread} aria-label={`Упоминаний: ${channel.unread}`} />
              )
            }
            actions={
              <>
                <IconButton icon={icons.add} label="Пригласить" size="s" />
                <IconButton icon={icons.settings} label="Настроить канал" size="s" />
              </>
            }
          >
            {channel.name}
          </ListRow>
        )}
      </RowList>
    </div>
  );
}

/** `ListRow` в списке каналов: стрелки ходят по строкам, ← → — по кнопкам действий внутри. */
export const ListRowStory: Story = {
  name: "ListRow",
  render: () => (
    <Stack gap={32}>
      <Surface>
        <ChannelList />
      </Surface>
      <States>
        <State label="Наведение: видны кнопки действий">
          <Surface>
            <Forced state="hovered" selector="[role=row]">
              <ChannelList width={240} />
            </Forced>
          </Surface>
        </State>
        <State label="Фокус">
          <Surface>
            <Forced state={["focused", "focus-visible"]} selector="[role=row]">
              <ChannelList width={240} />
            </Forced>
          </Surface>
        </State>
      </States>
      <Surface>
        <div style={{ width: 260 }}>
          <SectionHeader variant="action" actionLabel="Новое сообщение">
            Личные сообщения
          </SectionHeader>
          <RowList aria-label="Личные сообщения" items={dms} selectionMode="single">
            {(dm) => (
              <ListRow
                id={dm.id}
                height={42}
                leading={<Avatar name={dm.name} avatarId={dm.avatar} size={32} status="online" />}
                description={dm.last}
                actions={<IconButton icon={icons.close} label="Закрыть" size="s" />}
              >
                {dm.name}
              </ListRow>
            )}
          </RowList>
        </div>
      </Surface>
    </Stack>
  ),
};

/** `SectionHeader`: заглавными со стрелкой (каналы) и обычным регистром с «+» (личные сообщения). */
export const SectionHeaderStory: Story = {
  name: "SectionHeader",
  render: () => (
    <Surface width={260}>
      <Stack gap={8}>
        <div style={{ width: "100%" }}>
          <SectionHeader variant="collapsible">Текстовые каналы</SectionHeader>
        </div>
        <div style={{ width: "100%" }}>
          <SectionHeader variant="collapsible" isExpanded={false}>
            Голосовые каналы
          </SectionHeader>
        </div>
        <div style={{ width: "100%" }}>
          <SectionHeader variant="action" actionLabel="Новое сообщение">
            Личные сообщения
          </SectionHeader>
        </div>
        <div style={{ width: "100%" }}>
          <SectionHeader>В сети — 3</SectionHeader>
        </div>
      </Stack>
    </Surface>
  ),
};

/** `Divider`, `Divider/Date`, `Divider/New`. */
export const DividerStory: Story = {
  name: "Divider",
  render: () => (
    <div style={{ width: 420 }}>
      <Stack gap={16}>
        <div style={{ width: "100%" }}>
          <Divider />
        </div>
        <div style={{ width: "100%" }}>
          <Divider variant="date">12 ноября</Divider>
        </div>
        <div style={{ width: "100%" }}>
          <Divider variant="new" />
        </div>
      </Stack>
    </div>
  ),
};
