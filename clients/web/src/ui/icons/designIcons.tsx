// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { SVGAttributes } from "react";
import type { IconComponent, IconGlyphProps } from "./Icon";

// Собственные иконки проекта лежат в design/icons/ (общие для всех клиентов) и попадают в клиент
// при сборке. Формат тот же, что у библиотеки иконок: сетка 24, линия currentColor, скруглённые
// концы — поэтому обёртка Icon рисует их одинаково.
const sources = import.meta.glob<string>("@design/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const GRID = 24;

function innerMarkup(svg: string): string {
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  const close = svg.lastIndexOf("</svg>");
  return open === -1 || close === -1 ? "" : svg.slice(open + 1, close).trim();
}

function createDesignIcon(markup: string): IconComponent {
  function DesignIcon({ size = GRID, strokeWidth = 2, nonScalingStroke, ...rest }: IconGlyphProps) {
    const pixels = Number(size) || GRID;
    // nonScalingStroke: толщина линии задана в пикселях экрана, а не в единицах сетки.
    const stroke = nonScalingStroke ? (Number(strokeWidth) * GRID) / pixels : strokeWidth;
    const attributes: SVGAttributes<SVGSVGElement> = {
      width: pixels,
      height: pixels,
      viewBox: `0 0 ${GRID} ${GRID}`,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: stroke,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    };
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        {...attributes}
        {...rest}
        // Разметка — собственный статический файл из репозитория, не пользовательский ввод.
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }
  return DesignIcon;
}

const byName = new Map<string, IconComponent>();
for (const [path, svg] of Object.entries(sources)) {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, "");
  byName.set(name, createDesignIcon(innerMarkup(svg)));
}

/** Имена собственных иконок — имена файлов design/icons/*.svg без расширения. */
export const designIconNames: readonly string[] = [...byName.keys()].sort();

export function designIcon(name: string): IconComponent {
  const icon = byName.get(name);
  if (!icon) throw new Error(`нет иконки design/icons/${name}.svg`);
  return icon;
}
