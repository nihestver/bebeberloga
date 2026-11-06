// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Tooltip, Popover/Panel, Toast, SaveBar, Banner, CallToast, MiniPlayer, Button/Split.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner, SAVE_BAR_ALERT_MS, SaveBar } from "../Banner/Banner";
import { Button, IconButton } from "../Button/Button";
import { SplitButton } from "../Button/SplitButton";
import { CALL_TOAST_TIMEOUT_MS, CallToast } from "../CallToast/CallToast";
import { icons } from "../icons/icons";
import { MenuItem } from "../Menu/Menu";
import { MiniPlayer, moveCorner, nearestCorner } from "../MiniPlayer/MiniPlayer";
import { PopoverPanel } from "../Popover/PopoverPanel";
import { createToastQueue, showToast, TOAST_LIMIT, ToastRegion } from "../Toast/Toast";
import { Tooltip, TOOLTIP_DELAY_MS, TOOLTIP_SUCCESS_MS, useSuccessTooltip } from "./Tooltip";

afterEach(() => {
  vi.useRealTimers();
});

describe("Tooltip", () => {
  // Этот тест идёт первым: после любой показанной подсказки следующие какое-то время
  // открываются без задержки (переход между соседними кнопками), и замер был бы неверным.
  it("при наведении появляется через 500 мс, не раньше", async () => {
    // Часы идут сами (иначе имитация указателя не завершится), а задержку проматываем вручную.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(
      <Tooltip content="Настройки пользователя">
        <Button>Настройки</Button>
      </Tooltip>,
    );

    // Указатель сначала движется по странице: подсказка реагирует на наведение мышью, а не на
    // элемент, оказавшийся под курсором при загрузке.
    await user.pointer({ target: document.body });
    await user.hover(screen.getByRole("button", { name: "Настройки" }));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 150);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("показывается сразу при фокусе с клавиатуры и описывает источник", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Настройки пользователя">
        <Button>Настройки</Button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.tab();

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Настройки пользователя");
    expect(screen.getByRole("button", { name: "Настройки" })).toHaveAccessibleDescription(
      "Настройки пользователя",
    );

    await user.tab();
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("Tooltip/Success держится 1.5 с", () => {
    vi.useFakeTimers();
    function Demo() {
      const done = useSuccessTooltip();
      return (
        <Tooltip variant="success" content="Микрофон выключен" isOpen={done.isOpen}>
          <Button onPress={done.show}>Микрофон</Button>
        </Tooltip>
      );
    }
    render(<Demo />);

    fireEvent.click(screen.getByRole("button", { name: "Микрофон" }));
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-variant", "success");

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_SUCCESS_MS - 100);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Popover/Panel", () => {
  function panel() {
    return (
      <PopoverPanel
        trigger={<IconButton icon={icons.pin} label="Закреплённые" />}
        title="Закреплённые"
        icon={icons.pin}
      >
        <Button>Показать все</Button>
      </PopoverPanel>
    );
  }

  it("открывается с кнопки, названа заголовком, закрывается повторным кликом", async () => {
    const user = userEvent.setup();
    render(panel());
    const trigger = screen.getByRole("button", { name: "Закреплённые" });

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Закреплённые" });
    expect(within(dialog).getByRole("button", { name: "Показать все" })).toBeInTheDocument();

    // Действие внутри панель не закрывает.
    await user.click(within(dialog).getByRole("button", { name: "Показать все" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Esc закрывает панель и возвращает фокус на источник", async () => {
    const user = userEvent.setup();
    render(panel());
    const trigger = screen.getByRole("button", { name: "Закреплённые" });
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("Toast", () => {
  it("одновременно видно не больше трёх; действие вызывается и закрывает уведомление", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const queue = createToastQueue();
    render(<ToastRegion queue={queue} />);

    act(() => {
      for (let index = 1; index <= TOAST_LIMIT + 1; index += 1) {
        showToast(`Уведомление ${index}`, { queue });
      }
      showToast(
        { message: "Сообщение не отправлено", tone: "danger", actionLabel: "Повторить", onAction },
        { queue },
      );
    });

    const region = screen.getByRole("region", { name: /Уведомления/ });
    expect(within(region).getAllByRole("alertdialog")).toHaveLength(TOAST_LIMIT);
    expect(region).toHaveTextContent("Сообщение не отправлено");
    // Самое старое ждёт очереди.
    expect(region).not.toHaveTextContent("Уведомление 1");

    await user.click(within(region).getByRole("button", { name: "Повторить" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(region).not.toHaveTextContent("Сообщение не отправлено"));
  });

  it("время показа приводится к 3–5 с", () => {
    const queue = createToastQueue();
    const add = vi.spyOn(queue, "add");

    showToast("Быстро", { queue, timeout: 100 });
    showToast("Долго", { queue, timeout: 60_000 });
    showToast("По умолчанию", { queue });

    expect(add.mock.calls.map(([, options]) => options?.timeout)).toEqual([3000, 5000, 4000]);
  });
});

describe("SaveBar", () => {
  const noop = () => undefined;

  it("появляется при несохранённых изменениях; кнопки сохраняют и сбрасывают", async () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    const user = userEvent.setup();
    const view = render(<SaveBar isVisible={false} onSave={onSave} onReset={onReset} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    view.rerender(<SaveBar isVisible onSave={onSave} onReset={onReset} />);
    expect(screen.getByRole("status")).toHaveTextContent("Есть несохранённые изменения");

    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect([onReset.mock.calls.length, onSave.mock.calls.length]).toEqual([1, 1]);
  });

  it("при попытке уйти краснеет на 1 с", () => {
    vi.useFakeTimers();
    const view = render(<SaveBar isVisible attention={0} onSave={noop} onReset={noop} />);
    expect(screen.getByRole("status")).not.toHaveAttribute("data-alert");

    view.rerender(<SaveBar isVisible attention={1} onSave={noop} onReset={noop} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-alert", "true");

    act(() => {
      vi.advanceTimersByTime(SAVE_BAR_ALERT_MS + 50);
    });
    expect(screen.getByRole("status")).not.toHaveAttribute("data-alert");
  });
});

describe("Banner", () => {
  it("сбой объявляется сразу (alert), остальное — вежливо (status); кнопка справа работает", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Banner tone="danger">Медведь споткнулся. Переподключаемся…</Banner>
        <Banner actionLabel="Показать" onAction={onAction}>
          Этот канал скрыт
        </Banner>
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Медведь споткнулся");
    expect(screen.getByRole("status")).toHaveTextContent("Этот канал скрыт");

    await user.click(screen.getByRole("button", { name: "Показать" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe("CallToast", () => {
  function toast(handlers: {
    onAccept?: () => void;
    onDecline?: () => void;
    onTimeout?: () => void;
  }) {
    return (
      <CallToast
        name="Миша"
        avatar={<span>М</span>}
        onAccept={handlers.onAccept ?? vi.fn()}
        onDecline={handlers.onDecline ?? vi.fn()}
        onTimeout={handlers.onTimeout}
      />
    );
  }

  it("называет звонящего и даёт ответить или отклонить", async () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const user = userEvent.setup();
    render(toast({ onAccept, onDecline }));

    const dialog = screen.getByRole("alertdialog", { name: "Миша звонит" });
    await user.click(within(dialog).getByRole("button", { name: "Ответить" }));
    await user.click(within(dialog).getByRole("button", { name: "Отклонить" }));

    expect([onAccept.mock.calls.length, onDecline.mock.calls.length]).toEqual([1, 1]);
  });

  it("Esc отклоняет звонок, только когда фокус на карточке", async () => {
    const onDecline = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Вне карточки</button>
        {toast({ onDecline })}
      </>,
    );

    screen.getByRole("button", { name: "Вне карточки" }).focus();
    await user.keyboard("{Escape}");
    expect(onDecline).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "Ответить" }).focus();
    await user.keyboard("{Escape}");
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("через 30 с без ответа сообщает о пропущенном звонке", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    render(toast({ onTimeout }));

    act(() => {
      vi.advanceTimersByTime(CALL_TOAST_TIMEOUT_MS - 1000);
    });
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

describe("MiniPlayer", () => {
  it("после перетаскивания прилипает к ближайшему из четырёх углов", () => {
    const area = { width: 1000, height: 600 };
    expect(nearestCorner({ x: 100, y: 100 }, area)).toBe("top-left");
    expect(nearestCorner({ x: 900, y: 100 }, area)).toBe("top-right");
    expect(nearestCorner({ x: 100, y: 500 }, area)).toBe("bottom-left");
    expect(nearestCorner({ x: 900, y: 500 }, area)).toBe("bottom-right");
    expect(nearestCorner({ x: 500, y: 300 }, area)).toBe("bottom-right");
  });

  it("стрелки переносят в соседний угол; у края угол не меняется", () => {
    expect(moveCorner("bottom-right", "ArrowUp")).toBe("top-right");
    expect(moveCorner("bottom-right", "ArrowLeft")).toBe("bottom-left");
    expect(moveCorner("top-left", "ArrowUp")).toBe("top-left");
    expect(moveCorner("top-left", "ArrowRight")).toBe("top-right");
    expect(moveCorner("top-left", "Enter")).toBe("top-left");
  });

  it("с клавиатуры угол меняют стрелки на ручке переноса; шапка возвращает к звонку", async () => {
    const onCornerChange = vi.fn();
    const onReturn = vi.fn();
    const user = userEvent.setup();
    render(
      <MiniPlayer title="посиделки" onReturn={onReturn} onCornerChange={onCornerChange}>
        Ваш стрим идёт
      </MiniPlayer>,
    );
    const player = screen.getByRole("group", { name: "Мини-плеер" });
    expect(player).toHaveAttribute("data-corner", "bottom-right");

    screen.getByRole("button", { name: /Перенести мини-плеер/ }).focus();
    await user.keyboard("{ArrowUp}{ArrowLeft}{ArrowLeft}");

    expect(onCornerChange.mock.calls).toEqual([["top-right"], ["top-left"]]);
    expect(player).toHaveAttribute("data-corner", "top-left");

    await user.click(screen.getByRole("button", { name: /посиделки/ }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});

describe("Button/Split", () => {
  it("переключатель и стрелка — две кнопки; стрелка открывает меню", async () => {
    const onChange = vi.fn();
    const onDevice = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitButton
        icon={icons.mic}
        selectedIcon={icons.micOff}
        label="Выключить микрофон"
        tone="danger"
        onChange={onChange}
        menuLabel="Устройство ввода"
        menu={<MenuItem onAction={onDevice}>Гарнитура</MenuItem>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Выключить микрофон" }));
    expect(onChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Устройство ввода" }));
    await user.click(await screen.findByRole("menuitem", { name: "Гарнитура" }));
    expect(onDevice).toHaveBeenCalledTimes(1);
  });
});
