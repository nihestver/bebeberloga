// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button, IconToggleButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { State, States } from "../stories/States";
import { Tooltip, useSuccessTooltip } from "./Tooltip";

const meta: Meta = { title: "Tooltip" };
export default meta;
type Story = StoryObj;

const pad = { padding: 48 } as const;

export const Default: Story = {
  render: () => (
    <States>
      <State label="Наведи или перейди клавишей Tab">
        <div style={pad}>
          <Tooltip content="Настройки пользователя">
            <Button variant="secondary">Настройки</Button>
          </Tooltip>
        </div>
      </State>
      <State label="Открыта, сверху">
        <div style={pad}>
          <Tooltip content="Настройки пользователя" isOpen>
            <Button variant="secondary">Настройки</Button>
          </Tooltip>
        </div>
      </State>
      <State label="Открыта, справа">
        <div style={pad}>
          <Tooltip content="Берлога" placement="right" isOpen>
            <Button variant="secondary">Сервер</Button>
          </Tooltip>
        </div>
      </State>
      <State label="Открыта, снизу">
        <div style={pad}>
          <Tooltip content="Входящие" placement="bottom" isOpen>
            <Button variant="secondary">Входящие</Button>
          </Tooltip>
        </div>
      </State>
    </States>
  ),
};

function MicToggle() {
  const [isMuted, setMuted] = useState(false);
  const done = useSuccessTooltip();
  return (
    <Tooltip
      variant="success"
      content={isMuted ? "Микрофон выключен" : "Микрофон включён"}
      isOpen={done.isOpen}
    >
      <IconToggleButton
        icon={icons.mic}
        selectedIcon={icons.micOff}
        label={isMuted ? "Включить микрофон" : "Выключить микрофон"}
        tone="danger"
        isSelected={isMuted}
        onChange={(next) => {
          setMuted(next);
          done.show();
        }}
      />
    </Tooltip>
  );
}

/** `Tooltip/Success`: короткое подтверждение на 1.5 с, заливка Шалфеем. */
export const Success: Story = {
  render: () => (
    <States>
      <State label="Открыта">
        <div style={pad}>
          <Tooltip variant="success" content="Микрофон выключен" isOpen>
            <Button variant="secondary">Микрофон</Button>
          </Tooltip>
        </div>
      </State>
      <State label="Живой пример: нажми кнопку">
        <div style={pad}>
          <MicToggle />
        </div>
      </State>
    </States>
  ),
};
