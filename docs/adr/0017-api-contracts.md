# ADR-0017: Контракты API — OpenAPI 3.0.3 поверх Protobuf-моделей, buf, UUIDv7 строкой

- Статус: Принято
- Дата: 2026-11-02
- Связано: ADR-0002, ADR-0004, ADR-0015, ADR-0016 (спайк S1: handshake зашифрованы, сервер — external sender); `docs/spec/ARCHITECTURE.md` §5.2, §6.4; `CLAUDE.md` («Protobuf — единственный источник моделей»); промпт B01

## Контекст

Контракты пишутся первыми (B01), код сервера (B04–B07) и клиентов (B09–B13) генерируется из них. `CLAUDE.md` требует, чтобы модели существовали только в Protobuf, а `ARCHITECTURE.md` §5.2 — чтобы REST-контракт писался руками в OpenAPI и из него генерировались обработчики. Нужно совместить эти требования и выбрать версию OpenAPI под Go-генератор, формат идентификаторов, способ генерации Protobuf и пути для сгенерированного кода.

## Решение

1. **REST — OpenAPI 3.0.3** (`docs/protocol/openapi.yaml`), а не 3.1. Генератор для Go — [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) (Apache-2.0): режим `strict-server` поверх `chi` (ADR-0002), маршруты и типы запросов из контракта. У него полная поддержка 3.0 и частичная 3.1, а возможностей 3.1 контракту не нужно. Для TypeScript — [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) и `openapi-fetch` (MIT). Проверка контракта — `@redocly/cli` (MIT; `just openapi`, конфигурация `redocly.yaml`).
2. **Модели в коде — только из Protobuf.** Каждая схема OpenAPI, описывающая сущность, помечена `x-proto-message` (или `x-proto-enum`) и `x-go-type`/`x-go-type-import`: `oapi-codegen` не создаёт для неё новый тип, а подставляет тип из `server/gen/bebeberloga/v1`; для TS хук `transform` в `openapi-typescript` подставляет тип из `clients/web/src/gen/bebeberloga/v1/*_pb.ts`. Схема в OpenAPI остаётся документацией и проверяется тестом (B04) на совпадение полей с дескриптором Protobuf. Без пометки — только тела запросов и обёртки списков, которых нет в Protobuf. Так выполняются и правило `CLAUDE.md`, и «контракт пишется руками» из `ARCHITECTURE.md`.
3. **JSON-форма одна** — protojson с `UseProtoNames` (имена `snake_case` как в `.proto`) и `EmitDefaultValues` (нулевые скаляры, списки и enum выводятся, незаданные сообщения и `oneof` — нет; поэтому `required` в OpenAPI совпадает с проводом; `*_UNSPECIFIED` сервер не отправляет), enum — полные имена значений (`ERROR_CODE_PERMISSION_DENIED`, `CHANNEL_TYPE_TEXT`), время — RFC 3339, байты — base64, 64-битные целые в телах — строки (как делает protojson; JS не хранит их точно). Она действует в REST и в JSON-режиме gateway.
4. **Protobuf через buf**: модуль `proto/` (`buf.yaml`, lint `STANDARD`, breaking `FILE`), генерация удалёнными плагинами из `buf.gen.yaml` — локально нужен только `buf` (`mise.toml`). Go — `protocolbuffers/go` в `server/gen/` с `paths=source_relative` и `go_package_prefix = github.com/nihestver/bebeberloga/server/gen`; TS — `bufbuild/es` (`@bufbuild/protobuf`) в `clients/web/src/gen/`. Kotlin и Swift добавляются вместе с мобильными клиентами (ADR-0010).
5. **Сгенерированный код коммитится** в `server/gen/` и `clients/web/src/gen/`; CI запускает `just gen` и падает на `git diff`, если код отстал от контракта (ARCHITECTURE.md §5.2). Сборка сервера и клиента не зависит от сети и buf, а ревью видит изменения контракта.
6. **Идентификаторы — UUIDv7 в виде `string`** (каноническая форма, строчные hex) и в Protobuf, и в JSON: один вид id в URL, JSON и бинарных кадрах; TS-клиенту не нужны base64-преобразования; лишние 20 байт на id несущественны рядом с шифртекстом. Id сообщений генерирует клиент (порядок ленты), остальные — сервер.
7. **Права — список строковых кодов** `<область>.<действие>` (ADR-0013 п. 15); сервер отдаёт клиенту вычисленные действующие права (`EffectivePermissions`), клиент их не вычисляет.
8. **Ошибки — одна модель** `Error{code, …}` и один ответ `default` в OpenAPI; соответствие кодов HTTP-статусам — `REST.md §2`.
9. **Лицензия контрактов.** `proto/` и `docs/protocol/openapi.yaml` — Apache-2.0 (аннотация в `REUSE.toml`, `proto/LICENSE`): из них генерируется код под AGPL, GPL и Apache-2.0, а ShareAlike документации на производный код распространяться не должен. Остальные файлы `docs/protocol/` — CC-BY-SA-4.0.

### Лицензии инструментов

| Инструмент | Роль | Лицензия |
|---|---|---|
| `buf` CLI | lint, format, breaking, generate | Apache-2.0 |
| `buf.build/protocolbuffers/go` → `google.golang.org/protobuf` | Go-типы и рантайм | BSD-3-Clause |
| `buf.build/bufbuild/es` → `@bufbuild/protobuf` | TS-типы и рантайм | Apache-2.0 |
| `oapi-codegen` | Go-обработчики из OpenAPI | Apache-2.0 |
| `openapi-typescript`, `openapi-fetch` | TS-клиент из OpenAPI | MIT |
| `@redocly/cli` | проверка OpenAPI (только в CI и `just openapi`) | MIT |

Все лицензии разрешены `LICENSING.md`.

## Последствия

- Любое изменение контракта начинается с `.proto` (модели) или `openapi.yaml` (маршруты и тела запросов), затем `just gen`; ручные правки в `gen/` запрещены.
- Схемы сущностей в OpenAPI дублируют Protobuf описательно; расхождение ловит тест B04, а не компилятор. Цена принята ради читаемого контракта и `hurl`-smoke-тестов (FEATURES 3.9: REST — публичный API).
- 64-битные значения в JSON — строки; клиенты на TS работают с `bigint`/строками, в Go это делает protojson.
- `buf breaking` против `main` включается, как только в `main` появится `proto/` (рецепт `lint-proto` и CI это учитывают).
- `docs/spec/ARCHITECTURE.md` §6.1 называет OpenAPI 3.1; этот ADR выбирает 3.0.3 — таблицу стека обновляет контур A.
- Переход на OpenAPI 3.1 возможен позже без изменения семантики: отличия сводятся к `nullable` → `type: [T, 'null']`.

## Рассмотренные альтернативы

- **OpenAPI 3.1**: лучше JSON Schema, но слабее поддержка в `oapi-codegen`; выигрыша для контракта нет.
- **Генерировать OpenAPI из Protobuf** (`protoc-gen-openapi` с HTTP-аннотациями): модели были бы в одном месте автоматически, но контракт перестал бы писаться руками (ARCHITECTURE.md §5.2), а аннотации привязали бы `.proto` к REST-маршрутам.
- **Connect-RPC / gRPC-gateway вместо REST**: одна схема на всё, но REST-контракт нужен как публичный API и для `hurl`-smoke-тестов; Connect остаётся вариантом для внутренних сервисов.
- **Отдельные REST-модели из OpenAPI** (первая редакция этого ADR): противоречит `CLAUDE.md` и создаёт два набора типов в коде; отклонено ревью.
- **`bytes` для UUID**: экономия 20 байт на id не оправдывает три разных представления id (URL, JSON, бинарный).
- **Не коммитить сгенерированный код**: сборка зависит от сети и версий плагинов; ревью не видит изменений API.
- **Локальные protoc-плагины вместо удалённых**: больше инструментов в `mise.toml`; удалённые плагины buf воспроизводимы по версии.
