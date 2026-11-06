// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ComponentType, SVGAttributes } from "react";

/** Свойства, которые понимают и иконки библиотеки (ADR-0023), и собственные из design/icons. */
export interface IconGlyphProps extends SVGAttributes<SVGSVGElement> {
  size?: number | string;
  nonScalingStroke?: boolean;
}

export type IconComponent = ComponentType<IconGlyphProps>;

export interface IconProps {
  /** Иконка из `icons` (см. icons.ts). */
  icon: IconComponent;
  /** Размер в px; по умолчанию 20 (COMPONENTS §7). */
  size?: number;
  /** Подпись для экранного диктора. Без неё иконка декоративная и скрыта от него. */
  label?: string;
  className?: string;
}

/** Толщина линии иконок интерфейса, px (COMPONENTS §7). */
export const ICON_STROKE = 1.75;

/** Линейная иконка: 20 px, толщина 1.75, скруглённые концы, цвет текста. */
export function Icon({ icon: Glyph, size = 20, label, className }: IconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <Glyph
      size={size}
      strokeWidth={ICON_STROKE}
      nonScalingStroke
      focusable={false}
      className={className}
      style={{ flex: "none" }}
      {...a11y}
    />
  );
}
