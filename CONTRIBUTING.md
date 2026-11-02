# Как участвовать

1. Прочитай `docs/cleanroom/POLICY.md`. Код пишется только по спецификации в `docs/spec/`; код, ассеты и тексты сторонних продуктов не используются.
2. Подписывай коммиты DCO: `git commit -s`. Формат сообщений — Conventional Commits (`feat(server): ...`).
3. Одна ветка — один модуль или одно исправление: `feat/<модуль>-<что>`, `fix/...`, `spike/<номер>`.
4. Перед PR: `just check` зелёный, чеклист `docs/cleanroom/REVIEW-CHECKLIST.md` пройден.
5. Изменения в `crypto-core/`, `server/internal/mls/`, `media-engine/` — два ревью и запись в `SECURITY-CHANGELOG.md` модуля.

Лицензии — `LICENSING.md`. Процесс разработки и CI — `docs/dev/WORKFLOW.md`.
