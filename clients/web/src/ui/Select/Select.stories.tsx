// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Forced, Stack, State, States } from "../stories/States";
import { Select, type SelectOption } from "./Select";

const meta: Meta = { title: "Select" };
export default meta;
type Story = StoryObj;

const spoilers: SelectOption[] = [
  { id: "click", label: "По клику" },
  { id: "hover", label: "При наведении" },
  { id: "always", label: "Всегда" },
];

const devices: SelectOption[] = Array.from({ length: 14 }, (_, index) => ({
  id: `device-${index + 1}`,
  label: `Микрофон ${index + 1}`,
  description: index === 0 ? "По умолчанию в системе" : undefined,
  isDisabled: index === 5,
}));

const TRIGGER = "[data-control]";
const width = (children: React.ReactNode) => <div style={{ width: 240 }}>{children}</div>;

export const Default: Story = {
  render: () => (
    <Stack gap={32}>
      <States>
        <State label="Обычное">
          {width(<Select label="Спойлеры" options={spoilers} defaultValue="click" />)}
        </State>
        <State label="Наведение">
          <Forced state="hovered" selector={TRIGGER}>
            {width(<Select label="Спойлеры" options={spoilers} defaultValue="click" />)}
          </Forced>
        </State>
        <State label="Фокус">
          <Forced state={["focused", "focus-visible"]} selector={TRIGGER}>
            {width(<Select label="Спойлеры" options={spoilers} defaultValue="click" />)}
          </Forced>
        </State>
        <State label="Неактивное">
          {width(<Select label="Спойлеры" options={spoilers} defaultValue="click" isDisabled />)}
        </State>
        <State label="Ошибка">
          {width(
            <Select
              label="Действие"
              isRequired
              options={spoilers}
              errorMessage="Выбери действие"
            />,
          )}
        </State>
      </States>
      <States>
        <State label="Не выбрано">{width(<Select label="Спойлеры" options={spoilers} />)}</State>
        <State label="Размер S, с пояснением">
          {width(
            <Select
              aria-label="Спойлеры"
              size="s"
              options={spoilers}
              defaultValue="hover"
              description="Как раскрывать скрытый текст"
            />,
          )}
        </State>
      </States>
    </Stack>
  ),
};

/** Больше 10 вариантов: в списке появляется поиск, видно 8 строк, дальше прокрутка. */
export const WithSearch: Story = {
  render: () => width(<Select label="Микрофон" options={devices} defaultValue="device-1" />),
};
