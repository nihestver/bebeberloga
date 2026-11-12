# Bebeberloga — инструкции для ИИ-агентов

Основной инструмент разработки — Claude Code ([ADR-0012](docs/adr/0012-ai-dev-tooling.md)), и его
context pack — [`CLAUDE.md`](CLAUDE.md). Любой другой агент работает по тому же файлу: прочитай его
целиком до начала задачи. Здесь только то, что Claude Code получает от настроек репозитория
автоматически, а другой агент — нет.

## Ограждения, которые для Claude Code задают `.claude/settings.json` и hooks

- **Не читай** `docs/PLAN.md` (рабочий документ аналитиков, контур A clean room), `.env*`, `*.pem`,
  `*.key` — ни напрямую, ни через `git show`, `git log -p`, `git diff`, `grep` по репозиторию.
- **Не открывай** сайты, документацию, клиенты и репозитории стороннего продукта, аналог которого
  строится. Работай только по `docs/` (кроме `docs/PLAN.md`), RFC и документации open-source
  библиотек ([`docs/cleanroom/POLICY.md`](docs/cleanroom/POLICY.md)).
- **Спрашивай человека** перед `ssh`, `git push` и `docker compose down`.
- **Не вливай PR и не пушь в `main`**: `gh pr merge`, merge через `gh api` и `git push` в `main`
  запрещены. PR вливает владелец на GitHub
  ([защита `main`](docs/dev/WORKFLOW.md#защита-main-и-релизных-тегов)).
- **Запретный список** из [`docs/spec/GLOSSARY.md`](docs/spec/GLOSSARY.md): перед записью файла
  проверь его `.claude/hooks/cleanroom-guard.sh --files <файл>`; после правок — `just cleanroom`.
- **Форматирование** после записи: `gofmt`, `rustfmt`, `buf format`, `prettier` — как в
  `.claude/hooks/format.sh`.

## Порядок работы

Задачи — промпты из [`docs/prompts/`](docs/prompts/README.md): один промпт — одна ветка — один PR,
план до кода, тесты обязательны, состояние в `STATUS.md` модуля, в конце — независимое ревью по
[`docs/cleanroom/REVIEW-CHECKLIST.md`](docs/cleanroom/REVIEW-CHECKLIST.md). Перед коммитом —
`just check`; коммиты по Conventional Commits с `Signed-off-by` (DCO).
