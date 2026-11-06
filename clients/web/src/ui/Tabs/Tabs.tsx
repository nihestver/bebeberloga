// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useRef, type ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from "react-aria-components";
import { cx } from "../utils/cx";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Содержимое вкладки. Панель рисуется всегда: вкладка ссылается на неё для экранного диктора. */
  content?: ReactNode;
  /** Бейдж справа от названия (число запросов в друзья). */
  badge?: ReactNode;
  isDisabled?: boolean;
}

export interface TabsProps {
  /** Название набора вкладок для экранного диктора. */
  "aria-label": string;
  items: readonly TabItem[];
  selectedId?: string;
  defaultSelectedId?: string;
  onChange?: (id: string) => void;
  className?: string;
}

/**
 * `Tabs`: текстовые вкладки в ряд; активная — текст Туманом и подчёркивание 2 px Шалфеем,
 * неактивные — Лишайник. Стрелки ←→ переключают вкладки, Home и End ведут к крайним.
 */
export function Tabs({
  items,
  selectedId,
  defaultSelectedId,
  onChange,
  className,
  "aria-label": ariaLabel,
}: TabsProps) {
  // Примитив сообщает и о первой вкладке, выбранной при появлении; наружу идут только смены.
  const current = useRef(
    selectedId ?? defaultSelectedId ?? items.find((item) => !item.isDisabled)?.id,
  );
  return (
    <AriaTabs
      selectedKey={selectedId}
      defaultSelectedKey={defaultSelectedId}
      onSelectionChange={(key) => {
        const next = String(key);
        if (next === current.current) return;
        current.current = next;
        onChange?.(next);
      }}
      className={cx(styles.tabs, className)}
    >
      <TabList aria-label={ariaLabel} className={styles.list}>
        {items.map((item) => (
          <Tab key={item.id} id={item.id} isDisabled={item.isDisabled} className={styles.tab}>
            {item.label}
            {item.badge}
          </Tab>
        ))}
      </TabList>
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id} className={styles.panel}>
          {item.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
