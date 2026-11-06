// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Встроенные аватары (FEATURES 3.1): собственные SVG из design/avatars/ — общие для всех клиентов,
// в web-клиент попадают при сборке. Рисунок одноцветный (currentColor): цвет значка и фон задаёт
// компонент Avatar из токенов.

const sources = import.meta.glob<string>("@design/avatars/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const markup = new Map<string, string>();
for (const [path, svg] of Object.entries(sources)) {
  markup.set(path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, ""), svg);
}

/**
 * Id встроенных аватаров в порядке показа: сначала звери, потом предметы берлоги. Список —
 * контракт между клиентами (`User.avatar_id`, docs/protocol/AVATARS.md): id не переименовываются и
 * не удаляются, новые добавляются в конец своей группы.
 */
export const builtinAvatarIds = [
  // звери
  "bear",
  "fox",
  "hare",
  "owl",
  "hedgehog",
  "squirrel",
  "wolf",
  "moose",
  "badger",
  "mouse",
  "beaver",
  "lynx",
  "frog",
  "bee",
  "snail",
  "bird",
  // предметы берлоги
  "teapot",
  "mug",
  "honey",
  "lantern",
  "cone",
  "mushroom",
  "acorn",
  "leaf",
  "campfire",
  "berry",
  "spruce",
  "mitten",
  "pillow",
  "candle",
] as const;

export type BuiltinAvatarId = (typeof builtinAvatarIds)[number];

/** Аватар для неизвестного id (профиль из более новой версии клиента). */
export const FALLBACK_AVATAR_ID: BuiltinAvatarId = "bear";

/** Число фоновых тонов аватара: первый ряд образцов `--color-swatch-1…10`. */
export const AVATAR_TONES = 10;

export function isBuiltinAvatarId(id: string | undefined): id is BuiltinAvatarId {
  return id !== undefined && (builtinAvatarIds as readonly string[]).includes(id);
}

/** Имена файлов design/avatars/*.svg без расширения — для сверки со списком id. */
export function builtinAvatarFiles(): string[] {
  return [...markup.keys()].sort();
}

/** SVG-разметка аватара; для неизвестного id — запасной. */
export function builtinAvatarMarkup(id: string | undefined): string {
  const known = isBuiltinAvatarId(id) ? id : FALLBACK_AVATAR_ID;
  return markup.get(known) ?? "";
}

/**
 * Тон фона по умолчанию (1…10): закреплён за аватаром, поэтому один и тот же аватар выглядит
 * одинаково у всех. Правило выбора фона в спецификации не задано (OPEN-QUESTIONS).
 */
export function defaultAvatarTone(id: string | undefined): number {
  const index = isBuiltinAvatarId(id) ? builtinAvatarIds.indexOf(id) : 0;
  return (index % AVATAR_TONES) + 1;
}
