// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { ReactNode } from "react";
import { Button as AriaButton, ToggleButton } from "react-aria-components";
import { Icon, type IconComponent } from "../icons/Icon";
import { icons } from "../icons/icons";
import { PopoverMenu, type PopoverMenuProps } from "../Menu/Menu";
import { useUiStrings } from "../strings/UiProvider";
import { Tooltip } from "../Tooltip/Tooltip";
import { cx } from "../utils/cx";
import styles from "./Button.module.css";

export interface SplitButtonProps {
  icon: IconComponent;
  /** Иконка включённого состояния (перечёркнутый микрофон). */
  selectedIcon?: IconComponent;
  /** Подпись и подсказка переключателя; меняй её вместе с состоянием. */
  label: string;
  isSelected?: boolean;
  onChange?: (isSelected: boolean) => void;
  /** Смысл включённого состояния, как у `Button/IconToggle`. */
  tone?: "danger" | "positive";
  /** Подпись кнопки-стрелки; по умолчанию «Другие варианты». */
  menuLabel?: string;
  /** Пункты меню под стрелкой (`MenuItem`, `MenuSection`). */
  menu: ReactNode;
  /** Содержимое над пунктами меню: слайдер громкости, `LevelMeter`. */
  menuHeader?: ReactNode;
  menuPlacement?: PopoverMenuProps["placement"];
  isDisabled?: boolean;
  className?: string;
}

/**
 * `Button/Split`: кнопка-переключатель и узкая кнопка-стрелка справа в общей капсуле; стрелка
 * открывает `Menu/Popover` (микрофон ˅, камера ˅, стрим ˅ в панели управления звонком).
 */
export function SplitButton({
  icon,
  selectedIcon,
  label,
  isSelected,
  onChange,
  tone = "positive",
  menuLabel,
  menu,
  menuHeader,
  menuPlacement = "top",
  isDisabled,
  className,
}: SplitButtonProps) {
  const strings = useUiStrings();
  const arrowLabel = menuLabel ?? strings.button.splitMenu;
  return (
    <div className={cx(styles.split, className)}>
      <Tooltip content={label}>
        <ToggleButton
          aria-label={label}
          isSelected={isSelected}
          onChange={onChange}
          isDisabled={isDisabled}
          className={styles.iconButton}
          data-tone={tone}
        >
          {({ isSelected: selected }) => (
            <Icon icon={selected && selectedIcon ? selectedIcon : icon} size={20} />
          )}
        </ToggleButton>
      </Tooltip>
      <PopoverMenu
        placement={menuPlacement}
        header={menuHeader}
        trigger={
          <AriaButton aria-label={arrowLabel} isDisabled={isDisabled} className={styles.splitArrow}>
            <Icon icon={icons.chevronDown} size={14} />
          </AriaButton>
        }
      >
        {menu}
      </PopoverMenu>
    </div>
  );
}
