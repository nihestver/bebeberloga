// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Avatar } from "../Avatar/Avatar";
import { Button } from "../Button/Button";
import { CallToast } from "./CallToast";

const meta: Meta = { title: "CallToast", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

function Demo() {
  const [state, setState] = useState<"ringing" | "accepted" | "declined" | "missed">("ringing");
  const text = {
    ringing: "Входящий звонок — карточка в правом нижнем углу.",
    accepted: "Звонок принят.",
    declined: "Звонок отклонён.",
    missed: "Звонок остался без ответа (30 с).",
  }[state];
  return (
    <div style={{ display: "grid", placeItems: "center", gap: 12, minHeight: "100vh" }}>
      <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
        <span>{text}</span>
        {state !== "ringing" && (
          <Button variant="secondary" onPress={() => setState("ringing")}>
            Позвонить ещё раз
          </Button>
        )}
      </div>
      {state === "ringing" && (
        <CallToast
          name="Миша"
          avatar={<Avatar size={48} name="Миша" avatarId="bear" tone={5} />}
          onAccept={() => setState("accepted")}
          onDecline={() => setState("declined")}
          onTimeout={() => setState("missed")}
        />
      )}
    </div>
  );
}

export const Default: Story = { render: () => <Demo /> };
