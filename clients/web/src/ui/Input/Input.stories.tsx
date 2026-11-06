// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { icons } from "../icons/icons";
import { Forced, Stack, State, States } from "../stories/States";
import {
  ActionInput,
  ChannelNameInput,
  RichTextInput,
  SearchInput,
  Textarea,
  TextInput,
} from "./Input";

const meta: Meta = { title: "Input" };
export default meta;
type Story = StoryObj;

const CONTROL = "[data-control]";

/** Ряд состояний поля: обычное, наведение, фокус, неактивное, ошибка. */
function FieldStates({
  render,
}: {
  render: (extra: { isDisabled?: boolean; errorMessage?: string }) => ReactNode;
}) {
  return (
    <States>
      <State label="Обычное">{render({})}</State>
      <State label="Наведение">
        <Forced state="hovered" selector={CONTROL}>
          {render({})}
        </Forced>
      </State>
      <State label="Фокус">
        <Forced state="focus-within" selector={CONTROL}>
          {render({})}
        </Forced>
      </State>
      <State label="Неактивное">{render({ isDisabled: true })}</State>
      <State label="Ошибка">{render({ errorMessage: "Такое имя уже занято" })}</State>
    </States>
  );
}

export const Text: Story = {
  render: () => (
    <Stack gap={32}>
      <FieldStates
        render={(extra) => (
          <TextInput
            label="Имя пользователя"
            isRequired
            placeholder="misha"
            description="Латиница, цифры, точка и подчёркивание"
            {...extra}
          />
        )}
      />
      <States>
        <State label="Размер S, без подписи">
          <TextInput aria-label="Ссылка-приглашение" size="s" defaultValue="berloga.example/in" />
        </State>
        <State label="С заполненным значением">
          <TextInput label="Отображаемое имя" defaultValue="Миша" />
        </State>
      </States>
    </Stack>
  ),
};

export const WithAction: Story = {
  render: () => (
    <States>
      <State label="Пустое: кнопка неактивна">
        <ActionInput
          label="Добавить друга"
          placeholder="Имя пользователя"
          actionLabel="Отправить запрос"
          onAction={() => undefined}
        />
      </State>
      <State label="Заполнено">
        <ActionInput
          label="Добавить друга"
          defaultValue="lisa"
          actionLabel="Отправить запрос"
          onAction={() => undefined}
        />
      </State>
      <State label="Загрузка">
        <ActionInput
          label="Добавить друга"
          defaultValue="lisa"
          actionLabel="Отправить запрос"
          isActionPending
          onAction={() => undefined}
        />
      </State>
      <State label="Только чтение: «Копировать»">
        <ActionInput
          label="Ссылка-приглашение"
          isReadOnly
          defaultValue="berloga.example/in/k3p9"
          actionLabel="Копировать"
          onAction={() => undefined}
        />
      </State>
      <State label="Неактивное">
        <ActionInput
          label="Добавить друга"
          defaultValue="lisa"
          isDisabled
          actionLabel="Отправить запрос"
          onAction={() => undefined}
        />
      </State>
    </States>
  ),
};

export const Search: Story = {
  render: () => (
    <Stack gap={32}>
      <States>
        <State label="Пустое, 40 (в диалогах)">
          <SearchInput aria-label="Поиск" placeholder="Найди звук" />
        </State>
        <State label="С текстом: есть крестик">
          <SearchInput aria-label="Поиск" defaultValue="чайник" />
        </State>
        <State label="Фокус">
          <Forced state="focus-within" selector={CONTROL}>
            <SearchInput aria-label="Поиск" defaultValue="чайник" />
          </Forced>
        </State>
        <State label="Неактивное">
          <SearchInput aria-label="Поиск" placeholder="Найди звук" isDisabled />
        </State>
      </States>
      <States>
        <State label="Пустое, 32 (в шапках)">
          <SearchInput aria-label="Поиск" placeholder="Поиск" size="s" />
        </State>
        <State label="С текстом, 32">
          <SearchInput aria-label="Поиск" defaultValue="чайник" size="s" />
        </State>
      </States>
    </Stack>
  ),
};

const ABOUT = "Люблю чай, настолки и долгие разговоры в голосовом канале. ".repeat(3).trim();

export const TextareaStory: Story = {
  name: "Textarea",
  render: () => (
    <Stack gap={32}>
      <FieldStates
        render={(extra) => (
          <div style={{ width: 280 }}>
            <Textarea label="О себе" placeholder="Пара слов о себе" maxLength={190} {...extra} />
          </div>
        )}
      />
      <States>
        <State label="Счётчик: осталось меньше 20 %">
          <div style={{ width: 280 }}>
            <Textarea label="О себе" maxLength={190} defaultValue={ABOUT} />
          </div>
        </State>
        <State label="Счётчик всегда (тема канала)">
          <div style={{ width: 280 }}>
            <Textarea label="Тема канала" maxLength={1024} counter="always" />
          </div>
        </State>
      </States>
    </Stack>
  ),
};

export const RichText: Story = {
  render: () => (
    <FieldStates
      render={(extra) => (
        <div style={{ width: 320 }}>
          <RichTextInput
            label="Тема канала"
            placeholder="Расскажи участникам, о чём этот канал"
            maxLength={1024}
            counter="always"
            {...extra}
          />
        </div>
      )}
    />
  ),
};

function ChannelNameDemo() {
  const [name, setName] = useState("");
  return (
    <ChannelNameInput
      label="Название канала"
      placeholder="новый-канал"
      description={`Отправится на сервер: «${name}»`}
      value={name}
      onChange={setName}
    />
  );
}

export const ChannelName: Story = {
  render: () => (
    <Stack gap={32}>
      <FieldStates
        render={(extra) => (
          <ChannelNameInput label="Название канала" placeholder="новый-канал" {...extra} />
        )}
      />
      <States>
        <State label="Голосовой канал">
          <ChannelNameInput
            label="Название канала"
            icon={icons.voiceChannel}
            defaultValue="посиделки"
          />
        </State>
        <State label="Живой пример: введи «Новый Канал!»">
          <ChannelNameDemo />
        </State>
      </States>
    </Stack>
  ),
};
