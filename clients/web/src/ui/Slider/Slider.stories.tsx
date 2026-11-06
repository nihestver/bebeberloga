// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Forced, Stack, State, States } from "../stories/States";
import { LevelMeter, Slider, ThresholdSlider } from "./Slider";

const meta: Meta = { title: "Slider" };
export default meta;
type Story = StoryObj;

const THUMB = "[data-rac] [data-rac] [data-rac], [class*=thumb]";
const percent = (value: number) => `${value} %`;
const box = (children: React.ReactNode) => <div style={{ width: 220 }}>{children}</div>;

export const Default: Story = {
  render: () => (
    <Stack gap={40}>
      <States>
        <State label="Обычное">
          {box(<Slider label="Громкость" defaultValue={60} formatValue={percent} />)}
        </State>
        <State label="Наведение">
          <Forced state="hovered" selector={THUMB}>
            {box(<Slider label="Громкость" defaultValue={60} formatValue={percent} />)}
          </Forced>
        </State>
        <State label="Перетаскивание: значение подсказкой">
          <Forced state="dragging" selector={THUMB}>
            {box(<Slider label="Громкость" defaultValue={60} formatValue={percent} />)}
          </Forced>
        </State>
        <State label="Неактивное">
          {box(<Slider label="Громкость" defaultValue={60} isDisabled />)}
        </State>
      </States>
      <States>
        <State label="Значение рядом с подписью, 0–200 %">
          {box(
            <Slider
              label="Громкость пользователя"
              defaultValue={120}
              maxValue={200}
              showValue
              formatValue={percent}
            />,
          )}
        </State>
        <State label="Шаг 250 мс">
          {box(
            <Slider
              label="Задержка отпускания"
              defaultValue={500}
              maxValue={2000}
              step={250}
              showValue
              formatValue={(value) => `${value} мс`}
            />,
          )}
        </State>
      </States>
    </Stack>
  ),
};

/** Имитация уровня микрофона для историй: плавная волна. */
function useFakeLevel(): number {
  const [level, setLevel] = useState(0.35);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - started) / 1000;
      setLevel(0.45 + 0.4 * Math.sin(t * 2.1) * Math.sin(t * 0.7));
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return level;
}

function LiveThreshold() {
  const level = useFakeLevel();
  const [value, setValue] = useState(40);
  return (
    <ThresholdSlider
      label="Порог активации голоса"
      level={level}
      value={value}
      onChange={setValue}
      formatValue={percent}
    />
  );
}

export const Threshold: Story = {
  render: () => (
    <States>
      <State label="Голос ниже порога">
        {box(<ThresholdSlider label="Порог активации голоса" level={0.2} defaultValue={50} />)}
      </State>
      <State label="Голос выше порога">
        {box(<ThresholdSlider label="Порог активации голоса" level={0.75} defaultValue={50} />)}
      </State>
      <State label="Неактивное">
        {box(
          <ThresholdSlider
            label="Порог активации голоса"
            level={0.3}
            defaultValue={50}
            isDisabled
          />,
        )}
      </State>
      <State label="Живой пример">{box(<LiveThreshold />)}</State>
    </States>
  ),
};

function LiveMeter() {
  return <LevelMeter level={useFakeLevel()} />;
}

/** `LevelMeter` — отдельный компонент каталога; показан здесь рядом со слайдером порога. */
export const LevelMeterStory: Story = {
  name: "LevelMeter",
  render: () => (
    <States>
      <State label="Тишина">
        <LevelMeter level={0} />
      </State>
      <State label="Средний уровень">
        <LevelMeter level={0.5} />
      </State>
      <State label="Громко">
        <LevelMeter level={1} />
      </State>
      <State label="Живой пример">
        <LiveMeter />
      </State>
    </States>
  ),
};
