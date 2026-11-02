# Сервер

Go-сервер для self-hosted развёртывания: один бинарник или Docker Compose (ADR-0002, `docs/PLAN.md`). Хранит и маршрутизирует только шифртекст: ключи и открытый текст сюда не попадают (инварианты E2EE в `CLAUDE.md`).

Код появится по промптам контура B из `docs/prompts/README.md`. Планируемая структура — пакеты `internal/{identity,community,messaging,mls,gateway,media,files,push,admin}`, общающиеся через интерфейсы.

Лицензия сервера — AGPL-3.0-or-later (`LICENSING.md`, ADR-0003).
