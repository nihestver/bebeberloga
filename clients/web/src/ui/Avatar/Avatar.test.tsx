// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Avatar, CommunityIcon, Badge/Count, Badge/Pill, Badge/Live, UnreadPip, E2EEBadge.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CountBadge,
  E2EEBadge,
  formatCount,
  LiveBadge,
  PillBadge,
  UnreadPip,
} from "../Badge/Badge";
import { UiProvider } from "../strings/UiProvider";
import { Avatar, CommunityIcon, communityInitials } from "./Avatar";
import {
  builtinAvatarFiles,
  builtinAvatarIds,
  builtinAvatarMarkup,
  defaultAvatarTone,
  FALLBACK_AVATAR_ID,
} from "./builtin";

describe("встроенные аватары", () => {
  it("список id совпадает с файлами design/avatars; их около 30", () => {
    expect([...builtinAvatarIds].sort()).toEqual(builtinAvatarFiles());
    expect(new Set(builtinAvatarIds).size).toBe(builtinAvatarIds.length);
    expect(builtinAvatarIds.length).toBeGreaterThanOrEqual(28);
    expect(builtinAvatarIds.length).toBeLessThanOrEqual(32);
  });

  it("каждый значок одноцветный: рисуется цветом currentColor, без своих цветов", () => {
    for (const id of builtinAvatarIds) {
      const svg = builtinAvatarMarkup(id);
      expect(svg, id).toContain('fill="currentColor"');
      expect(svg, id).toContain('viewBox="0 0 48 48"');
      expect(svg, id).not.toMatch(
        /(fill|stroke)="(?!currentColor|none)[^"]+"|style=|<script|href=/,
      );
    }
  });

  it("неизвестный id показывается запасным аватаром; тон фона закреплён за аватаром", () => {
    expect(builtinAvatarMarkup("из-будущей-версии")).toBe(builtinAvatarMarkup(FALLBACK_AVATAR_ID));
    expect(builtinAvatarMarkup(undefined)).toBe(builtinAvatarMarkup(FALLBACK_AVATAR_ID));
    expect(defaultAvatarTone("bear")).toBe(1);
    expect(defaultAvatarTone("fox")).toBe(2);
    expect(defaultAvatarTone("beaver")).toBe(1);
    for (const id of builtinAvatarIds) {
      expect(defaultAvatarTone(id)).toBeGreaterThanOrEqual(1);
      expect(defaultAvatarTone(id)).toBeLessThanOrEqual(10);
    }
  });
});

describe("Avatar", () => {
  it("называет пользователя и его статус текстом, а не только цветом", () => {
    render(<Avatar name="Миша" avatarId="bear" status="dnd" />);
    expect(screen.getByRole("img", { name: "Миша, Не беспокоить" })).toBeInTheDocument();
  });

  it("сообщает, что участник говорит и печатает", () => {
    render(<Avatar name="Лиса" avatarId="fox" status="online" isSpeaking isTyping />);
    const avatar = screen.getByRole("img", { name: "Лиса, Говорит, Печатает" });
    expect(avatar).toHaveAttribute("data-speaking", "true");
    // Капсула «печатает» заменяет точку статуса.
    expect(avatar.querySelector(".typing")).not.toBeNull();
    expect(avatar.querySelector(".status")).toBeNull();
  });

  it("у каждого статуса своя форма точки", () => {
    const { container } = render(
      <>
        <Avatar name="а" status="online" />
        <Avatar name="б" status="away" />
        <Avatar name="в" status="dnd" />
        <Avatar name="г" status="offline" />
      </>,
    );
    const shapes = [...container.querySelectorAll(".status")].map((dot) =>
      dot.getAttribute("data-status"),
    );
    expect(shapes).toEqual(["online", "away", "dnd", "offline"]);
  });

  it("размер и тон фона задаются свойствами; своя картинка заменяет значок", () => {
    const { container, rerender } = render(
      <Avatar name="Ёж" avatarId="hedgehog" size={96} tone={7} />,
    );
    const avatar = screen.getByRole("img", { name: "Ёж" });
    expect(avatar.style.getPropertyValue("--avatar-size")).toBe("96px");
    expect(container.querySelector(".glyph")).toHaveAttribute("data-tone", "7");
    expect(container.querySelector(".glyph svg")).not.toBeNull();

    rerender(<Avatar name="Ёж" src="/avatars/hedgehog.png" />);
    expect(container.querySelector(".glyph")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", "/avatars/hedgehog.png");
  });

  it("декоративный аватар скрыт от экранного диктора", () => {
    const { container } = render(<Avatar name="Миша" isDecorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("подписи статуса переводятся", () => {
    render(
      <UiProvider locale="en">
        <Avatar name="Misha" status="online" />
      </UiProvider>,
    );
    expect(screen.getByRole("img", { name: "Misha, Online" })).toBeInTheDocument();
  });
});

describe("CommunityIcon", () => {
  it.each([
    ["Тихая берлога", "ТБ"],
    ["настолки", "Н"],
    ["  Клуб  любителей чая ", "КЛ"],
    ["", ""],
  ])("инициалы «%s» → «%s»", (name, initials) => {
    expect(communityInitials(name)).toBe(initials);
  });

  it("без картинки показывает инициалы и называет сервер", () => {
    render(<CommunityIcon name="Тихая берлога" size={64} />);
    expect(screen.getByRole("img", { name: "Тихая берлога" })).toHaveTextContent("ТБ");
  });
});

describe("Badge", () => {
  it.each([
    [1, "1"],
    [999, "999"],
    [1000, "1K+"],
    [5400, "5K+"],
    [9999, "9K+"],
    [10000, "9K+"],
    [250000, "9K+"],
  ])("счётчик %s показывается как «%s»", (count, text) => {
    expect(formatCount(count, "{count}K+")).toBe(text);
  });

  it("нулевой счётчик не рисуется; подпись читается экранным диктором", () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<CountBadge count={12} aria-label="Упоминаний: 12" />);
    expect(screen.getByRole("img", { name: "Упоминаний: 12" })).toHaveTextContent("12");
  });

  it("«В эфире» и «Новое» хранятся обычным регистром: заглавными их делает оформление", () => {
    render(
      <>
        <LiveBadge />
        <PillBadge tone="danger">Новое</PillBadge>
      </>,
    );
    expect(screen.getByText("В эфире")).toBeInTheDocument();
    expect(screen.getByText("Новое")).toHaveAttribute("data-tone", "danger");
  });

  it("UnreadPip декоративный и меняет высоту по состоянию", () => {
    const { container } = render(<UnreadPip state="selected" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).toHaveAttribute("data-state", "selected");
  });
});

describe("E2EEBadge", () => {
  it("у каждого состояния своё пояснение текстом", () => {
    const { rerender } = render(<E2EEBadge state="verified" />);
    expect(screen.getByText("Зашифровано").parentElement).toHaveTextContent(
      "Зашифровано. Все участники проверены",
    );

    rerender(<E2EEBadge state="unverified" />);
    expect(screen.getByText("Зашифровано").parentElement).toHaveTextContent(
      "Участники ещё не проверены",
    );

    rerender(<E2EEBadge state="warning" />);
    const badge = screen.getByText("Зашифровано").parentElement;
    expect(badge).toHaveTextContent("Ключи собеседника изменились");
    expect(badge).toHaveAttribute("data-state", "warning");
  });
});
