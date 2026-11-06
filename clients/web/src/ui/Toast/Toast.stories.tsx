// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Button } from "../Button/Button";
import { Stack } from "../stories/States";
import { createToastQueue, showToast, ToastRegion } from "./Toast";

const meta: Meta = { title: "Toast" };
export default meta;
type Story = StoryObj;

function Demo() {
  // Своя очередь на историю: уведомления не перетекают между историями.
  const [queue] = useState(createToastQueue);
  useEffect(() => {
    // История сразу показывает оба вида; таймер 5 с, пока на них нет указателя.
    showToast("Ссылка скопирована", { queue, timeout: 5000 });
    showToast(
      { message: "Сообщение не отправлено", tone: "danger", actionLabel: "Повторить" },
      { queue, timeout: 5000 },
    );
  }, [queue]);

  return (
    <Stack gap={12}>
      <Button variant="secondary" onPress={() => showToast("Ссылка скопирована", { queue })}>
        Показать уведомление
      </Button>
      <Button
        variant="secondary"
        onPress={() =>
          showToast(
            { message: "Сообщение не отправлено", tone: "danger", actionLabel: "Повторить" },
            { queue },
          )
        }
      >
        Показать сбой с действием
      </Button>
      <span style={{ color: "var(--color-muted)", fontSize: "var(--font-size-caption)" }}>
        Одновременно видно не больше трёх; остальные ждут очереди.
      </span>
      <ToastRegion queue={queue} />
    </Stack>
  );
}

export const Default: Story = { render: () => <Demo /> };
