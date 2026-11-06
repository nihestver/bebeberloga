// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useEffect, useRef } from "react";
import { detectPlatform, isEditableTarget, matchesCombo, type Platform } from "./keys";
import {
  scopeInput,
  shortcutCombos,
  shortcutDefinition,
  shortcutIds,
  type ShortcutId,
} from "./registry";

type Handler = (event: KeyboardEvent) => void;

interface Registration {
  order: number;
  handler: Handler;
}

const registrations = new Map<ShortcutId, Set<Registration>>();
let counter = 0;
let platform: Platform | undefined;

/** Подменяет платформу (что такое `Mod`) — для тестов. `undefined` возвращает автоопределение. */
export function setShortcutPlatform(value: Platform | undefined): void {
  platform = value;
}

function latest(set: Set<Registration>): Registration | undefined {
  let top: Registration | undefined;
  for (const item of set) {
    if (!top || item.order > top.order) top = item;
  }
  return top;
}

function onKeyDown(event: KeyboardEvent): void {
  // Клавишу уже обработал элемент под фокусом (кнопка, список) или идёт ввод через IME.
  if (event.defaultPrevented || event.isComposing) return;
  const editable = isEditableTarget(event.target);
  const current = platform ?? detectPlatform();

  for (const id of shortcutIds) {
    const active = registrations.get(id);
    if (!active || active.size === 0) continue;
    const definition = shortcutDefinition(id);
    if (definition.viaEscape) continue;
    const input = scopeInput(definition.scope);
    if ((input === "inside" && !editable) || (input === "outside" && editable)) continue;
    if (!shortcutCombos(id).some((combo) => matchesCombo(event, combo, current))) continue;

    event.preventDefault();
    latest(active)?.handler(event);
    return;
  }
}

function register(id: ShortcutId, registration: Registration): () => void {
  if (registrations.size === 0) window.addEventListener("keydown", onKeyDown);
  let set = registrations.get(id);
  if (!set) {
    set = new Set();
    registrations.set(id, set);
  }
  set.add(registration);
  return () => {
    set.delete(registration);
    if (set.size === 0) registrations.delete(id);
    if (registrations.size === 0) window.removeEventListener("keydown", onKeyDown);
  };
}

export interface UseShortcutOptions {
  /** Отключить обработчик: функция за флагом, экран не активен, выбранного сообщения нет. */
  isDisabled?: boolean;
}

/**
 * Подписывает обработчик на стандартное сочетание из реестра (SHORTCUTS.md), пока компонент
 * смонтирован и окно в фокусе. Область действия (в поле ввода, вне его, везде) берётся из реестра;
 * активность самого экрана (лента в фокусе, сообщение выбрано, идёт звонок) задаёт вызывающий
 * через `isDisabled`. Сочетания с Esc подписываются через `useEscapeLayer`.
 */
export function useShortcut(
  id: ShortcutId,
  handler: Handler,
  { isDisabled = false }: UseShortcutOptions = {},
): void {
  const latestHandler = useRef(handler);
  useEffect(() => {
    latestHandler.current = handler;
  });

  useEffect(() => {
    if (isDisabled) return;
    if (shortcutDefinition(id).viaEscape) {
      throw new Error(`«${id}» обрабатывается по порядку Esc: используй useEscapeLayer`);
    }
    counter += 1;
    return register(id, { order: counter, handler: (event) => latestHandler.current(event) });
  }, [id, isDisabled]);
}
