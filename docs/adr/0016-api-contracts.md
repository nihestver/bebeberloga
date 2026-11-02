# ADR-0016: Контракты API — OpenAPI 3.0.3 и Protobuf через buf, UUIDv7 строкой

- Статус: Принято
- Дата: 2026-11-02
- Связано: ADR-0002, ADR-0004, ADR-0015; `docs/spec/ARCHITECTURE.md` §5.2, §6.4; промпт B01

## Контекст

Контракты пишутся первыми (B01), код сервера (B04–B07) и клиентов (B09–B13) генерируется из них. Нужно выбрать версию OpenAPI под Go-генератор, формат идентификаторов, способ генерации Protobuf и пути для сгенерированного кода — так, чтобы параллельные промпты не разошлись.

## Решение

1. **REST — OpenAPI 3.0.3** (`docs/protocol/openapi.yaml`), а не 3.1. Генератор для Go — [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) (Apache-2.0): режим `strict-server` поверх `chi` (ADR-0002), типы запросов и ответов из схем. У него полная поддержка 3.0 и частичная 3.1, а возможностей 3.1 (JSON Schema 2020-12, `webhooks`) контракту не нужно. Для TypeScript — [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) и `openapi-fetch` (MIT), оба читают 3.0 и 3.1. Проверка контракта — `@redocly/cli` (`just openapi`, конфигурация `redocly.yaml`).
2. **Protobuf через buf**: модуль `proto/` (`buf.yaml`, lint `STANDARD`, breaking `FILE`), генерация удалёнными плагинами из `buf.gen.yaml` — локально нужен только `buf` (`mise.toml`). Go — `protocolbuffers/go` в `server/gen/` с `paths=source_relative` и `go_package_prefix = github.com/nihestver/bebeberloga/server/gen`; TS — `bufbuild/es` (`@bufbuild/protobuf`, Apache-2.0) в `clients/web/src/gen/`. Kotlin и Swift добавляются в `buf.gen.yaml` вместе с мобильными клиентами (ADR-0010).
3. **Сгенерированный код коммитится** в `server/gen/` и `clients/web/src/gen/`; CI запускает `just gen` и падает на `git diff`, если код отстал от контракта (ARCHITECTURE.md §5.2). Так сборка сервера и клиента не зависит от сети и buf, а ревью видит, что меняется в контракте.
4. **Идентификаторы — UUIDv7 в виде `string`** (каноническая форма, строчные hex) и в Protobuf, и в JSON. Один вид id в URL, в JSON-режиме gateway и в бинарных кадрах; TS-клиенту не нужны base64-преобразования; лишние 20 байт на id несущественны рядом с шифртекстом. Id сообщений генерирует клиент (порядок ленты), остальные — сервер.
5. **JSON-форма моделей** одинакова в REST и в JSON-режиме gateway: имена полей `snake_case` как в `.proto`, enum — строковые имена значений Protobuf (`CHANNEL_TYPE_TEXT`), время — RFC 3339, байты — base64. OpenAPI-схемы повторяют Protobuf-сообщения; соответствие полей проверяется тестом в B04.
6. **Права — список строковых кодов** `<область>.<действие>` (ADR-0013 п. 15), сервер отдаёт клиенту вычисленные действующие права (`EffectivePermissions`), клиент их не вычисляет.
7. **Ошибки — одна модель** `Error{code, …}` и один ответ `default` в OpenAPI; соответствие кодов HTTP-статусам — `REST.md §2`.

## Последствия

- Любое изменение контракта начинается с `openapi.yaml` или `.proto`, затем `just gen`; ручные правки в `gen/` запрещены.
- `buf breaking` против `main` включается, как только в `main` появится `proto/` (рецепт `lint-proto` и CI это учитывают).
- Модели сущностей существуют в двух описаниях (Protobuf и OpenAPI); это цена за REST с генерацией и бинарный gateway. Альтернатива — один Protobuf и Connect-RPC для REST — отвергнута ниже.
- Переход на OpenAPI 3.1 возможен позже без изменения семантики: отличия контракта сводятся к `nullable` → `type: [T, 'null']`.

## Рассмотренные альтернативы

- **OpenAPI 3.1**: лучше JSON Schema, но слабее поддержка в `oapi-codegen`; выигрыша для контракта нет.
- **Connect-RPC / gRPC-gateway вместо REST**: одна схема на всё, но REST-контракт нужен как публичный API (FEATURES 3.9) и для `hurl`-smoke-тестов; Connect остаётся вариантом для внутренних сервисов.
- **`bytes` для UUID**: экономия 20 байт на id не оправдывает три разных представления id (URL, JSON, бинарный).
- **Не коммитить сгенерированный код**: сборка зависит от сети и версий плагинов; ревью не видит изменений API.
- **Локальные protoc-плагины вместо удалённых**: больше инструментов в `mise.toml`; удалённые плагины buf воспроизводимы по версии.
