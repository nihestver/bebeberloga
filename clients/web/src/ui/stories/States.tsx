// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Вспомогательные компоненты для историй Storybook: показывают состояния из COMPONENTS.md
// (обычное, наведение, нажатие, фокус, неактивное, загрузка, ошибка) рядом, без действий мышью.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./States.module.css";

/** Состояния, которые примитивы доступности выставляют data-атрибутами. */
export type ForcedState = "hovered" | "pressed" | "focused" | "focus-visible";

export interface ForcedProps {
  state: ForcedState | ForcedState[];
  /** Какой элемент пометить; по умолчанию — первый элемент примитива внутри. */
  selector?: string;
  children: ReactNode;
}

/**
 * Показывает компонент в заданном состоянии: ставит data-атрибут, которым примитив отмечает
 * наведение, нажатие или фокус. Стили компонентов привязаны именно к этим атрибутам, поэтому
 * картинка совпадает с настоящим состоянием.
 */
export function Forced({ state, selector = "[data-rac]", children }: ForcedProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const states = (Array.isArray(state) ? state : [state]).join(" ");

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const names = states.split(" ").map((name) => `data-${name}`);
    const apply = () => {
      const target = root.querySelector(selector);
      if (!target) return;
      for (const name of names) {
        if (target.getAttribute(name) !== "true") target.setAttribute(name, "true");
      }
    };
    apply();
    // Примитив снимает атрибут, когда настоящий указатель уходит с элемента, — возвращаем его.
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, subtree: true, childList: true });
    return () => observer.disconnect();
  }, [states, selector]);

  return (
    <span ref={ref} className={styles.forced}>
      {children}
    </span>
  );
}

/** Сетка состояний с подписями. */
export function States({ children, columns }: { children: ReactNode; columns?: number }) {
  return (
    <div
      className={styles.states}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, max-content)` } : undefined}
    >
      {children}
    </div>
  );
}

export function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className={styles.state}>
      <div className={styles.sample}>{children}</div>
      <figcaption className={styles.caption}>{label}</figcaption>
    </figure>
  );
}

export interface InteractionStatesProps {
  /** Рисует компонент; `extra` — свойства состояния (`isDisabled`, `isPending`). */
  render: (extra: { isDisabled?: boolean; isPending?: boolean }) => ReactNode;
  /** Показать состояние «загрузка». */
  pending?: boolean;
  /** Элемент, который получает состояния наведения, нажатия и фокуса. */
  selector?: string;
}

/** Стандартный ряд состояний кнопки или поля из COMPONENTS §2. */
export function InteractionStates({ render, pending, selector }: InteractionStatesProps) {
  return (
    <States>
      <State label="Обычное">{render({})}</State>
      <State label="Наведение">
        <Forced state="hovered" selector={selector}>
          {render({})}
        </Forced>
      </State>
      <State label="Нажатие">
        <Forced state={["hovered", "pressed"]} selector={selector}>
          {render({})}
        </Forced>
      </State>
      <State label="Фокус">
        <Forced state={["focused", "focus-visible"]} selector={selector}>
          {render({})}
        </Forced>
      </State>
      <State label="Неактивное">{render({ isDisabled: true })}</State>
      {pending && <State label="Загрузка">{render({ isPending: true })}</State>}
    </States>
  );
}

/** Вертикальная стопка примеров с общим отступом. */
export function Stack({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
  return (
    <div className={styles.stack} style={{ gap }}>
      {children}
    </div>
  );
}

/** Поверхность цвета Панели: показывает компонент так, как он выглядит на карточке. */
export function Surface({ children, width }: { children: ReactNode; width?: number }) {
  return (
    <div className={styles.surface} style={width ? { width } : undefined}>
      {children}
    </div>
  );
}
