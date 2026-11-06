// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button as AriaButton } from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./MiniPlayer.module.css";

export type MiniPlayerCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Отступ от краёв основной области, px (COMPONENTS §4). */
export const MINI_PLAYER_INSET = 16;

/** Ближайший угол области к точке (центру карточки после перетаскивания). */
export function nearestCorner(
  point: { x: number; y: number },
  area: { width: number; height: number },
): MiniPlayerCorner {
  const vertical = point.y < area.height / 2 ? "top" : "bottom";
  const horizontal = point.x < area.width / 2 ? "left" : "right";
  return `${vertical}-${horizontal}`;
}

/** Угол, в который карточка переходит по стрелке; у края остаётся на месте. */
export function moveCorner(corner: MiniPlayerCorner, key: string): MiniPlayerCorner {
  const [vertical, horizontal] = corner.split("-") as ["top" | "bottom", "left" | "right"];
  switch (key) {
    case "ArrowUp":
      return `top-${horizontal}`;
    case "ArrowDown":
      return `bottom-${horizontal}`;
    case "ArrowLeft":
      return `${vertical}-left`;
    case "ArrowRight":
      return `${vertical}-right`;
    default:
      return corner;
  }
}

export interface MiniPlayerProps {
  /** Название канала в шапке: «← название канала». */
  title: ReactNode;
  /** Клик по шапке возвращает на экран звонка. */
  onReturn: () => void;
  /** Кадр стрима (видео) или надпись «Ваш стрим идёт». */
  children: ReactNode;
  /** Имя слева внизу. */
  caption?: ReactNode;
  /** Кнопки справа внизу: «Настройки стрима», «Остановить». */
  actions?: ReactNode;
  corner?: MiniPlayerCorner;
  defaultCorner?: MiniPlayerCorner;
  onCornerChange?: (corner: MiniPlayerCorner) => void;
  className?: string;
}

/**
 * `MiniPlayer`: плавающая карточка 320×180 в основной области. Перетаскивается за шапку; после
 * отпускания прилипает к ближайшему из четырёх углов области с отступом 16. С клавиатуры угол
 * меняют стрелки на ручке переноса. Родитель должен быть позиционирован (`position: relative`).
 */
export function MiniPlayer({
  title,
  onReturn,
  children,
  caption,
  actions,
  corner: controlled,
  defaultCorner = "bottom-right",
  onCornerChange,
  className,
}: MiniPlayerProps) {
  const strings = useUiStrings();
  const card = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(defaultCorner);
  const corner = controlled ?? inner;
  const [drag, setDrag] = useState<{ startX: number; startY: number; dx: number; dy: number }>();

  const setCorner = (next: MiniPlayerCorner) => {
    if (next === corner) return;
    setInner(next);
    onCornerChange?.(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ ...drag, dx: event.clientX - drag.startX, dy: event.clientY - drag.startY });
  };

  const onPointerUp = () => {
    const area = card.current?.offsetParent;
    if (drag && card.current && area) {
      const cardRect = card.current.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      setCorner(
        nearestCorner(
          {
            x: cardRect.left + cardRect.width / 2 - areaRect.left,
            y: cardRect.top + cardRect.height / 2 - areaRect.top,
          },
          areaRect,
        ),
      );
    }
    setDrag(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = moveCorner(corner, event.key);
    if (next !== corner) {
      event.preventDefault();
      setCorner(next);
    }
  };

  return (
    <div
      ref={card}
      role="group"
      aria-label={strings.miniPlayer.label}
      className={cx(styles.player, className)}
      data-corner={corner}
      data-dragging={drag ? true : undefined}
      style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
    >
      <div
        className={styles.header}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <AriaButton onPress={onReturn} className={styles.back}>
          <Icon icon={icons.arrowLeft} size={16} />
          <span className={styles.title}>{title}</span>
        </AriaButton>
        <div
          role="button"
          tabIndex={0}
          aria-label={strings.miniPlayer.move}
          aria-roledescription={strings.miniPlayer.label}
          className={styles.grip}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.frame}>{children}</div>
      {(caption ?? actions) && (
        <div className={styles.footer}>
          <span className={styles.caption}>{caption}</span>
          {actions && <span className={styles.actions}>{actions}</span>}
        </div>
      )}
    </div>
  );
}
