// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, State, States, Surface } from "../stories/States";
import { Avatar, AVATAR_SIZES, COMMUNITY_ICON_SIZES, CommunityIcon } from "./Avatar";
import { builtinAvatarIds } from "./builtin";

const meta: Meta = { title: "Avatar" };
export default meta;
type Story = StoryObj;

/** Все размеры каталога: 16 … 120. */
export const Sizes: Story = {
  render: () => (
    <States>
      {AVATAR_SIZES.map((size) => (
        <State key={size} label={String(size)}>
          <Avatar name="Миша" avatarId="bear" size={size} />
        </State>
      ))}
    </States>
  ),
};

/** Встроенный набор (FEATURES 3.1): 30 значков из design/avatars; подпись — id аватара. */
export const BuiltIn: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 88px)", gap: 16 }}>
      {builtinAvatarIds.map((id) => (
        <figure key={id} style={{ margin: 0, display: "grid", gap: 6, justifyItems: "center" }}>
          <Avatar name={id} avatarId={id} size={80} />
          <figcaption style={{ color: "var(--color-muted)", fontSize: "var(--font-size-small)" }}>
            {id}
          </figcaption>
        </figure>
      ))}
    </div>
  ),
};

/** Десять тонов фона — первый ряд образцов палитры. */
export const Tones: Story = {
  render: () => (
    <States>
      {Array.from({ length: 10 }, (_, index) => (
        <State key={index} label={`тон ${index + 1}`}>
          <Avatar name="Лиса" avatarId="fox" size={48} tone={index + 1} />
        </State>
      ))}
    </States>
  ),
};

/** `Avatar/Status`: форма точки своя у каждого статуса. */
export const Status: Story = {
  render: () => (
    <Stack gap={24}>
      <States>
        <State label="В сети">
          <Avatar name="Миша" avatarId="bear" size={80} status="online" />
        </State>
        <State label="Отошёл">
          <Avatar name="Миша" avatarId="bear" size={80} status="away" />
        </State>
        <State label="Не беспокоить">
          <Avatar name="Миша" avatarId="bear" size={80} status="dnd" />
        </State>
        <State label="Не в сети">
          <Avatar name="Миша" avatarId="bear" size={80} status="offline" />
        </State>
      </States>
      <States>
        {([32, 40, 48] as const).map((size) => (
          <State key={size} label={`${size}, в сети`}>
            <Avatar name="Ёж" avatarId="hedgehog" size={size} status="online" />
          </State>
        ))}
        <State label="На панели: вырез цветом панели">
          <Surface>
            <span style={{ "--avatar-surface": "var(--color-panel)" } as React.CSSProperties}>
              <Avatar name="Сова" avatarId="owl" size={40} status="dnd" />
            </span>
          </Surface>
        </State>
      </States>
    </Stack>
  ),
};

/** `Avatar/Speaking`: кольцо Шалфеем, пока участник говорит. */
export const Speaking: Story = {
  render: () => (
    <States>
      <State label="Молчит">
        <Avatar name="Заяц" avatarId="hare" size={80} />
      </State>
      <State label="Говорит">
        <Avatar name="Заяц" avatarId="hare" size={80} isSpeaking />
      </State>
      <State label="Говорит, 24 (голосовой канал)">
        <Avatar name="Заяц" avatarId="hare" size={24} isSpeaking />
      </State>
    </States>
  ),
};

/** `Avatar/Typing`: вместо точки статуса — капсула с тремя точками. */
export const Typing: Story = {
  render: () => (
    <States>
      <State label="Печатает, 80">
        <Avatar name="Белка" avatarId="squirrel" size={80} status="online" isTyping />
      </State>
      <State label="Печатает, 40">
        <Avatar name="Белка" avatarId="squirrel" size={40} status="online" isTyping />
      </State>
    </States>
  ),
};

/** `CommunityIcon` — отдельный компонент каталога; показан рядом с аватарами. */
export const CommunityIconStory: Story = {
  name: "CommunityIcon",
  render: () => (
    <States>
      {COMMUNITY_ICON_SIZES.map((size) => (
        <State key={size} label={`${size}, инициалы`}>
          <CommunityIcon name="Тихая берлога" size={size} />
        </State>
      ))}
      <State label="Одно слово">
        <CommunityIcon name="Настолки" size={64} />
      </State>
    </States>
  ),
};
