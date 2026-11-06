// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { pick } from "../../test/pick";
import { IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { Slider } from "../Slider/Slider";
import {
  ContextMenu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  PopoverMenu,
  QuickReactions,
  Submenu,
} from "./Menu";

function messageMenu(handlers: Record<string, () => void> = {}) {
  return (
    <>
      <QuickReactions emojis={["👍", "❤️", "😂", "🐻", "🎉"]} onReact={handlers.react ?? vi.fn()} />
      <MenuItem icon={icons.reply} shortcut="msg.reply" onAction={handlers.reply}>
        Ответить
      </MenuItem>
      <MenuItem icon={icons.edit} description="Только своё сообщение" onAction={handlers.edit}>
        Изменить
      </MenuItem>
      <Submenu label="Ещё" icon={icons.more}>
        <MenuItem onAction={handlers.copy}>Копировать текст</MenuItem>
        <MenuItem onAction={handlers.link}>Копировать ссылку</MenuItem>
      </Submenu>
      <MenuItem isDisabled>Закрепить</MenuItem>
      <MenuSeparator />
      <MenuItem icon={icons.delete} isDanger onAction={handlers.remove}>
        Удалить
      </MenuItem>
    </>
  );
}

function openContextMenu(handlers?: Record<string, () => void>) {
  render(
    <ContextMenu aria-label="Действия с сообщением" menu={messageMenu(handlers)}>
      <button type="button">Сообщение</button>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Сообщение" }), {
    clientX: 120,
    clientY: 80,
  });
}

describe("Menu/Context: клавиатура", () => {
  it("открывается правым кликом, фокус — на первом пункте", async () => {
    openContextMenu();

    const menu = await screen.findByRole("menu", { name: "Действия с сообщением" });
    const items = within(menu).getAllByRole("menuitem");
    // Четыре быстрые реакции (пятая отброшена) и пять пунктов.
    expect(items).toHaveLength(9);
    await waitFor(() => expect(items[0]).toHaveFocus());
    expect(items[0]).toHaveTextContent("👍");
  });

  it("стрелки ходят по пунктам, пропуская неактивный, и по кругу", async () => {
    const user = userEvent.setup();
    openContextMenu();
    const menu = await screen.findByRole("menu");
    const item = (name: string | RegExp) => within(menu).getByRole("menuitem", { name });
    await waitFor(() => expect(item("👍")).toHaveFocus());

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(item(/Ответить/)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item(/Изменить/)).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Ещё")).toHaveFocus();
    // «Закрепить» неактивен — фокус переходит сразу к «Удалить».
    await user.keyboard("{ArrowDown}");
    expect(item("Удалить")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("👍")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Удалить")).toHaveFocus();
  });

  it("Enter выполняет пункт и закрывает меню", async () => {
    const reply = vi.fn();
    const user = userEvent.setup();
    openContextMenu({ reply });
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "👍" })).toHaveFocus());

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(reply).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("Esc закрывает меню без действия и возвращает фокус", async () => {
    const handlers = { reply: vi.fn(), remove: vi.fn() };
    const user = userEvent.setup();
    render(
      <ContextMenu aria-label="Действия с сообщением" menu={messageMenu(handlers)}>
        <button type="button">Сообщение</button>
      </ContextMenu>,
    );
    const target = screen.getByRole("button", { name: "Сообщение" });
    target.focus();
    fireEvent.contextMenu(target, { clientX: 10, clientY: 10 });
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(handlers.reply).not.toHaveBeenCalled();
    expect(handlers.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(target).toHaveFocus());
  });

  it("подменю открывается стрелкой вправо и закрывается стрелкой влево", async () => {
    const copy = vi.fn();
    const user = userEvent.setup();
    openContextMenu({ copy });
    const menu = await screen.findByRole("menu");
    const more = within(menu).getByRole("menuitem", { name: "Ещё" });
    expect(more).toHaveAttribute("aria-haspopup");
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "👍" })).toHaveFocus());

    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowRight}");
    const submenuItem = await screen.findByRole("menuitem", { name: "Копировать текст" });
    await waitFor(() => expect(submenuItem).toHaveFocus());

    await user.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Копировать текст" })).not.toBeInTheDocument(),
    );
    expect(more).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    await screen.findByRole("menuitem", { name: "Копировать текст" });
    await user.keyboard("{Enter}");
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("быстрая реакция сообщает выбранный эмодзи", async () => {
    const react = vi.fn();
    const user = userEvent.setup();
    openContextMenu({ react });
    const menu = await screen.findByRole("menu");

    await user.click(within(menu).getByRole("menuitem", { name: "🐻" }));

    expect(react).toHaveBeenCalledWith("🐻");
  });

  it("пункт несёт пояснение и сочетание клавиш; опасный пункт помечен", async () => {
    openContextMenu();
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: /Изменить/ })).toHaveAccessibleDescription(
      /Только своё сообщение/,
    );
    expect(within(menu).getByRole("menuitem", { name: /Ответить/ })).toHaveTextContent("R");
    expect(within(menu).getByRole("menuitem", { name: "Удалить" })).toHaveAttribute(
      "data-danger",
      "true",
    );
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
  });

  it("отключённое меню не открывается и не мешает системному", () => {
    render(
      <ContextMenu aria-label="Действия" menu={messageMenu()} isDisabled>
        <button type="button">Сообщение</button>
      </ContextMenu>,
    );

    const notPrevented = fireEvent.contextMenu(screen.getByRole("button", { name: "Сообщение" }));

    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("Menu/Popover", () => {
  it("открывается с кнопки, отмечает выбранный пункт галочкой", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PopoverMenu trigger={<IconButton icon={icons.chevronDown} label="Устройство ввода" />}>
        <MenuSection
          title="Микрофон"
          selectionMode="single"
          selectedKeys={["built-in"]}
          onSelectionChange={onChange}
        >
          <MenuItem id="built-in">Встроенный</MenuItem>
          <MenuItem id="headset">Гарнитура</MenuItem>
        </MenuSection>
      </PopoverMenu>,
    );

    await user.tab();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const radios = within(menu).getAllByRole("menuitemradio");
    expect(pick(radios, 0)).toHaveAttribute("aria-checked", "true");

    await user.click(pick(radios, 1));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("может содержать слайдер над пунктами; Esc закрывает меню", async () => {
    const user = userEvent.setup();
    render(
      <PopoverMenu
        aria-label="Громкость"
        trigger={<IconButton icon={icons.headphones} label="Звук" />}
        header={<Slider label="Громкость" defaultValue={80} />}
      >
        <MenuItem>Настройки голоса</MenuItem>
      </PopoverMenu>,
    );

    await user.click(screen.getByRole("button", { name: "Звук" }));
    await screen.findByRole("menu");
    expect(screen.getByRole("slider", { name: "Громкость" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
