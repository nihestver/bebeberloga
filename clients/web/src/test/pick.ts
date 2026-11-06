// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

/** Элемент списка по номеру; падает с понятной ошибкой, если его нет. */
export function pick<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`в списке из ${items.length} нет элемента с номером ${index}`);
  }
  return item;
}
