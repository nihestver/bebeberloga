// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import axe from "axe-core";

/**
 * Запускает axe-core (тот же движок, что у @storybook/addon-a11y) и возвращает нарушения уровня
 * serious и critical. Контраст в jsdom не вычисляется (нет раскладки и каскада), поэтому правило
 * color-contrast выключено: контраст пар токенов проверяет tokens.test.ts.
 */
export async function seriousViolations(root: Element): Promise<string[]> {
  const results = await axe.run(root, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join("; ");
      return `${violation.id} (${violation.impact ?? "?"}): ${violation.help} — ${targets}`;
    });
}
