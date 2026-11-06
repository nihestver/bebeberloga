// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { icons } from "../icons/icons";
import { InteractionStates, Stack, State, States } from "../stories/States";
import { LevelMeter, Slider } from "../Slider/Slider";
import { MenuItem, MenuSection, MenuSeparator } from "../Menu/Menu";
import { Button, HangupButton, IconButton, IconToggleButton, type ButtonVariant } from "./Button";
import { SplitButton } from "./SplitButton";

const meta: Meta = { title: "Button" };
export default meta;
type Story = StoryObj;

function variantStory(variant: ButtonVariant, label: string): Story {
  return {
    render: () => (
      <Stack gap={24}>
        <InteractionStates
          pending
          render={(extra) => (
            <Button variant={variant} {...extra}>
              {label}
            </Button>
          )}
        />
        {variant !== "link" && variant !== "pill" && (
          <InteractionStates
            pending
            render={(extra) => (
              <Button variant={variant} size="s" {...extra}>
                {label}
              </Button>
            )}
          />
        )}
      </Stack>
    ),
  };
}

export const Primary = variantStory("primary", "Сохранить");
export const Secondary = variantStory("secondary", "Отмена");
export const Danger = variantStory("danger", "Удалить");
export const DangerOutline = variantStory("dangerOutline", "Приостановить приглашения");
export const Link = variantStory("link", "Подробнее");

export const Pill: Story = {
  render: () => (
    <InteractionStates
      pending
      render={(extra) => (
        <Button variant="pill" icon={icons.streamStart} {...extra}>
          Смотреть стрим
        </Button>
      )}
    />
  ),
};

export const Icon: Story = {
  render: () => (
    <Stack gap={24}>
      <InteractionStates
        render={(extra) => <IconButton icon={icons.settings} label="Настройки" {...extra} />}
      />
      <InteractionStates
        render={(extra) => <IconButton icon={icons.pin} label="Закреплённые" size="s" {...extra} />}
      />
    </Stack>
  ),
};

function ToggleDemo({ tone }: { tone: "danger" | "positive" }) {
  const [isSelected, setSelected] = useState(false);
  const danger = tone === "danger";
  const label = danger
    ? isSelected
      ? "Включить микрофон"
      : "Выключить микрофон"
    : isSelected
      ? "Остановить стрим"
      : "Начать стрим";
  return (
    <IconToggleButton
      icon={danger ? icons.mic : icons.streamStart}
      selectedIcon={danger ? icons.micOff : icons.streamStop}
      label={label}
      tone={tone}
      isSelected={isSelected}
      onChange={setSelected}
    />
  );
}

export const IconToggle: Story = {
  render: () => (
    <Stack gap={24}>
      <InteractionStates
        render={(extra) => (
          <IconToggleButton icon={icons.mic} label="Выключить микрофон" tone="danger" {...extra} />
        )}
      />
      <States>
        <State label="Включено, «опасное»">
          <IconToggleButton
            icon={icons.mic}
            selectedIcon={icons.micOff}
            label="Включить микрофон"
            tone="danger"
            isSelected
          />
        </State>
        <State label="Включено, «позитивное»">
          <IconToggleButton
            icon={icons.streamStart}
            label="Остановить стрим"
            tone="positive"
            isSelected
          />
        </State>
        <State label="Живой пример: микрофон">
          <ToggleDemo tone="danger" />
        </State>
        <State label="Живой пример: стрим">
          <ToggleDemo tone="positive" />
        </State>
      </States>
    </Stack>
  ),
};

export const Hangup: Story = {
  render: () => <InteractionStates render={(extra) => <HangupButton {...extra} />} />,
};

function SplitDemo({ isDisabled }: { isDisabled?: boolean }) {
  const [isMuted, setMuted] = useState(false);
  return (
    <SplitButton
      icon={icons.mic}
      selectedIcon={icons.micOff}
      label={isMuted ? "Включить микрофон" : "Выключить микрофон"}
      tone="danger"
      isSelected={isMuted}
      onChange={setMuted}
      isDisabled={isDisabled}
      menuLabel="Устройство ввода"
      menuHeader={
        <Stack gap={12}>
          <Slider label="Громкость микрофона" defaultValue={80} />
          <LevelMeter level={0.4} bars={32} />
        </Stack>
      }
      menu={
        <>
          <MenuSection title="Микрофон" selectionMode="single" defaultSelectedKeys={["built-in"]}>
            <MenuItem id="built-in">Встроенный микрофон</MenuItem>
            <MenuItem id="headset">Гарнитура</MenuItem>
          </MenuSection>
          <MenuSeparator />
          <MenuItem icon={icons.settings}>Настройки голоса</MenuItem>
        </>
      }
    />
  );
}

/** Микрофон ˅, камера ˅, стрим ˅ в панели управления звонком: стрелка открывает `Menu/Popover`. */
export const Split: Story = {
  render: () => (
    <div style={{ paddingTop: 220 }}>
      <States>
        <State label="Живой пример">
          <SplitDemo />
        </State>
        <State label="Включено, «позитивное»">
          <SplitButton
            icon={icons.streamStart}
            label="Остановить стрим"
            tone="positive"
            isSelected
            menu={<MenuItem>Сменить источник</MenuItem>}
          />
        </State>
        <State label="Неактивное">
          <SplitDemo isDisabled />
        </State>
      </States>
    </div>
  ),
};
