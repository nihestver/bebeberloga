// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Реестр стандартных сочетаний клавиш — docs/spec/SCREENS/SHORTCUTS.md. Глобальных (работающих
// в фоне) здесь нет: их назначает пользователь, а регистрирует desktop-оболочка (B09).

import { parseCombo, type KeyCombo } from "./keys";

export type ShortcutGroup = "navigation" | "messages" | "call";

/**
 * Где сочетание действует:
 * - `window` — в любом месте окна;
 * - `outsideInput` — когда фокус не в поле ввода;
 * - `composer` — только в поле ввода сообщения;
 * - `feed` — в ленте сообщений; `message` — при выбранном сообщении;
 * - `incomingCall` — пока показан входящий звонок; `stream` — при фокусе на стриме.
 */
export type ShortcutScope =
  "window" | "outsideInput" | "composer" | "feed" | "message" | "incomingCall" | "stream";

export interface ShortcutDefinition {
  /** Раздел окна «Сочетания клавиш» (SCREENS/10 §5.2). */
  group: ShortcutGroup;
  /** Сочетания в записи SHORTCUTS.md; пусто — назначает пользователь или это жест. */
  combos: readonly string[];
  scope: ShortcutScope;
  /** Условие из SHORTCUTS.md, отличающее действия с одной клавишей в одном месте. */
  when?: "emptyField" | "cursorAtStart";
  /** Обрабатывается диспетчером `Esc` (см. escape.ts), а не `useShortcut`. */
  viaEscape?: boolean;
  /** Жест без клавиши («Alt + клик», «любая печатная клавиша») — только для показа в списке. */
  gesture?: boolean;
  /** Сочетание задаёт пользователь в настройках; по умолчанию не назначено. */
  userAssigned?: boolean;
  /** Приоритет функции, если не M: такие сочетания включаются вместе с флагом функции. */
  priority?: "S";
}

export const shortcuts = {
  // Навигация
  "nav.quickSwitcher": { group: "navigation", combos: ["Mod+K"], scope: "window" },
  "nav.showShortcuts": { group: "navigation", combos: ["Mod+/"], scope: "window" },
  "nav.previousCommunity": { group: "navigation", combos: ["Mod+Alt+ArrowUp"], scope: "window" },
  "nav.nextCommunity": { group: "navigation", combos: ["Mod+Alt+ArrowDown"], scope: "window" },
  "nav.previousChannel": { group: "navigation", combos: ["Alt+ArrowUp"], scope: "window" },
  "nav.nextChannel": { group: "navigation", combos: ["Alt+ArrowDown"], scope: "window" },
  "nav.previousUnreadChannel": {
    group: "navigation",
    combos: ["Alt+Shift+ArrowUp"],
    scope: "window",
  },
  "nav.nextUnreadChannel": {
    group: "navigation",
    combos: ["Alt+Shift+ArrowDown"],
    scope: "window",
  },
  "nav.back": { group: "navigation", combos: ["Mod+["], scope: "window" },
  "nav.forward": { group: "navigation", combos: ["Mod+]"], scope: "window" },
  "nav.home": { group: "navigation", combos: ["Mod+Alt+H"], scope: "window" },
  "nav.inbox": { group: "navigation", combos: ["Mod+I"], scope: "outsideInput" },
  "nav.searchInChannel": {
    group: "navigation",
    combos: ["Mod+F"],
    scope: "window",
    priority: "S",
  },
  "nav.closeLayer": { group: "navigation", combos: ["Esc"], scope: "window", viaEscape: true },
  "nav.markChannelRead": { group: "navigation", combos: ["Esc"], scope: "feed", viaEscape: true },
  "nav.markCommunityRead": { group: "navigation", combos: ["Shift+Esc"], scope: "window" },
  "nav.oldestUnread": { group: "navigation", combos: ["Shift+PageUp"], scope: "outsideInput" },
  "nav.toggleMembers": { group: "navigation", combos: ["Mod+U"], scope: "outsideInput" },
  "nav.createOrJoinCommunity": { group: "navigation", combos: ["Mod+Shift+N"], scope: "window" },
  "nav.settings": { group: "navigation", combos: ["Mod+,"], scope: "window" },

  // Сообщения
  "msg.send": { group: "messages", combos: ["Enter"], scope: "composer" },
  "msg.newLine": { group: "messages", combos: ["Shift+Enter"], scope: "composer" },
  "msg.editLast": {
    group: "messages",
    combos: ["ArrowUp"],
    scope: "composer",
    when: "emptyField",
  },
  "msg.focusComposer": { group: "messages", combos: ["Tab"], scope: "feed" },
  "msg.focusComposerByTyping": { group: "messages", combos: [], scope: "feed", gesture: true },
  "msg.focusFeed": { group: "messages", combos: ["Shift+Tab"], scope: "composer" },
  "msg.focusFeedFromStart": {
    group: "messages",
    combos: ["ArrowUp"],
    scope: "composer",
    when: "cursorAtStart",
  },
  "msg.selectPrevious": { group: "messages", combos: ["ArrowUp"], scope: "feed" },
  "msg.selectNext": { group: "messages", combos: ["ArrowDown"], scope: "feed" },
  "msg.reply": { group: "messages", combos: ["R"], scope: "message" },
  "msg.edit": { group: "messages", combos: ["E"], scope: "message" },
  "msg.pin": { group: "messages", combos: ["P"], scope: "message" },
  "msg.react": { group: "messages", combos: ["Plus"], scope: "message" },
  "msg.delete": { group: "messages", combos: ["Backspace"], scope: "message" },
  "msg.deleteNow": { group: "messages", combos: ["Shift+Backspace"], scope: "message" },
  "msg.markUnread": { group: "messages", combos: [], scope: "feed", gesture: true },
  "msg.upload": { group: "messages", combos: ["Mod+Shift+U"], scope: "window" },
  "msg.emojiPicker": { group: "messages", combos: ["Mod+E"], scope: "window" },
  "msg.bold": { group: "messages", combos: ["Mod+B"], scope: "composer" },
  "msg.italic": { group: "messages", combos: ["Mod+I"], scope: "composer" },
  "msg.underline": { group: "messages", combos: ["Mod+U"], scope: "composer" },
  "msg.code": { group: "messages", combos: ["Mod+Shift+C"], scope: "composer" },

  // Звонок
  "call.toggleMic": { group: "call", combos: ["Mod+Shift+M"], scope: "window" },
  "call.toggleSound": { group: "call", combos: ["Mod+Shift+D"], scope: "window" },
  "call.answer": { group: "call", combos: ["Mod+Enter"], scope: "incomingCall" },
  "call.decline": { group: "call", combos: ["Esc"], scope: "incomingCall", viaEscape: true },
  "call.hangup": { group: "call", combos: ["Mod+Shift+E"], scope: "window" },
  "call.toggleStream": { group: "call", combos: ["Mod+Shift+S"], scope: "window" },
  "call.pushToTalk": { group: "call", combos: [], scope: "window", userAssigned: true },
  "call.streamFullscreen": { group: "call", combos: ["F"], scope: "stream" },
  "call.exitFullscreen": { group: "call", combos: ["Esc"], scope: "stream", viaEscape: true },
  "call.soundboard": { group: "call", combos: ["Mod+Shift+B"], scope: "window" },
  "call.playSound": { group: "call", combos: [], scope: "window", userAssigned: true },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof shortcuts;

export const shortcutIds = Object.keys(shortcuts) as ShortcutId[];

export const shortcutGroups: readonly ShortcutGroup[] = ["navigation", "messages", "call"];

export function shortcutDefinition(id: ShortcutId): ShortcutDefinition {
  return shortcuts[id];
}

const parsed = new Map<ShortcutId, KeyCombo[]>();

/** Разобранные сочетания действия. */
export function shortcutCombos(id: ShortcutId): KeyCombo[] {
  let combos = parsed.get(id);
  if (!combos) {
    combos = shortcuts[id].combos.map(parseCombo);
    parsed.set(id, combos);
  }
  return combos;
}

/** В каком положении фокуса действует область: в поле ввода, вне его или везде. */
export function scopeInput(scope: ShortcutScope): "inside" | "outside" | "any" {
  switch (scope) {
    case "composer":
      return "inside";
    case "outsideInput":
    case "feed":
    case "message":
    case "stream":
      return "outside";
    case "window":
    case "incomingCall":
      return "any";
  }
}

/**
 * Сочетания, занятые операционной системой: у приложения их перехватывает ОС либо они ломают
 * привычное поведение. Запись — как в SHORTCUTS.md; `Mod` раскрыт по платформе.
 */
export const systemReserved: Record<"mac" | "other", readonly string[]> = {
  mac: [
    "Meta+Q", // выйти из приложения
    "Meta+W", // закрыть окно
    "Meta+H", // скрыть приложение
    "Meta+Alt+H", // скрыть остальные приложения
    "Meta+M", // свернуть окно
    "Meta+Tab", // переключение приложений
    "Meta+Space", // поиск Spotlight
    "Meta+`", // следующее окно приложения
    "Meta+Alt+Esc", // принудительное завершение
    "Meta+Shift+3", // снимок экрана
    "Meta+Shift+4",
    "Meta+Shift+5",
    "Ctrl+ArrowUp", // Mission Control
    "Ctrl+ArrowDown",
  ],
  other: [
    "Alt+F4", // закрыть окно
    "Alt+Tab", // переключение окон
    "Alt+Space", // меню окна
    "Ctrl+Alt+Delete",
    "Ctrl+Shift+Esc", // диспетчер задач
    "Ctrl+Esc", // меню «Пуск»
    "Meta+D", // показать рабочий стол
    "Meta+L", // блокировка экрана
  ],
};

/**
 * Сочетания, которыми в полях ввода двигают курсор и правят текст. Действие с областью `window`
 * или `composer` на таком сочетании отнимает его у поля ввода.
 */
export const textEditingReserved: Record<"mac" | "other", readonly string[]> = {
  mac: [
    "Alt+ArrowUp", // курсор в начало абзаца
    "Alt+ArrowDown", // курсор в конец абзаца
    "Alt+Shift+ArrowUp", // выделение до начала абзаца
    "Alt+Shift+ArrowDown", // выделение до конца абзаца
    "Alt+ArrowLeft", // курсор на слово влево
    "Alt+ArrowRight", // курсор на слово вправо
    "Meta+ArrowLeft", // курсор в начало строки
    "Meta+ArrowRight", // курсор в конец строки
    "Meta+ArrowUp", // курсор в начало текста
    "Meta+ArrowDown", // курсор в конец текста
    "Meta+A",
    "Meta+C",
    "Meta+V",
    "Meta+X",
    "Meta+Z",
    "Meta+Shift+Z",
  ],
  other: [
    "Ctrl+ArrowLeft", // курсор на слово влево
    "Ctrl+ArrowRight", // курсор на слово вправо
    "Ctrl+Backspace", // удалить слово
    "Ctrl+Delete",
    "Ctrl+A",
    "Ctrl+C",
    "Ctrl+V",
    "Ctrl+X",
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Shift+Z",
  ],
};

/**
 * Расхождения набора SHORTCUTS.md с системой, найденные при проверке в B08. Набор не меняем —
 * это решение спецификации; вопросы записаны в docs/spec/OPEN-QUESTIONS.md.
 */
export const knownSystemConflicts: readonly { id: ShortcutId; platform: "mac" | "other" }[] = [
  // Cmd+Option+H на macOS — системное «Скрыть остальные».
  { id: "nav.home", platform: "mac" },
];

/**
 * Расхождения с полем ввода: на macOS Option+↑/↓ (и с Shift) двигают курсор по абзацам, а по
 * SHORTCUTS.md переключают каналы в любом месте окна. Вопрос — там же, в OPEN-QUESTIONS.md.
 */
export const knownTextEditingConflicts: readonly { id: ShortcutId; platform: "mac" | "other" }[] = [
  { id: "nav.previousChannel", platform: "mac" },
  { id: "nav.nextChannel", platform: "mac" },
  { id: "nav.previousUnreadChannel", platform: "mac" },
  { id: "nav.nextUnreadChannel", platform: "mac" },
];
