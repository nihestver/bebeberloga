// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { CSSProperties } from "react";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Avatar.module.css";
import { AVATAR_TONES, builtinAvatarMarkup, defaultAvatarTone } from "./builtin";

/** Размеры из COMPONENTS §5: от 16 (упоминание) до 120 (полный профиль). */
export const AVATAR_SIZES = [16, 20, 24, 32, 40, 48, 80, 96, 120] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarStatus = "online" | "away" | "dnd" | "offline";

export interface AvatarProps {
  /** Имя пользователя: подпись для экранного диктора. */
  name: string;
  size?: AvatarSize;
  /** Id встроенного аватара (`User.avatar_id`). Неизвестный id показывается запасным. */
  avatarId?: string;
  /** Своя картинка (S, FEATURES 3.1); если задана, встроенный аватар не рисуется. */
  src?: string;
  /** Тон фона, 1…10 (`--color-swatch-N`); по умолчанию закреплён за аватаром. */
  tone?: number;
  /** `Avatar/Status`: точка статуса в правом нижнем углу. */
  status?: AvatarStatus;
  /** `Avatar/Speaking`: кольцо 2 px Шалфеем, пока участник говорит. */
  isSpeaking?: boolean;
  /** `Avatar/Typing`: вместо точки статуса — капсула с тремя точками. */
  isTyping?: boolean;
  /** Аватар стоит рядом с именем и для экранного диктора лишний. */
  isDecorative?: boolean;
  className?: string;
}

/**
 * `Avatar`: круг с картинкой или встроенным значком цвета Хвои на цветном фоне. Статус передан не
 * только цветом — у точки разная форма (COMPONENTS §8) — и текстом для экранного диктора.
 */
export function Avatar({
  name,
  size = 40,
  avatarId,
  src,
  tone,
  status,
  isSpeaking,
  isTyping,
  isDecorative,
  className,
}: AvatarProps) {
  const strings = useUiStrings();
  const swatch = Math.min(
    AVATAR_TONES,
    Math.max(1, Math.round(tone ?? defaultAvatarTone(avatarId))),
  );
  const label = [
    name,
    isSpeaking && strings.status.speaking,
    isTyping ? strings.status.typing : status && strings.status[status],
  ]
    .filter(Boolean)
    .join(", ");
  const style = { "--avatar-size": `${size}px` } as CSSProperties;

  return (
    <span
      role={isDecorative ? undefined : "img"}
      aria-label={isDecorative ? undefined : label}
      aria-hidden={isDecorative || undefined}
      className={cx(styles.avatar, className)}
      data-speaking={isSpeaking || undefined}
      style={style}
    >
      {src ? (
        <img src={src} alt="" className={styles.image} draggable={false} />
      ) : (
        <span
          className={styles.glyph}
          data-tone={swatch}
          // Разметка — собственный статический файл design/avatars, не пользовательский ввод.
          dangerouslySetInnerHTML={{ __html: builtinAvatarMarkup(avatarId) }}
        />
      )}
      {isTyping ? (
        <span className={styles.typing} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        status && <span className={styles.status} data-status={status} aria-hidden="true" />
      )}
    </span>
  );
}

export const COMMUNITY_ICON_SIZES = [16, 40, 64, 80] as const;
export type CommunityIconSize = (typeof COMMUNITY_ICON_SIZES)[number];

/** Инициалы сообщества: первые буквы первых двух слов названия. */
export function communityInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

export interface CommunityIconProps {
  /** Название сервера: из него берутся инициалы и подпись для экранного диктора. */
  name: string;
  size?: CommunityIconSize;
  /** Картинка сервера; без неё показываются инициалы на нейтральном фоне. */
  src?: string;
  isDecorative?: boolean;
  className?: string;
}

/** `CommunityIcon`: скруглённый квадрат (радиус 30 % стороны) с картинкой или инициалами. */
export function CommunityIcon({
  name,
  size = 40,
  src,
  isDecorative,
  className,
}: CommunityIconProps) {
  const style = { "--avatar-size": `${size}px` } as CSSProperties;
  return (
    <span
      role={isDecorative ? undefined : "img"}
      aria-label={isDecorative ? undefined : name}
      aria-hidden={isDecorative || undefined}
      className={cx(styles.community, className)}
      style={style}
    >
      {src ? (
        <img src={src} alt="" className={styles.image} draggable={false} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {communityInitials(name)}
        </span>
      )}
    </span>
  );
}
