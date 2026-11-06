// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { Meta, StoryObj } from "@storybook/react-vite";
import { shortcutGroups, shortcutIds, shortcuts } from "../shortcuts/registry";
import { State, States } from "../stories/States";
import { useUiStrings } from "../strings/UiProvider";
import { Kbd, KeyComboView, ShortcutKeys } from "./Kbd";

const meta: Meta = { title: "Kbd" };
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <States>
      <State label="Одна клавиша">
        <Kbd>Esc</Kbd>
      </State>
      <State label="Сочетание, Windows и Linux">
        <KeyComboView combo={{ mod: true, shift: true, code: "KeyM" }} platform="other" />
      </State>
      <State label="Сочетание, macOS">
        <KeyComboView combo={{ mod: true, shift: true, code: "KeyM" }} platform="mac" />
      </State>
      <State label="Из реестра">
        <ShortcutKeys id="nav.quickSwitcher" platform="other" />
      </State>
    </States>
  ),
};

function ShortcutList() {
  const strings = useUiStrings();
  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(3, 320px)" }}>
      {shortcutGroups.map((group) => (
        <section key={group}>
          <h3 style={{ margin: "0 0 8px" }}>{strings.shortcuts.groups[group]}</h3>
          <dl style={{ display: "grid", gap: 6, margin: 0 }}>
            {shortcutIds
              .filter((id) => shortcuts[id].group === group && shortcuts[id].combos.length > 0)
              .map((id) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <dt>{strings.shortcuts.actions[id]}</dt>
                  <dd style={{ margin: 0 }}>
                    <ShortcutKeys id={id} platform="other" />
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Все стандартные сочетания из реестра — содержимое окна «Сочетания клавиш» (SCREENS/10 §5.2). */
export const Registry: Story = {
  parameters: { layout: "padded" },
  render: () => <ShortcutList />,
};
