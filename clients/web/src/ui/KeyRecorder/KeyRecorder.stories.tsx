// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { KeyCombo } from "../shortcuts/keys";
import { State, States } from "../stories/States";
import { KeyRecorder } from "./KeyRecorder";

const meta: Meta = { title: "KeyRecorder" };
export default meta;
type Story = StoryObj;

function Demo({ initial = null }: { initial?: KeyCombo | null }) {
  const [combo, setCombo] = useState<KeyCombo | null>(initial);
  return <KeyRecorder label="Сочетание" value={combo} onChange={setCombo} platform="other" />;
}

const noop = () => undefined;
const combo: KeyCombo = { ctrl: true, shift: true, code: "KeyM" };

export const Default: Story = {
  render: () => (
    <States>
      <State label="Не назначено (живой пример)">
        <Demo />
      </State>
      <State label="Назначено (живой пример)">
        <Demo initial={combo} />
      </State>
      <State label="Одна клавиша">
        <KeyRecorder label="Сочетание" value={{ code: "Space" }} onChange={noop} />
      </State>
      <State label="Неактивное">
        <KeyRecorder label="Сочетание" value={combo} onChange={noop} isDisabled platform="other" />
      </State>
    </States>
  ),
};
