// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Диспетчер клавиши Esc. SHORTCUTS.md («Порядок обработки Esc»): Esc выполняет одно действие —
// первое подходящее по списку. Порядок задаётся типом слоя, а не тем, что открыто позже.

import { useEffect, useRef } from "react";

/** Слои по порядку обработки: меньше число — раньше закрывается. */
export const EscLayer = {
  /** 1. Меню, подменю, подсказка автодополнения, эмодзи-пикер, выпадающий список. */
  menu: 10,
  /** 2. Отмена правки сообщения… */
  messageEdit: 20,
  /** …затем снятие режима ответа. */
  messageReply: 25,
  /** 3. Всплывающая панель (`Popover/Panel`). */
  panel: 30,
  /** 4. Верхнее модальное окно или слой настроек. */
  modal: 40,
  /** 5. Выход из полноэкранного режима стрима. */
  fullscreen: 50,
  /** 6. Отклонение входящего звонка (только когда фокус на `CallToast`). */
  incomingCall: 60,
  /** 7. В ленте без других слоёв — отметить канал прочитанным. */
  markRead: 70,
} as const;

export type EscLayerLevel = (typeof EscLayer)[keyof typeof EscLayer];

interface Entry {
  level: number;
  order: number;
  handler: () => void;
}

const entries = new Set<Entry>();
let counter = 0;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing) return;
  // Shift+Esc и другие сочетания с Esc — отдельные действия (см. registry.ts).
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;

  let top: Entry | undefined;
  for (const entry of entries) {
    if (!top || entry.level < top.level || (entry.level === top.level && entry.order > top.order)) {
      top = entry;
    }
  }
  if (!top) return;

  // Ровно одно действие: событие дальше не идёт, примитивы под ним ничего не закрывают сами.
  event.preventDefault();
  event.stopPropagation();
  top.handler();
}

function register(entry: Entry): () => void {
  if (entries.size === 0) document.addEventListener("keydown", onKeyDown, true);
  entries.add(entry);
  return () => {
    entries.delete(entry);
    if (entries.size === 0) document.removeEventListener("keydown", onKeyDown, true);
  };
}

/**
 * Подписывает слой на Esc, пока `isActive`. Из нескольких активных слоёв срабатывает один: с
 * наименьшим уровнем, а среди равных — подписанный последним (верхнее модальное окно).
 */
export function useEscapeLayer(level: EscLayerLevel, onEscape: () => void, isActive = true): void {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });

  useEffect(() => {
    if (!isActive) return;
    counter += 1;
    return register({ level, order: counter, handler: () => handler.current() });
  }, [level, isActive]);
}

/** Сколько слоёв сейчас ждёт Esc — для тестов и отладки. */
export function activeEscapeLayers(): number {
  return entries.size;
}
