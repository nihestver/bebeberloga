// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SaveBar } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { TextInput } from "../Input/Input";
import { Select } from "../Select/Select";
import { ConfirmModal, Modal, SettingsOverlay } from "./Modal";

function Harness({ onClose }: { onClose?: () => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>Создать канал</Button>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        title="Новый канал"
        footer={
          <>
            <Button variant="secondary" onPress={() => setOpen(false)}>
              Отмена
            </Button>
            <Button>Создать</Button>
          </>
        }
      >
        <TextInput label="Название канала" />
        <Select
          label="Категория"
          options={[
            { id: "text", label: "Текстовые" },
            { id: "voice", label: "Голосовые" },
          ]}
        />
      </Modal>
    </>
  );
}

describe("Modal: фокус и клавиатура", () => {
  it("открывается с заголовком в имени, переносит фокус внутрь", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Создать канал" }));
    const dialog = await screen.findByRole("dialog", { name: "Новый канал" });

    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it("ловит фокус: Tab и Shift+Tab ходят по кругу внутри окна", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Создать канал" }));
    const dialog = await screen.findByRole("dialog");
    const inside = within(dialog);
    const first = inside.getByRole("button", { name: "Закрыть" });
    const last = inside.getByRole("button", { name: "Создать" });

    first.focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();

    // Полный круг: фокус ни разу не выходит из окна.
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("Esc закрывает окно и возвращает фокус на кнопку-источник", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Создать канал" });
    await user.click(opener);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("крестик закрывает окно", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Создать канал" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Закрыть" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc сначала закрывает открытый список внутри окна, потом само окно", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Создать канал" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /Категория/ }));
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Modal/Confirm", () => {
  it("роль alertdialog, фраза о необратимости, подтверждение и отмена", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Удалить сообщение"
        confirmLabel="Удалить"
        showShiftHint
      >
        Сообщение от <strong>Миши</strong> исчезнет у всех.
      </ConfirmModal>,
    );

    const dialog = await screen.findByRole("alertdialog", { name: "Удалить сообщение" });
    expect(dialog).toHaveTextContent("Это действие нельзя отменить.");
    expect(dialog).toHaveTextContent("С зажатым Shift действие выполняется без подтверждения.");

    await user.click(within(dialog).getByRole("button", { name: "Удалить" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Overlay/Settings", () => {
  function Settings({ dirty }: { dirty: boolean }) {
    const [isOpen, setOpen] = useState(true);
    const [attention, setAttention] = useState(0);
    return (
      <SettingsOverlay
        isOpen={isOpen}
        aria-label="Настройки сервера"
        title="Обзор"
        navigation={<Button variant="link">Обзор</Button>}
        onCloseRequest={() => (dirty ? setAttention((count) => count + 1) : setOpen(false))}
        saveBar={
          <SaveBar
            isVisible={dirty}
            attention={attention}
            onSave={() => undefined}
            onReset={() => undefined}
          />
        }
      >
        <TextInput label="Название сервера" />
      </SettingsOverlay>
    );
  }

  it("без несохранённых изменений Esc закрывает слой", async () => {
    const user = userEvent.setup();
    render(<Settings dirty={false} />);
    const dialog = await screen.findByRole("dialog", { name: "Настройки сервера" });
    expect(within(dialog).getByRole("navigation", { name: "Разделы настроек" })).toBeVisible();
    expect(within(dialog).getByText("Esc")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("с несохранёнными изменениями Esc не закрывает слой: плашка вздрагивает", async () => {
    const user = userEvent.setup();
    render(<Settings dirty />);
    await screen.findByRole("dialog");
    const bar = () => screen.getByText("Есть несохранённые изменения").closest("[role=status]");
    expect(bar()).not.toHaveAttribute("data-alert");

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(bar()).toHaveAttribute("data-alert", "true");
  });
});
