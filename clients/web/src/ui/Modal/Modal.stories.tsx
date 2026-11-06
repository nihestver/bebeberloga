// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { SaveBar } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { Checkbox } from "../Checkbox/Checkbox";
import { icons } from "../icons/icons";
import { TextInput } from "../Input/Input";
import { RadioCard, RadioGroup } from "../Radio/Radio";
import { Stack } from "../stories/States";
import { Toggle } from "../Toggle/Toggle";
import { ConfirmModal, Modal, SettingsModal, type ModalProps } from "./Modal";

const meta: Meta = { title: "Modal", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

/** Кнопка, открывающая окно: истории показывают окно сразу, а после закрытия — как открыть снова. */
function Launcher({
  label,
  children,
}: {
  label: string;
  children: (state: { isOpen: boolean; close: () => void }) => ReactNode;
}) {
  const [isOpen, setOpen] = useState(true);
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        {label}
      </Button>
      {children({ isOpen, close: () => setOpen(false) })}
    </div>
  );
}

function Example(props: Omit<ModalProps, "isOpen" | "onClose" | "footer"> & { label: string }) {
  const { label, ...modal } = props;
  return (
    <Launcher label={label}>
      {({ isOpen, close }) => (
        <Modal
          {...modal}
          isOpen={isOpen}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onPress={close}>
                Отмена
              </Button>
              <Button onPress={close}>Создать</Button>
            </>
          }
        />
      )}
    </Launcher>
  );
}

export const S: Story = {
  render: () => (
    <Example label="Открыть Modal/S" size="s" title="Пригласить в берлогу">
      <Stack gap={16}>
        <TextInput label="Имя пользователя" isRequired placeholder="misha" />
        <Checkbox>Ссылка действует 7 дней</Checkbox>
      </Stack>
    </Example>
  ),
};

export const M: Story = {
  render: () => (
    <Example label="Открыть Modal/M" size="m" title="Создать канал">
      <Stack gap={16}>
        <div style={{ width: "100%" }}>
          <RadioGroup label="Тип канала" defaultValue="text">
            <RadioCard value="text" icon={icons.textChannel} description="Сообщения, файлы, ветки">
              Текстовый
            </RadioCard>
            <RadioCard value="voice" icon={icons.voiceChannel} description="Голос, видео и стримы">
              Голосовой
            </RadioCard>
          </RadioGroup>
        </div>
        <div style={{ width: "100%" }}>
          <Toggle description="Канал увидят только выбранные участники и роли">
            Приватный канал
          </Toggle>
        </div>
      </Stack>
    </Example>
  ),
};

export const L: Story = {
  render: () => (
    <Example label="Открыть Modal/L (700)" size="l" title="Быстрый переход" titleAlign="center">
      <TextInput aria-label="Куда перейти" placeholder="Канал или человек" />
    </Example>
  ),
};

export const LWide: Story = {
  render: () => (
    <Example
      label="Открыть Modal/L (960×630)"
      size="l"
      isWide
      height={630}
      title="Что будем стримить?"
    >
      <p style={{ margin: 0, color: "var(--color-muted)" }}>
        Здесь сетка миниатюр окон и экранов (SCREENS/05 §4).
      </p>
    </Example>
  ),
};

/** Подвал из двух кнопок на всю ширину пополам. */
export const SplitFooter: Story = {
  render: () => (
    <Example label="Открыть окно" size="s" title="Новое устройство" footerLayout="split">
      Подтверди вход на этом устройстве с другого своего устройства.
    </Example>
  ),
};

export const Confirm: Story = {
  render: () => (
    <Launcher label="Открыть Modal/Confirm">
      {({ isOpen, close }) => (
        <ConfirmModal
          isOpen={isOpen}
          onClose={close}
          onConfirm={close}
          title="Удалить сообщение"
          confirmLabel="Удалить"
          showShiftHint
          preview={
            <Stack gap={4}>
              <strong>Миша</strong>
              <span>Чайник поставил. Кто идёт в голосовой?</span>
            </Stack>
          }
        >
          Сообщение от <strong>Миши</strong> исчезнет у всех.
        </ConfirmModal>
      )}
    </Launcher>
  ),
};

const sections = ["Учётная запись", "Профиль", "Уведомления", "Голос и видео", "Внешний вид"];

function SettingsExample() {
  const [section, setSection] = useState("Профиль");
  const [name, setName] = useState("Миша");
  const [attention, setAttention] = useState(0);
  const dirty = name !== "Миша";
  return (
    <Launcher label="Открыть Modal/Settings">
      {({ isOpen, close }) => (
        <SettingsModal
          isOpen={isOpen}
          aria-label="Настройки"
          title={section}
          onCloseRequest={() => (dirty ? setAttention((count) => count + 1) : close())}
          navigation={
            <Stack gap={4}>
              {sections.map((item) => (
                <Button
                  key={item}
                  variant={item === section ? "secondary" : "link"}
                  size="s"
                  onPress={() => setSection(item)}
                >
                  {item}
                </Button>
              ))}
            </Stack>
          }
          saveBar={
            <SaveBar
              isVisible={dirty}
              attention={attention}
              onSave={() => setName("Миша")}
              onReset={() => setName("Миша")}
            />
          }
        >
          <Stack gap={16}>
            <TextInput label="Отображаемое имя" value={name} onChange={setName} />
            <span style={{ color: "var(--color-muted)" }}>
              Измени имя: появится плашка. С несохранёнными изменениями Esc и крестик не закрывают
              окно — плашка вздрагивает.
            </span>
          </Stack>
        </SettingsModal>
      )}
    </Launcher>
  );
}

/** `Modal/Settings`: каркас окна настроек пользователя (SCREENS/04). */
export const Settings: Story = { render: () => <SettingsExample /> };
