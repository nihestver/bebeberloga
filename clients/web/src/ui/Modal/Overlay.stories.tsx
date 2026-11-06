// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SaveBar } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { Textarea, TextInput } from "../Input/Input";
import { Stack } from "../stories/States";
import { SettingsOverlay } from "./Modal";

const meta: Meta = { title: "Overlay", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const sections = ["Обзор", "Роли", "Участники", "Приглашения", "Баны"];

function Example() {
  const [isOpen, setOpen] = useState(true);
  const [section, setSection] = useState("Обзор");
  const [name, setName] = useState("Берлога");
  const [attention, setAttention] = useState(0);
  const dirty = name !== "Берлога";
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        Открыть Overlay/Settings
      </Button>
      <SettingsOverlay
        isOpen={isOpen}
        aria-label="Настройки сервера"
        title={section}
        onCloseRequest={() => (dirty ? setAttention((count) => count + 1) : setOpen(false))}
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
            onSave={() => setName("Берлога")}
            onReset={() => setName("Берлога")}
          />
        }
      >
        <Stack gap={16}>
          <TextInput label="Название сервера" value={name} onChange={setName} />
          <div style={{ width: "100%" }}>
            <Textarea label="Описание" placeholder="Пара слов о сервере" maxLength={120} />
          </div>
        </Stack>
      </SettingsOverlay>
    </div>
  );
}

/** `Overlay/Settings`: полноэкранный слой настроек сервера и канала; крестик с подписью Esc. */
export const Settings: Story = { render: () => <Example /> };
