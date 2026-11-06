// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack, State, States } from "../stories/States";
import { CodeInput } from "./CodeInput";

const meta: Meta = { title: "CodeInput" };
export default meta;
type Story = StoryObj;

function Demo() {
  const [code, setCode] = useState("");
  const [done, setDone] = useState<string>();
  return (
    <Stack gap={8}>
      <CodeInput label="Код из письма" value={code} onChange={setCode} onComplete={setDone} />
      <span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-caption)" }}>
        {done ? `Введено: ${done}` : "Введи цифры, вставь код или нажми Backspace."}
      </span>
    </Stack>
  );
}

export const Default: Story = {
  render: () => (
    <States>
      <State label="6 ячеек (живой пример)">
        <Demo />
      </State>
      <State label="4 ячейки">
        <CodeInput label="Код" length={4} defaultValue="42" />
      </State>
      <State label="Ошибка">
        <CodeInput label="Код из письма" defaultValue="123456" errorMessage="Код не подошёл" />
      </State>
      <State label="Неактивное">
        <CodeInput label="Код из письма" defaultValue="123" isDisabled />
      </State>
    </States>
  ),
};
