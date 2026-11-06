// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, State, States, Surface } from "../stories/States";
import {
  PasswordStrength,
  ProgressBar,
  Skeleton,
  SkeletonText,
  type PasswordScore,
} from "./Progress";

const meta: Meta = { title: "Progress" };
export default meta;
type Story = StoryObj;

const box = (children: React.ReactNode) => <div style={{ width: 240 }}>{children}</div>;

/** `ProgressBar`: полоса 4 px с подписью «N %»; неопределённый вариант — бегущий отрезок. */
export const ProgressBarStory: Story = {
  name: "ProgressBar",
  render: () => (
    <States>
      <State label="Загрузка файла, 35 %">{box(<ProgressBar label="Загрузка" value={35} />)}</State>
      <State label="Готово">{box(<ProgressBar label="Загрузка" value={100} />)}</State>
      <State label="Неопределённый">{box(<ProgressBar aria-label="Подключение" />)}</State>
    </States>
  ),
};

/** `PasswordStrength`: 4 сегмента под полем пароля. */
export const PasswordStrengthStory: Story = {
  name: "PasswordStrength",
  render: () => (
    <States>
      {([0, 1, 2, 3, 4] as PasswordScore[]).map((score) => (
        <State key={score} label={`Оценка ${score}`}>
          {box(<PasswordStrength score={score} />)}
        </State>
      ))}
    </States>
  ),
};

/** `Skeleton`: заглушки на время загрузки списка и ленты. */
export const SkeletonStory: Story = {
  name: "Skeleton",
  render: () => (
    <Surface width={360}>
      <Stack gap={16}>
        {[0, 1, 2].map((row) => (
          <div key={row} style={{ display: "flex", gap: 12, width: "100%" }}>
            <Skeleton width={40} height={40} isRound />
            <div style={{ flex: 1 }}>
              <SkeletonText lines={2} />
            </div>
          </div>
        ))}
      </Stack>
    </Surface>
  ),
};
