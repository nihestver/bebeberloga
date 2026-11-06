// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import swatchTokens from "@design/tokens/swatches.json";
import { useId, useState, type ReactNode } from "react";
import {
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  ColorThumb,
  Dialog,
  DialogTrigger,
  Input,
  Popover,
  SliderTrack,
} from "react-aria-components";
import { IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import fieldStyles from "../Input/Input.module.css";
import { EscLayer, useEscapeLayer } from "../shortcuts/escape";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./ColorSwatches.module.css";

/**
 * Образцы по умолчанию — 20 производных палитры бренда из design/tokens/swatches.json, в порядке
 * сетки 2×10. Значения читаются из токенов: в коде компонентов записей цвета нет.
 */
export const defaultSwatches: readonly string[] = Object.entries(swatchTokens.color.swatch)
  .flatMap(([index, token]) =>
    typeof token === "object" ? [{ index: Number(index), color: token.$value }] : [],
  )
  .sort((a, b) => a.index - b.index)
  .map((swatch) => swatch.color);

export interface ColorSwatchesProps {
  /** Подпись над блоком. Без неё нужен `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  /** Текущий цвет в записи CSS (`#RRGGBB`). */
  value: string;
  /** Выбранный цвет в записи `#RRGGBB`. */
  onChange: (color: string) => void;
  /** Свой набор образцов; по умолчанию — 20 образцов из токенов. */
  swatches?: readonly string[];
  /** Показывать кнопку-пипетку для своего цвета. */
  allowCustom?: boolean;
  isDisabled?: boolean;
  className?: string;
}

/**
 * `ColorSwatches`: квадрат «текущий цвет» 48×40, рядом кнопка-пипетка (свой цвет) и сетка 2×10
 * круглых образцов 20 px.
 */
export function ColorSwatches({
  label,
  value,
  onChange,
  swatches = defaultSwatches,
  allowCustom = true,
  isDisabled,
  className,
  "aria-label": ariaLabel,
}: ColorSwatchesProps) {
  const strings = useUiStrings();
  const labelId = useId();
  const [isPickerOpen, setPickerOpen] = useState(false);
  useEscapeLayer(EscLayer.menu, () => setPickerOpen(false), isPickerOpen);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      className={cx(fieldStyles.field, className)}
    >
      {label && (
        <span id={labelId} className={fieldStyles.label}>
          {label}
        </span>
      )}
      <div className={styles.row} data-disabled={isDisabled || undefined}>
        <ColorSwatch
          color={value}
          aria-label={strings.colorSwatches.current}
          className={styles.current}
        />
        {allowCustom && (
          <DialogTrigger isOpen={isPickerOpen} onOpenChange={setPickerOpen}>
            <IconButton
              icon={icons.pipette}
              label={strings.colorSwatches.custom}
              isDisabled={isDisabled}
            />
            <Popover placement="bottom start" offset={8} className={styles.popover}>
              <Dialog aria-label={strings.colorSwatches.custom} className={styles.dialog}>
                <ColorPicker value={value} onChange={(color) => onChange(color.toString("hex"))}>
                  <ColorArea
                    colorSpace="hsb"
                    xChannel="saturation"
                    yChannel="brightness"
                    aria-label={strings.colorSwatches.area}
                    className={styles.area}
                  >
                    <ColorThumb className={styles.thumb} />
                  </ColorArea>
                  <ColorSlider
                    colorSpace="hsb"
                    channel="hue"
                    aria-label={strings.colorSwatches.hue}
                    className={styles.hue}
                  >
                    <SliderTrack className={styles.hueTrack}>
                      <ColorThumb className={styles.thumb} />
                    </SliderTrack>
                  </ColorSlider>
                  <ColorField aria-label={strings.colorSwatches.hex} className={styles.hexField}>
                    <Input className={styles.hexInput} />
                  </ColorField>
                </ColorPicker>
              </Dialog>
            </Popover>
          </DialogTrigger>
        )}
        <ColorSwatchPicker
          aria-label={strings.colorSwatches.samples}
          value={value}
          onChange={(color) => onChange(color.toString("hex"))}
          className={styles.grid}
        >
          {swatches.map((color) => (
            <ColorSwatchPickerItem
              key={color}
              color={color}
              isDisabled={isDisabled}
              className={styles.item}
            >
              <ColorSwatch className={styles.dot} />
            </ColorSwatchPickerItem>
          ))}
        </ColorSwatchPicker>
      </div>
    </div>
  );
}
