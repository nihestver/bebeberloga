// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiDictionaries } from "../strings/UiProvider";
import { activeEscapeLayers, EscLayer, useEscapeLayer, type EscLayerLevel } from "./escape";
import {
  comboFromEvent,
  comboLabels,
  matchesCombo,
  parseCombo,
  type KeyCombo,
  type KeyEventLike,
  type Platform,
} from "./keys";
import {
  knownSystemConflicts,
  knownTextEditingConflicts,
  scopeInput,
  shortcutCombos,
  shortcutIds,
  shortcuts,
  systemReserved,
  textEditingReserved,
  type ShortcutDefinition,
  type ShortcutId,
} from "./registry";
import { setShortcutPlatform, useShortcut } from "./useShortcut";

function key(init: Partial<KeyEventLike>): KeyEventLike {
  return {
    code: "",
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

/** Каноническая запись сочетания на платформе: `Mod` раскрыт, порядок модификаторов фиксирован. */
function canonical(combo: KeyCombo, platform: Platform): string {
  const mac = platform === "mac";
  return [
    (combo.ctrl ?? (combo.mod && !mac)) ? "Ctrl" : "",
    (combo.meta ?? (combo.mod && mac)) ? "Meta" : "",
    combo.alt ? "Alt" : "",
    combo.shift ? "Shift" : "",
    combo.key ?? combo.code ?? "",
  ]
    .filter(Boolean)
    .join("+");
}

const definitions = shortcuts as Record<ShortcutId, ShortcutDefinition>;
const platforms: Platform[] = ["mac", "other"];

describe("сочетания клавиш: разбор и сравнение", () => {
  it("Mod — Cmd на macOS и Ctrl на остальных платформах", () => {
    const combo = parseCombo("Mod+K");
    expect(matchesCombo(key({ code: "KeyK", key: "k", metaKey: true }), combo, "mac")).toBe(true);
    expect(matchesCombo(key({ code: "KeyK", key: "k", ctrlKey: true }), combo, "mac")).toBe(false);
    expect(matchesCombo(key({ code: "KeyK", key: "k", ctrlKey: true }), combo, "other")).toBe(true);
  });

  it("буквы сравниваются по физической клавише: работает в русской раскладке", () => {
    const combo = parseCombo("Mod+K");
    expect(matchesCombo(key({ code: "KeyK", key: "л", ctrlKey: true }), combo, "other")).toBe(true);
    const single = parseCombo("R");
    expect(matchesCombo(key({ code: "KeyR", key: "к" }), single, "other")).toBe(true);
  });

  it("лишний модификатор — другое сочетание", () => {
    const combo = parseCombo("Mod+K");
    const event = key({ code: "KeyK", key: "K", ctrlKey: true, shiftKey: true });
    expect(matchesCombo(event, combo, "other")).toBe(false);
    expect(matchesCombo(key({ code: "KeyK", key: "k" }), combo, "other")).toBe(false);
  });

  it("«+» сравнивается по символу, с Shift и без", () => {
    const combo = parseCombo("Plus");
    expect(matchesCombo(key({ code: "Equal", key: "+", shiftKey: true }), combo, "other")).toBe(
      true,
    );
    expect(matchesCombo(key({ code: "NumpadAdd", key: "+" }), combo, "other")).toBe(true);
    expect(matchesCombo(key({ code: "Equal", key: "=" }), combo, "other")).toBe(false);
  });

  it("подписи зависят от платформы", () => {
    const combo = parseCombo("Mod+Alt+ArrowUp");
    expect(comboLabels(combo, "other")).toEqual(["Ctrl", "Alt", "↑"]);
    expect(comboLabels(combo, "mac")).toEqual(["Cmd", "Option", "↑"]);
    expect(comboLabels(parseCombo("Shift+Esc"), "other")).toEqual(["Shift", "Esc"]);
    expect(comboLabels({ code: "Space" }, "other", "Пробел")).toEqual(["Пробел"]);
  });

  it("запись сочетания из события ждёт клавишу, а не модификатор", () => {
    expect(comboFromEvent(key({ code: "ShiftLeft", key: "Shift", shiftKey: true }))).toBeNull();
    expect(comboFromEvent(key({ code: "KeyM", key: "m", ctrlKey: true, shiftKey: true }))).toEqual({
      code: "KeyM",
      ctrl: true,
      shift: true,
    });
  });

  it("неизвестная клавиша — ошибка, а не молчаливый пропуск", () => {
    expect(() => parseCombo("Mod+Foo")).toThrow();
    expect(() => parseCombo("Mod+Shift")).toThrow();
  });
});

describe("реестр сочетаний (SHORTCUTS.md)", () => {
  it("каждое сочетание разбирается, у каждого действия есть название на обоих языках", () => {
    for (const id of shortcutIds) {
      expect(() => shortcutCombos(id), id).not.toThrow();
      for (const locale of ["ru", "en"] as const) {
        const actions: Record<string, string> = uiDictionaries[locale].shortcuts.actions;
        expect(actions[id], `${locale}: ${id}`).toBeTruthy();
      }
    }
    for (const locale of ["ru", "en"] as const) {
      const { actions, gestures } = uiDictionaries[locale].shortcuts;
      expect(Object.keys(actions).sort()).toEqual([...shortcutIds].sort());
      const gestureIds = shortcutIds.filter((id) => definitions[id].gesture);
      expect(Object.keys(gestures).sort()).toEqual(gestureIds.sort());
    }
  });

  it("у действия без клавиш есть причина: жест или назначение пользователем", () => {
    for (const id of shortcutIds) {
      const definition = definitions[id];
      if (definition.combos.length === 0) {
        expect(Boolean(definition.gesture) || Boolean(definition.userAssigned), id).toBe(true);
      }
    }
  });

  it("сочетания не конфликтуют между собой", () => {
    // Места, которые не бывают активны одновременно: фокус находится только в одном из них.
    const focusContexts = new Set(["composer", "feed", "message", "stream"]);
    for (const platform of platforms) {
      const seen = new Map<string, ShortcutId[]>();
      for (const id of shortcutIds) {
        if (definitions[id].viaEscape) continue;
        for (const combo of shortcutCombos(id)) {
          const name = canonical(combo, platform);
          seen.set(name, [...(seen.get(name) ?? []), id]);
        }
      }
      for (const [combo, ids] of seen) {
        for (const [index, first] of ids.entries()) {
          for (const second of ids.slice(index + 1)) {
            const a = definitions[first];
            const b = definitions[second];
            const inputs = [scopeInput(a.scope), scopeInput(b.scope)];
            const disjointInput = inputs.includes("inside") && inputs.includes("outside");
            const disjointFocus =
              a.scope !== b.scope && focusContexts.has(a.scope) && focusContexts.has(b.scope);
            const disjointCondition = a.scope === b.scope && a.when !== b.when;
            expect(
              disjointInput || disjointFocus || disjointCondition,
              `${platform}: ${combo} — ${first} и ${second}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("порядок Esc покрывает все действия на Esc, и других обработчиков у них нет", () => {
    const viaEscape = shortcutIds.filter((id) => definitions[id].viaEscape);
    expect(viaEscape.sort()).toEqual(
      ["call.decline", "call.exitFullscreen", "nav.closeLayer", "nav.markChannelRead"].sort(),
    );
    for (const id of viaEscape) expect(definitions[id].combos).toEqual(["Esc"]);
  });

  function collisions(reserved: Record<"mac" | "other", readonly string[]>, inputs: string[]) {
    const found: { id: ShortcutId; platform: Platform }[] = [];
    for (const platform of platforms) {
      const taken = new Set(
        reserved[platform].map((text) => canonical(parseCombo(text), platform)),
      );
      for (const id of shortcutIds) {
        if (!inputs.includes(scopeInput(definitions[id].scope))) continue;
        if (shortcutCombos(id).some((combo) => taken.has(canonical(combo, platform)))) {
          found.push({ id, platform });
        }
      }
    }
    return found;
  }

  it("с системными сочетаниями расходится только то, что записано в OPEN-QUESTIONS", () => {
    expect(collisions(systemReserved, ["any", "inside", "outside"])).toEqual(knownSystemConflicts);
  });

  it("с правкой текста в поле ввода расходится только то, что записано в OPEN-QUESTIONS", () => {
    expect(collisions(textEditingReserved, ["any", "inside"])).toEqual(knownTextEditingConflicts);
  });
});

function Probe({
  id,
  onFire,
  isDisabled,
}: {
  id: ShortcutId;
  onFire: () => void;
  isDisabled?: boolean;
}) {
  useShortcut(id, onFire, { isDisabled });
  return null;
}

describe("useShortcut", () => {
  afterEach(() => setShortcutPlatform(undefined));

  it("вызывает обработчик по сочетанию и отменяет действие браузера", () => {
    setShortcutPlatform("other");
    const onFire = vi.fn();
    render(<Probe id="nav.quickSwitcher" onFire={onFire} />);

    const handled = !fireEvent.keyDown(document.body, { code: "KeyK", key: "л", ctrlKey: true });

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(handled).toBe(true);
  });

  it("сочетание «вне поля ввода» молчит, пока фокус в поле, а «в поле ввода» — наоборот", () => {
    setShortcutPlatform("other");
    const inbox = vi.fn();
    const italic = vi.fn();
    render(
      <>
        <textarea aria-label="Сообщение" />
        <Probe id="nav.inbox" onFire={inbox} />
        <Probe id="msg.italic" onFire={italic} />
      </>,
    );
    const press = { code: "KeyI", key: "i", ctrlKey: true };

    fireEvent.keyDown(document.body, press);
    expect([inbox.mock.calls.length, italic.mock.calls.length]).toEqual([1, 0]);

    fireEvent.keyDown(screen.getByLabelText("Сообщение"), press);
    expect([inbox.mock.calls.length, italic.mock.calls.length]).toEqual([1, 1]);
  });

  it("одиночная клавиша не срабатывает при наборе текста", () => {
    const reply = vi.fn();
    render(
      <>
        <input aria-label="Поиск" />
        <Probe id="msg.reply" onFire={reply} />
      </>,
    );

    fireEvent.keyDown(screen.getByLabelText("Поиск"), { code: "KeyR", key: "r" });
    expect(reply).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { code: "KeyR", key: "r" });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("отключённый обработчик не вызывается; после размонтирования — тоже", () => {
    setShortcutPlatform("other");
    const onFire = vi.fn();
    const press = { code: "Comma", key: ",", ctrlKey: true };
    const view = render(<Probe id="nav.settings" onFire={onFire} isDisabled />);

    fireEvent.keyDown(document.body, press);
    expect(onFire).not.toHaveBeenCalled();

    view.rerender(<Probe id="nav.settings" onFire={onFire} />);
    fireEvent.keyDown(document.body, press);
    expect(onFire).toHaveBeenCalledTimes(1);

    view.unmount();
    fireEvent.keyDown(document.body, press);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("из двух обработчиков одного действия срабатывает подписанный последним", () => {
    setShortcutPlatform("other");
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <Probe id="nav.quickSwitcher" onFire={first} />
        <Probe id="nav.quickSwitcher" onFire={second} />
      </>,
    );

    fireEvent.keyDown(document.body, { code: "KeyK", key: "k", ctrlKey: true });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("клавишу, уже обработанную элементом под фокусом, не перехватывает", () => {
    const pin = vi.fn();
    render(
      <>
        <button type="button" onKeyDown={(event) => event.preventDefault()}>
          Кнопка
        </button>
        <Probe id="msg.pin" onFire={pin} />
      </>,
    );

    fireEvent.keyDown(screen.getByRole("button"), { code: "KeyP", key: "p" });

    expect(pin).not.toHaveBeenCalled();
  });
});

function Layer({ level, onEscape }: { level: EscLayerLevel; onEscape: () => void }) {
  useEscapeLayer(level, onEscape);
  return null;
}

describe("порядок обработки Esc", () => {
  const escape = () => fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

  it("одно нажатие — одно действие, первое по списку SHORTCUTS.md", () => {
    const calls: string[] = [];
    const layer = (name: string, level: EscLayerLevel) => (
      <Layer key={name} level={level} onEscape={() => calls.push(name)} />
    );
    // Слои подписаны в обратном порядке: порядок задаёт тип слоя, а не время открытия.
    render(
      <>
        {layer("markRead", EscLayer.markRead)}
        {layer("incomingCall", EscLayer.incomingCall)}
        {layer("fullscreen", EscLayer.fullscreen)}
        {layer("modal", EscLayer.modal)}
        {layer("panel", EscLayer.panel)}
        {layer("reply", EscLayer.messageReply)}
        {layer("edit", EscLayer.messageEdit)}
        {layer("menu", EscLayer.menu)}
      </>,
    );

    escape();

    expect(calls).toEqual(["menu"]);
  });

  it("слои закрываются по очереди; среди равных — открытый последним", () => {
    const calls: string[] = [];
    function Stack() {
      const names = ["edit", "panel", "modal-1", "modal-2"].filter((name) => !calls.includes(name));
      const levels: Record<string, EscLayerLevel> = {
        edit: EscLayer.messageEdit,
        panel: EscLayer.panel,
        "modal-1": EscLayer.modal,
        "modal-2": EscLayer.modal,
      };
      return names.map((name) => (
        <Layer
          key={name}
          level={levels[name] ?? EscLayer.modal}
          onEscape={() => calls.push(name)}
        />
      ));
    }
    const view = render(<Stack />);

    for (let step = 0; step < 4; step += 1) {
      escape();
      view.rerender(<Stack />);
    }

    expect(calls).toEqual(["edit", "panel", "modal-2", "modal-1"]);
    expect(activeEscapeLayers()).toBe(0);
  });

  it("без слоёв Esc проходит дальше; Shift+Esc слои не трогает", () => {
    const onEscape = vi.fn();
    const passed = fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(passed).toBe(true);

    render(<Layer level={EscLayer.modal} onEscape={onEscape} />);
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape", shiftKey: true });
    expect(onEscape).not.toHaveBeenCalled();

    const intercepted = !escape();
    expect(intercepted).toBe(true);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
