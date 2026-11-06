// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Проверка доступности каждой истории Storybook движком axe-core (тот же, что у addon-a11y):
// нарушений уровня serious и critical быть не должно. Контраст цветов в jsdom не считается —
// его проверяет tokens.test.ts по парам токенов.

import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import preview from "../../../.storybook/preview";
import { seriousViolations } from "../../test/axe";

setProjectAnnotations([preview]);

const modules = import.meta.glob<Record<string, unknown>>("../**/*.stories.tsx", { eager: true });

const cases: { title: string; name: string; Story: React.ComponentType }[] = [];
for (const [path, module] of Object.entries(modules)) {
  const meta = module.default as { title?: string } | undefined;
  const title = meta?.title ?? path;
  const stories = composeStories(module as Parameters<typeof composeStories>[0]);
  for (const [name, Story] of Object.entries(stories)) {
    cases.push({ title, name, Story: Story as React.ComponentType });
  }
}

describe("доступность историй (axe, serious и critical)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("каталог собран: историй не меньше, чем компонентов в COMPONENTS.md", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });

  it.each(cases.map((story) => [`${story.title} › ${story.name}`, story] as const))(
    "%s",
    async (_label, { Story }) => {
      // В jsdom нет камеры: сканер QR сам переходит в состояние «камера не найдена».
      // jsdom не рисует на холсте; сканеру QR достаточно пустого контекста.
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      render(<Story />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Всплывающие элементы рисуются в портале: проверяется вся страница.
      expect(await seriousViolations(document.body)).toEqual([]);
      vi.restoreAllMocks();
    },
    15_000,
  );
});
