// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Button } from "../Button/Button";
import { Icon, type IconComponent } from "../icons/Icon";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Banner.module.css";

export interface BannerProps {
  children: ReactNode;
  /**
   * `neutral` — Панель («Этот канал скрыт»); `info` — Иней; `warning` — Морошка; `danger` —
   * Брусника («Медведь споткнулся. Переподключаемся…»).
   */
  tone?: "neutral" | "info" | "warning" | "danger";
  icon?: IconComponent;
  /** Подпись кнопки справа: «Показать». */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * `Banner`: полоса на всю ширину области под шапкой с текстом и кнопкой справа. На цветной
 * заливке текст цвета Хвои (BRAND).
 */
export function Banner({
  children,
  tone = "neutral",
  icon,
  actionLabel,
  onAction,
  className,
}: BannerProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(styles.banner, className)}
      data-tone={tone}
    >
      {icon && <Icon icon={icon} size={18} />}
      <span className={styles.text}>{children}</span>
      {actionLabel && (
        <AriaButton onPress={onAction} className={styles.action}>
          {actionLabel}
        </AriaButton>
      )}
    </div>
  );
}

/** Сколько плашка «краснеет» после попытки уйти с несохранёнными изменениями, мс. */
export const SAVE_BAR_ALERT_MS = 1000;

export interface SaveBarProps {
  /** Есть несохранённые изменения: плашка всплывает. */
  isVisible: boolean;
  onSave: () => void;
  onReset: () => void;
  /** Сохранение идёт: кнопка показывает спиннер. */
  isSaving?: boolean;
  /** Свой текст; по умолчанию «Есть несохранённые изменения». */
  message?: ReactNode;
  /**
   * Счётчик попыток уйти со страницы. Каждое увеличение заставляет плашку вздрогнуть и покраснеть
   * на 1 с (при `prefers-reduced-motion` — только покраснеть).
   */
  attention?: number;
  className?: string;
}

/**
 * `SaveBar`: плашка внизу контента настроек при несохранённых изменениях — текст, `Button/Link`
 * «Сбросить» и `Button/Primary` «Сохранить».
 */
export function SaveBar({
  isVisible,
  onSave,
  onReset,
  isSaving,
  message,
  attention = 0,
  className,
}: SaveBarProps) {
  const strings = useUiStrings();
  const [isAlerting, setAlerting] = useState(false);
  const seen = useRef(attention);

  useEffect(() => {
    if (attention === seen.current) return;
    seen.current = attention;
    setAlerting(true);
    const timer = setTimeout(() => setAlerting(false), SAVE_BAR_ALERT_MS);
    return () => clearTimeout(timer);
  }, [attention]);

  if (!isVisible) return null;
  return (
    <div
      role="status"
      className={cx(styles.saveBar, className)}
      data-alert={isAlerting || undefined}
      // Смена ключа перезапускает анимацию при повторной попытке уйти.
      key={isAlerting ? attention : "idle"}
    >
      <span className={styles.text}>{message ?? strings.saveBar.message}</span>
      <Button variant="link" onPress={onReset} isDisabled={isSaving}>
        {strings.common.reset}
      </Button>
      <Button size="s" onPress={onSave} isPending={isSaving}>
        {strings.common.save}
      </Button>
    </div>
  );
}
