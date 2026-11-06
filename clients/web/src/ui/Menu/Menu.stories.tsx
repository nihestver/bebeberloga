// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button, IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { LevelMeter, Slider } from "../Slider/Slider";
import { Stack, Surface } from "../stories/States";
import {
  ContextMenu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  PopoverMenu,
  QuickReactions,
  Submenu,
} from "./Menu";

const meta: Meta = { title: "Menu" };
export default meta;
type Story = StoryObj;

const hint = { color: "var(--color-muted)", fontSize: "var(--font-size-caption)" } as const;

const channelItems = (
  <>
    <MenuItem icon={icons.check}>Отметить прочитанным</MenuItem>
    <MenuItem icon={icons.notifications} description="Только упоминания">
      Уведомления
    </MenuItem>
    <Submenu label="Пригласить" icon={icons.add}>
      <MenuItem>Скопировать ссылку</MenuItem>
      <MenuItem>Настроить приглашение</MenuItem>
      <Submenu label="Отправить другу">
        <MenuItem>Миша</MenuItem>
        <MenuItem>Лиса</MenuItem>
      </Submenu>
    </Submenu>
    <MenuItem icon={icons.settings} shortcut="nav.settings">
      Настроить канал
    </MenuItem>
    <MenuItem icon={icons.pin} isDisabled>
      Закрепить в списке
    </MenuItem>
    <MenuSeparator />
    <MenuItem icon={icons.delete} isDanger>
      Удалить канал
    </MenuItem>
  </>
);

/** Правый клик по карточке (или клавиша контекстного меню при фокусе на кнопке внутри). */
export const Context: Story = {
  render: () => (
    <ContextMenu aria-label="Действия с каналом" menu={channelItems}>
      <Surface width={320}>
        <Stack gap={8}>
          <strong># берлога</strong>
          <span style={hint}>Правый клик здесь открывает меню канала.</span>
          <Button variant="secondary" size="s">
            Кнопка внутри области
          </Button>
        </Stack>
      </Surface>
    </ContextMenu>
  ),
};

/** Вариант для сообщения: первой строкой — четыре кнопки 44×44 с последними эмодзи. */
export const ContextQuickReactions: Story = {
  render: () => (
    <ContextMenu
      aria-label="Действия с сообщением"
      menu={
        <>
          <QuickReactions emojis={["👍", "❤️", "😂", "🐻"]} onReact={() => undefined} />
          <MenuItem icon={icons.reply} shortcut="msg.reply">
            Ответить
          </MenuItem>
          <MenuItem icon={icons.edit} shortcut="msg.edit">
            Изменить
          </MenuItem>
          <MenuItem icon={icons.pin} shortcut="msg.pin">
            Закрепить
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={icons.delete} isDanger shortcut="msg.delete">
            Удалить
          </MenuItem>
        </>
      }
    >
      <Surface width={360}>
        <Stack gap={4}>
          <strong>Миша</strong>
          <span>Чайник поставил. Кто идёт в голосовой?</span>
          <span style={hint}>Правый клик открывает меню сообщения.</span>
        </Stack>
      </Surface>
    </ContextMenu>
  ),
};

function DeviceMenu() {
  const [device, setDevice] = useState("built-in");
  return (
    <PopoverMenu
      aria-label="Устройство ввода"
      trigger={<IconButton icon={icons.chevronDown} label="Устройство ввода" />}
      header={
        <Stack gap={12}>
          <Slider label="Громкость микрофона" defaultValue={80} />
          <LevelMeter level={0.45} bars={32} />
        </Stack>
      }
    >
      <MenuSection
        title="Микрофон"
        selectionMode="single"
        selectedKeys={[device]}
        onSelectionChange={(keys) => {
          const [next] = keys;
          if (typeof next === "string") setDevice(next);
        }}
      >
        <MenuItem id="built-in">Встроенный микрофон</MenuItem>
        <MenuItem id="headset">Гарнитура</MenuItem>
        <MenuItem id="usb">Микрофон USB</MenuItem>
      </MenuSection>
      <MenuSeparator />
      <MenuItem icon={icons.settings}>Настройки голоса</MenuItem>
    </PopoverMenu>
  );
}

/** Меню под кнопкой: может содержать слайдер и `LevelMeter`; галочка у выбранного пункта. */
export const Popover: Story = {
  render: () => (
    <Stack gap={24}>
      <DeviceMenu />
      <PopoverMenu trigger={<Button variant="secondary">Меню сервера</Button>}>
        {channelItems}
      </PopoverMenu>
    </Stack>
  ),
};

const many = Array.from({ length: 40 }, (_, index) => `Участник ${index + 1}`);

/** Меню выше 70 % окна прокручивается. */
export const Scrolling: Story = {
  render: () => (
    <PopoverMenu trigger={<Button variant="secondary">Длинное меню</Button>}>
      {many.map((name) => (
        <MenuItem key={name}>{name}</MenuItem>
      ))}
    </PopoverMenu>
  ),
};
