// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommunityIcon } from "../Avatar/Avatar";
import { State, States } from "../stories/States";
import { E2EEBadge, UnreadPip } from "./Badge";

const meta: Meta = { title: "Indicators" };
export default meta;
type Story = StoryObj;

const rail = { display: "flex", alignItems: "center", gap: 8, height: 48 } as const;

/** `UnreadPip`: точка 8 → полоса 20 (наведение) → полоса 40 (выбрано). */
export const UnreadPipStory: Story = {
  name: "UnreadPip",
  render: () => (
    <States>
      {(["none", "unread", "hover", "selected"] as const).map((state) => (
        <State
          key={state}
          label={
            {
              none: "Прочитано",
              unread: "Есть непрочитанное",
              hover: "Наведение",
              selected: "Выбрано",
            }[state]
          }
        >
          <span style={rail}>
            <UnreadPip state={state} />
            <CommunityIcon name="Тихая берлога" size={40} isDecorative />
          </span>
        </State>
      ))}
    </States>
  ),
};

/** `E2EEBadge`: у каждого состояния свой значок, цвет и пояснение. */
export const E2EEBadgeStory: Story = {
  name: "E2EEBadge",
  render: () => (
    <States>
      <State label="Все проверены">
        <E2EEBadge state="verified" />
      </State>
      <State label="Участники не проверены">
        <E2EEBadge state="unverified" />
      </State>
      <State label="Ключи изменились или сбой расшифровки">
        <E2EEBadge state="warning" />
      </State>
    </States>
  ),
};
