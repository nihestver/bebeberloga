// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommunityIcon } from "../Avatar/Avatar";
import { State, States } from "../stories/States";
import { CountBadge, LiveBadge, PillBadge } from "./Badge";

const meta: Meta = { title: "Badge" };
export default meta;
type Story = StoryObj;

export const Count: Story = {
  render: () => (
    <States>
      {[1, 12, 999, 1000, 5400, 9999, 10000].map((count) => (
        <State key={count} label={String(count)}>
          <CountBadge count={count} aria-label={`Упоминаний: ${count}`} />
        </State>
      ))}
      <State label="На иконке, с вырезом">
        <span style={{ position: "relative", display: "inline-flex" }}>
          <CommunityIcon name="Тихая берлога" size={40} />
          <span style={{ position: "absolute", right: -6, bottom: -6 }}>
            <CountBadge count={3} hasCutout aria-label="Упоминаний: 3" />
          </span>
        </span>
      </State>
    </States>
  ),
};

export const Pill: Story = {
  render: () => (
    <States>
      <State label="Нейтральный">
        <PillBadge>Бот</PillBadge>
      </State>
      <State label="Брусникой">
        <PillBadge tone="danger">Новое</PillBadge>
      </State>
      <State label="Со счётом">
        <PillBadge tone="danger">3 новых</PillBadge>
      </State>
      <State label="Шалфеем">
        <PillBadge tone="accent">Владелец</PillBadge>
      </State>
    </States>
  ),
};

export const Live: Story = {
  render: () => (
    <States>
      <State label="По умолчанию">
        <LiveBadge />
      </State>
    </States>
  ),
};
