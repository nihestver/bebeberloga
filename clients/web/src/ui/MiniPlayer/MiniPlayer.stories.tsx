// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { MiniPlayer, type MiniPlayerCorner } from "./MiniPlayer";

const meta: Meta = { title: "MiniPlayer", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

function Demo() {
  const [corner, setCorner] = useState<MiniPlayerCorner>("bottom-right");
  return (
    <div style={{ position: "relative", height: "100vh", background: "var(--color-bg)" }}>
      <p style={{ margin: 0, padding: 24, color: "var(--color-muted)" }}>
        Основная область. Перетащи мини-плеер за шапку — он прилипнет к ближайшему углу. Сейчас:{" "}
        {corner}.
      </p>
      <MiniPlayer
        title="посиделки"
        caption="Миша"
        corner={corner}
        onCornerChange={setCorner}
        onReturn={() => undefined}
        actions={
          <>
            <IconButton icon={icons.settings} label="Настройки стрима" size="s" />
            <IconButton icon={icons.streamStop} label="Остановить" size="s" />
          </>
        }
      >
        Ваш стрим идёт
      </MiniPlayer>
    </div>
  );
}

export const Default: Story = { render: () => <Demo /> };
