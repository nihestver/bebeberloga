// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Stack, State, States } from "../stories/States";
import { QRCode } from "./QRCode";
import { QRScanner } from "./QRScanner";

const meta: Meta = { title: "QR" };
export default meta;
type Story = StoryObj;

/** Символ проекта 32 px в центре: заглушка; в клиенте сюда идёт brand/bebeberloga-symbol.svg. */
function Symbol() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="var(--color-accent)" />
      <circle cx="10" cy="10" r="4" fill="var(--color-accent)" />
      <circle cx="22" cy="10" r="4" fill="var(--color-accent)" />
      <circle cx="12.5" cy="15" r="1.6" fill="var(--color-on-accent)" />
      <circle cx="19.5" cy="15" r="1.6" fill="var(--color-on-accent)" />
      <ellipse cx="16" cy="20" rx="2.6" ry="1.8" fill="var(--color-on-accent)" />
    </svg>
  );
}

/** `QRCode`: квадрат 200 на подложке Туманом с отступом 12, символ 32 в центре. */
export const QRCodeStory: Story = {
  name: "QRCode",
  render: () => (
    <States>
      <State label="Подтверждение устройства">
        <QRCode
          value="berloga://verify?code=7Q2N-4KXP-9HZT&key=0123456789abcdef"
          center={<Symbol />}
        />
      </State>
      <State label="Без символа, 160">
        <QRCode value="berloga://invite/k3p9" size={160} />
      </State>
    </States>
  ),
};

function ScannerDemo() {
  const [found, setFound] = useState<string>();
  return (
    <Stack gap={12}>
      <QRScanner onDecode={setFound} />
      <span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-caption)" }}>
        {found ? `Распознано: ${found}` : "Пока ничего не распознано."}
      </span>
    </Stack>
  );
}

/** `QRScanner`: область камеры 4:3 с рамкой-прицелом Инеем; запрашивает доступ к камере. */
export const QRScannerStory: Story = {
  name: "QRScanner",
  render: () => <ScannerDemo />,
};

/** Без доступа к камере: сканер объясняет, что делать. */
export const QRScannerDenied: Story = {
  render: () => (
    <QRScanner
      onDecode={() => undefined}
      getStream={() =>
        Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
      }
    />
  ),
};
