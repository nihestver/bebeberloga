# B4. Сервер: каркас, схема БД, identity и community

Запуск: **часть 0** — `/prompt B04 ч.0` в фазе 0 (только п. 1: каркас, конфиг и `/api/v1/health`; от B1 не зависит); **остальное** — `/prompt B04` в фазе 1, после B1 и B17 ч.1 (локальный compose). Каталог: `server/`.

## Роль
Go-бэкендер в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/protocol/REST.md, openapi.yaml, GATEWAY.md (B1)
- docs/spec/ARCHITECTURE.md §5
- docs/spec/PERMISSIONS.md (вычисление прав — §3; пресеты — §2)
- docs/spec/FLOWS/01-register.md, 03-create-community.md, 04-invite-join.md, 05-dm.md, 10-moderation.md
- docs/adr/0002, 0003, 0005, 0013, 0015, 0025
- server/STATUS.md, если есть

## Задача
1. `server/go.mod`, бинарник `cmd/bebeberloga-server` с подкомандами `serve`, `migrate`, `admin` (заглушка), конфиг YAML + env, `zerolog`, OpenTelemetry, `/api/v1/health` (версия, состояние зависимостей).
2. Миграции `goose` и запросы `sqlc` для таблиц из ARCHITECTURE §5.3 (имена — по GLOSSARY: `permission_overrides`, а не чужие названия).
3. `internal/identity`: регистрация с подтверждением email, вход, сессии, сброс пароля, устройства (без MLS-логики — она в B5), удаление аккаунта; политика регистрации инстанса (по умолчанию — по приглашениям, ADR-0025 п. 12; журнал без IP-адресов и параметров пути, п. 3).
4. `internal/community`: сообщества, категории, каналы, пресеты ролей и свои роли, движок прав по PERMISSIONS §3 (включая приватные каналы через «Видеть канал»), приглашения (TTL, лимит), настройка «Новые участники видят историю» (сервер и канал), баны, передача владения, канал системных сообщений, звуки саундборда сообщества и личные звуки (публичные ассеты).
5. REST-обработчики генерируются из `docs/protocol/openapi.yaml` генератором из ADR B1 (`//go:generate`, запуск — `just gen`); руками пишется только реализация интерфейсов. Не меняй контракт в коде — меняй `openapi.yaml` и перегенерируй.
6. Интеграционные тесты `testcontainers-go` (Postgres, Valkey); hurl-сценарии в `tools/api/scenarios/`: регистрация → вход → создать сервер → приглашение → вступление.

## Критерии готовности
- [ ] `just lint-go`, `just test-go` зелёные; `just smoke-test` против локального compose проходит.
- [ ] В CI (job `go`) добавлена проверка актуальности сгенерированного кода: `just gen` и `git diff --exit-code`.
- [ ] Таблица PERMISSIONS §4 «действие → право» покрыта тестами движка прав.
- [ ] server/STATUS.md обновлён.
