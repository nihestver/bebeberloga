# STATUS — сервер (B04)

Модуль: `server/`. Промпт — `docs/prompts/B04-server-core.md`. Ветка `feat/B04-server-skeleton` (часть 0).

## Сделано (2026-11-06, часть 0)

- Контракт: `GET /health` в `docs/protocol/openapi.yaml` и `REST.md`; `HealthStatus` и `HealthState` — в `proto/bebeberloga/v1/common.proto` (ADR-0017 п. 2–3: модель в Protobuf, в OpenAPI `x-go-type`, JSON — protojson). Smoke-тест `tools/api/smoke/health.hurl` ждёт `HEALTH_STATE_OK`.
- Сгенерированный код закоммичен: `server/gen/bebeberloga/v1` (`buf generate`, Go) и `clients/web/src/gen/bebeberloga/v1` (TS — `buf.gen.yaml` генерирует оба плагина разом; каталога `clients/web` до B09 больше ничем не наполнен), `server/gen/api` (`oapi-codegen`, пока одна операция `getHealth` через `include-operation-ids`). CI (`just gen-check`) падает, если код отстал от контракта.
- `go.mod` (`go 1.27`), `oapi-codegen` как `tool`-зависимость (`go tool oapi-codegen` в `//go:generate`, файл `server/generate.go`), `.golangci.yml` (v2, `gen/` исключён).
- `cmd/bebeberloga-server`: `serve`, `version`, заглушки `migrate` и `admin` (возвращают ошибку «ещё не реализовано», код выхода 1), `--config`/`BB_CONFIG`.
- `internal/config`: умолчания → YAML (`KnownFields`) → env `BB_*` по тегам yaml; валидация адреса, уровней, таймаутов и схем URL (`database.url` — также DSN `key=value`); `Redacted` для журналов оставляет только схему, хост, порт и путь (имя базы) — userinfo и query убираются целиком, у DSN `key=value` остаются `host`, `port`, `dbname`. Таблица env → ключ — `server/README.md`.
- `internal/observability`: zerolog (json/console), OpenTelemetry только по стандартным `OTEL_EXPORTER_OTLP_*` (http/protobuf; без endpoint — noop), `otelhttp` на корне маршрутизатора. В журнал и имя span-а идёт шаблон маршрута chi (`GET /api/v1/health`), не сырой путь; ненайденный маршрут — `route=unmatched`. Endpoint OTLP журналируется через `Redacted`, `OTEL_EXPORTER_OTLP_HEADERS` — никогда.
- `internal/health`: реестр с кэшем (`cache_ttl`, параллельные запросы ждут одну проверку под мьютексом), общий таймаут (`health.timeout` ≤ 2 с по умолчанию), чекеры Postgres (`pgxpool.Ping`, пул ленивый), Valkey (клиент создаётся при первой проверке, дальше PING), NATS (`conn.Status()`, соединение с бесконечными повторами). Незаданный URL → `HEALTH_STATE_NOT_CONFIGURED`, не ошибка. Наружу только состояния.
- `internal/httpapi`: chi + RequestID/журнал запросов/recoverer (паника → 500 с `Error` протокола); `middleware.RealIP` не подключён (устарел и уязвим к подмене `X-Forwarded-For`; доверие прокси — вместе с rate limit в B06); неизвестный маршрут и неподдерживаемый метод — `404 NOT_FOUND` в формате `Error`, strict-handler с обработчиками ошибок в формате протокола, `http.Server` с `ReadHeaderTimeout`/`ReadTimeout`/`WriteTimeout`/`IdleTimeout` и graceful shutdown по SIGINT/SIGTERM.
- Тесты: конфиг (приоритеты, ошибки, маскировка), реестр health (OK/DOWN/таймаут/кэш), чекеры на закрытом порту (без Docker), интеграционные через testcontainers (Postgres, Valkey, NATS; пропуск при `-short`), маршрутизатор (форма protojson, 503, Error-ответы, журнал, recoverer), `Serve` (старт/остановка), CLI (диспетчер, заглушки, `BB_CONFIG`, сквозной `serve` → `/api/v1/health`).

### Технические решения

- **Ответы — protojson через собственные типы.** Сгенерированные `GetHealth200JSONResponse` и т. п. кодируют `encoding/json` (имена Go-полей, enum числами, `omitempty`), что противоречит ADR-0017 п. 3. Обработчики возвращают свои типы, реализующие интерфейсы `*ResponseObject`, и пишут тело `httpapi.WriteProto`. Этот же приём — для всех операций в следующих частях. Сгенерированные типы ответов остаются в `gen/api` неиспользуемыми.
- **Один `oapi-codegen.yaml` с `include-operation-ids`.** Список операций расширяется по мере реализации; так `gen/api` компилируется без заглушек на 150 операций.
- **Env без старых имён.** CI больше не передаёт `DATABASE_URL`/`VALKEY_URL`/`NATS_URL` и не поднимает `services`: интеграционные тесты сами поднимают контейнеры.
- **`migrate` — заглушка.** B17 не должен вызывать её в compose до основной части B04: команда завершается с ошибкой. `serve` в части 0 стартует без `database.url`; **в полном B04 `serve` без `database.url` не пройдёт валидацию конфига** (и, вероятно, без `valkey.url`).
- **405 не используется.** Неподдерживаемый метод на известном пути отвечает `404 NOT_FOUND`, как и неизвестный путь: статуса 405 в REST.md §2 нет, а код ошибки нельзя придумать в коде. Если позже понадобится `405` с заголовком `Allow`, это правка контракта — `ErrorCode` в `error.proto` и таблица REST.md §2, — а не кода.
- **Лицензии `gen/`.** `*.pb.go` несут SPDX-заголовок исходного `.proto` (Apache-2.0) — он побеждает аннотацию `server/**` (AGPL) в `REUSE.toml`; `api.gen.go` без заголовка покрыт аннотацией. Соответствует ADR-0017 п. 9.

### Зависимости (прямые) и лицензии

| Модуль | Лицензия | Роль |
|---|---|---|
| `github.com/go-chi/chi/v5` | MIT | маршрутизатор (ADR-0002) |
| `github.com/rs/zerolog` | MIT | журнал (ADR-0002) |
| `github.com/jackc/pgx/v5` | MIT | PostgreSQL (ADR-0002) |
| `github.com/valkey-io/valkey-go` | Apache-2.0 | Valkey (ADR-0002) |
| `github.com/nats-io/nats.go` | Apache-2.0 | NATS (ADR-0002) |
| `go.yaml.in/yaml/v3` | MIT, Apache-2.0 | YAML-конфиг |
| `go.opentelemetry.io/otel`, `otel/sdk`, `otel/exporters/otlp/otlptrace/otlptracehttp`, `contrib/instrumentation/net/http/otelhttp` | Apache-2.0 | трассировка (ADR-0002) |
| `google.golang.org/protobuf` | BSD-3-Clause | рантайм Protobuf, protojson (ADR-0017) |
| `github.com/oapi-codegen/oapi-codegen/v2` (только `tool`, в бинарник не входит) | Apache-2.0 | генерация обработчиков (ADR-0017) |
| `github.com/testcontainers/testcontainers-go` + `modules/{postgres,valkey,nats}` | MIT | интеграционные тесты (CLAUDE.md) |

Все лицензии из списка разрешённых `LICENSING.md`; `just lint-licenses` запускает `go-licenses check --allowed_licenses=…` строго по этому списку (транзитивно есть одна MPL-2.0 — `pgregory.net/rapid` из testcontainers, разрешена). В CI рецепт пока не вызывается — см. «Дальше».

## Сломано / известные ограничения

- Интеграционные тесты (testcontainers) требуют Docker: без него вне CI они пропускаются (`testcontainers.SkipIfProviderIsNotHealthy`), при `CI=true` — падают, чтобы не исчезать молча; `-short` пропускает всегда.
- Трассировка только `http/protobuf`; `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` даёт предупреждение и noop (gRPC-экспортёр тянет `google.golang.org/grpc` — добавить, когда понадобится).
- NATS-чекер смотрит `Status()`, а не делает round-trip: обрыв замечается по ping-интервалу клиента (2 мин по умолчанию), а не мгновенно.

## Дальше (часть 1, `/prompt B04` после B01 и B17 ч.1)

- п. 2 промпта: миграции `goose`, `sqlc` (`server/sqlc.yaml` — рецепт `gen` ждёт именно этот файл), таблицы ARCHITECTURE §5.3.
- п. 3–4: `internal/identity`, `internal/community`, движок прав PERMISSIONS §3.
- п. 5: расширить `include-operation-ids` (или снять фильтр), тест сверки схем `x-proto-message` с дескрипторами Protobuf (REST.md §6).
- п. 6: hurl-сценарии `tools/api/scenarios/`.
- Валидация конфига: `database.url` (и `valkey.url`) обязательны для `serve`; реализовать `migrate`.
- Prometheus-метрики — в `admin` (B16).
- Добавить `just lint-licenses` в CI (вместе с `reuse`, `cargo deny`): нужен `go-licenses` в образе — mise или `go install` в job.
- Доверенный прокси для `X-Forwarded-For` (адрес клиента для rate limit и журнала) — вместе с B06.
- Подкоманда `healthcheck` (запрос к своему `/api/v1/health` с кодом выхода) — для `healthcheck` контейнера в Compose: в образе distroless нет оболочки и `curl` (`deploy/STATUS.md`, решение владельца 2026-11-06 — в B17 ч.1 без неё).
- Когда `migrate` реализована — вызвать её в `deploy/compose/docker-compose.yml` перед `server` (сейчас не вызывается).
