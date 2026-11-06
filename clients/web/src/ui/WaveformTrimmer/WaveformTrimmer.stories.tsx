// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { State, States } from "../stories/States";
import { WaveformTrimmer } from "./WaveformTrimmer";

const meta: Meta = { title: "WaveformTrimmer" };
export default meta;
type Story = StoryObj;

/** Пики для примера: затухающая волна с всплесками. */
const peaks = Array.from({ length: 120 }, (_, index) => {
  const t = index / 120;
  const envelope = Math.exp(-t * 1.6);
  return Math.min(
    1,
    0.15 + envelope * Math.abs(Math.sin(index * 0.7) * 0.9 + Math.sin(index * 0.23) * 0.4),
  );
});

function Demo({ isDisabled }: { isDisabled?: boolean }) {
  const [range, setRange] = useState<[number, number]>([0.8, 4]);
  const [isPlaying, setPlaying] = useState(false);
  return (
    <WaveformTrimmer
      peaks={peaks}
      duration={12.4}
      limit={300}
      value={range}
      onChange={setRange}
      isPlaying={isPlaying}
      onPlayToggle={() => setPlaying((current) => !current)}
      isDisabled={isDisabled}
    />
  );
}

export const Default: Story = {
  render: () => (
    <States>
      <State label="Живой пример">
        <Demo />
      </State>
      <State label="Неактивное">
        <Demo isDisabled />
      </State>
    </States>
  ),
};
