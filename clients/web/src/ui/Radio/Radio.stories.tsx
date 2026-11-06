// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { icons } from "../icons/icons";
import { Forced, Stack, State, States } from "../stories/States";
import { Radio, RadioCard, RadioGroup } from "./Radio";

const meta: Meta = { title: "Radio" };
export default meta;
type Story = StoryObj;

const ITEM = "label";

/** `Radio`: состояния одного варианта. */
export const RadioStory: Story = {
  name: "Radio",
  render: () => (
    <Stack gap={32}>
      <States>
        <State label="Обычное">
          <RadioGroup aria-label="Пример">
            <Radio value="a">Чистый голос</Radio>
          </RadioGroup>
        </State>
        <State label="Наведение">
          <Forced state="hovered" selector={ITEM}>
            <RadioGroup aria-label="Пример">
              <Radio value="a">Чистый голос</Radio>
            </RadioGroup>
          </Forced>
        </State>
        <State label="Нажатие">
          <Forced state={["hovered", "pressed"]} selector={ITEM}>
            <RadioGroup aria-label="Пример">
              <Radio value="a">Чистый голос</Radio>
            </RadioGroup>
          </Forced>
        </State>
        <State label="Фокус">
          <Forced state={["focused", "focus-visible"]} selector={ITEM}>
            <RadioGroup aria-label="Пример">
              <Radio value="a">Чистый голос</Radio>
            </RadioGroup>
          </Forced>
        </State>
        <State label="Выбран">
          <RadioGroup aria-label="Пример" defaultValue="a">
            <Radio value="a">Чистый голос</Radio>
          </RadioGroup>
        </State>
        <State label="Неактивное">
          <RadioGroup aria-label="Пример" isDisabled defaultValue="a">
            <Radio value="a">Чистый голос</Radio>
          </RadioGroup>
        </State>
      </States>
    </Stack>
  ),
};

/** `RadioGroup`: вертикальный список с заголовком и пояснением у каждого варианта. */
export const RadioGroupStory: Story = {
  name: "RadioGroup",
  render: () => (
    <States>
      <State label="Обычное">
        <RadioGroup label="Профиль ввода" defaultValue="clean">
          <Radio value="clean" description="Шумоподавление, эхоподавление и автоусиление">
            Чистый голос
          </Radio>
          <Radio value="raw" description="Без обработки — для музыки и инструментов">
            Как есть
          </Radio>
          <Radio value="custom" description="Настройки ниже">
            Пользовательский
          </Radio>
        </RadioGroup>
      </State>
      <State label="Ошибка">
        <RadioGroup label="Для кого сервер" errorMessage="Выбери один из вариантов" isRequired>
          <Radio value="friends">Для друзей</Radio>
          <Radio value="community">Для сообщества</Radio>
        </RadioGroup>
      </State>
      <State label="Неактивное">
        <RadioGroup label="Плотность сообщений" defaultValue="cozy" isDisabled>
          <Radio value="cozy">Обычная</Radio>
          <Radio value="compact">Компактная</Radio>
        </RadioGroup>
      </State>
    </States>
  ),
};

/** `RadioCard`: тип канала, «для кого сообщество». */
export const RadioCardStory: Story = {
  name: "RadioCard",
  render: () => (
    <Stack gap={32}>
      <div style={{ width: 420 }}>
        <RadioGroup label="Тип канала" defaultValue="text">
          <RadioCard value="text" icon={icons.textChannel} description="Сообщения, файлы, ветки">
            Текстовый
          </RadioCard>
          <RadioCard value="voice" icon={icons.voiceChannel} description="Голос, видео и стримы">
            Голосовой
          </RadioCard>
          <RadioCard value="news" icon={icons.announcements} description="Скоро" isDisabled>
            Объявления
          </RadioCard>
        </RadioGroup>
      </div>
      <States>
        <State label="Наведение">
          <Forced state="hovered" selector={ITEM}>
            <RadioGroup aria-label="Пример">
              <RadioCard value="a" icon={icons.textChannel}>
                Текстовый
              </RadioCard>
            </RadioGroup>
          </Forced>
        </State>
        <State label="Фокус">
          <Forced state={["focused", "focus-visible"]} selector={ITEM}>
            <RadioGroup aria-label="Пример">
              <RadioCard value="a" icon={icons.textChannel}>
                Текстовый
              </RadioCard>
            </RadioGroup>
          </Forced>
        </State>
        <State label="В ряд">
          <div style={{ width: 420 }}>
            <RadioGroup aria-label="Для кого сервер" orientation="horizontal" defaultValue="me">
              <RadioCard value="me">Для своих</RadioCard>
              <RadioCard value="all">Для сообщества</RadioCard>
            </RadioGroup>
          </div>
        </State>
      </States>
    </Stack>
  ),
};
