# Сервер

Go-сервер для self-hosted развёртывания: один бинарник или Docker Compose (ADR-0002, `docs/spec/ARCHITECTURE.md` раздел 5). Хранит и маршрутизирует только шифртекст: ключи и открытый текст сюда не попадают (инварианты E2EE в `CLAUDE.md`).

Лицензия сервера — AGPL-3.0-or-later (`LICENSING.md`, ADR-0003). Состояние работ — `STATUS.md`.

## Структура

| Каталог | Назначение |
|---|---|
| `cmd/bebeberloga-server` | Бинарник: подкоманды `serve`, `migrate`, `admin`, `version` |
| `internal/config` | Конфигурация: умолчания → YAML → `BB_*` |
| `internal/observability` | zerolog и OpenTelemetry |
| `internal/health` | Проверка зависимостей для `GET /health` |
| `internal/httpapi` | chi, middleware, реализация сгенерированного контракта, protojson |
| `internal/buildinfo` | Версия сборки |
| `gen/bebeberloga/v1` | Protobuf-типы (`buf generate` из `proto/`) — не править руками |
| `gen/api` | Обработчики REST из `docs/protocol/openapi.yaml` (`oapi-codegen`) — не править руками |
| `Dockerfile`, `Dockerfile.dockerignore` | Образ сервера: статический бинарник на distroless, пользователь без прав root |

Пакеты `internal/{identity,community,messaging,mls,gateway,media,files,push,admin}` появятся по промптам B04–B07 и B16.

## Сборка и запуск

```bash
cd server
go build -ldflags "-X github.com/nihestver/bebeberloga/server/internal/buildinfo.version=$(git describe --tags --always)" ./cmd/bebeberloga-server
./bebeberloga-server serve --config config.yaml
curl -s localhost:8080/api/v1/health
```

Образ Docker — `server/Dockerfile` (контекст сборки — корень репозитория): `just image` собирает его из рабочего дерева, запуск всего стека — `deploy/README.md`. В образе нет `.git`, поэтому версию передаёт сборка: `--build-arg VERSION=…`.

Без `-ldflags` версия берётся из сведений о сборке Go (`dev-<ревизия>`). Остановка — SIGINT или SIGTERM, открытые соединения завершаются в пределах `http.shutdown_timeout`.

Кодогенерация — `just gen` из корня репозитория (`buf generate` → `sqlc generate` → `go generate ./...`), проверки — `just lint-go`, `just test-go`. Интеграционные тесты (testcontainers) требуют Docker; без него вне CI пропускаются, при `-short` — всегда; на стенде агента — `just remote test-go`.

## Конфигурация

Порядок: значения по умолчанию → YAML-файл (`--config` или `BB_CONFIG`) → переменные окружения. Неизвестный ключ в YAML — ошибка. Имя переменной строится из пути ключа: `http.addr` → `BB_HTTP_ADDR`. Длительности — в формате Go (`5s`, `2m`).

| Переменная | Ключ YAML | По умолчанию | Назначение |
|---|---|---|---|
| `BB_CONFIG` | — | — | Путь к YAML-файлу |
| `BB_HTTP_ADDR` | `http.addr` | `:8080` | Адрес прослушивания |
| `BB_HTTP_READ_HEADER_TIMEOUT` | `http.read_header_timeout` | `5s` | `http.Server.ReadHeaderTimeout` |
| `BB_HTTP_READ_TIMEOUT` | `http.read_timeout` | `30s` | `http.Server.ReadTimeout` |
| `BB_HTTP_WRITE_TIMEOUT` | `http.write_timeout` | `30s` | `http.Server.WriteTimeout` |
| `BB_HTTP_IDLE_TIMEOUT` | `http.idle_timeout` | `2m` | `http.Server.IdleTimeout` |
| `BB_HTTP_SHUTDOWN_TIMEOUT` | `http.shutdown_timeout` | `10s` | Ожидание открытых соединений при остановке |
| `BB_LOG_LEVEL` | `log.level` | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `BB_LOG_FORMAT` | `log.format` | `json` | `json` или `console` |
| `BB_DATABASE_URL` | `database.url` | — | PostgreSQL, `postgres://…` или DSN `host=… dbname=…`; пусто — не настроена |
| `BB_VALKEY_URL` | `valkey.url` | — | Valkey, `redis://…` или `valkey://…`; пусто — не настроен |
| `BB_NATS_URL` | `nats.url` | — | NATS, `nats://…`; пусто — не настроен |
| `BB_HEALTH_TIMEOUT` | `health.timeout` | `2s` | Общий таймаут проверок зависимостей |
| `BB_HEALTH_CACHE_TTL` | `health.cache_ttl` | `2s` | Срок кэша результата `GET /health` |

Трассировка настраивается только стандартными переменными OpenTelemetry: `OTEL_EXPORTER_OTLP_ENDPOINT` (или `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`), `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` и т. д. Поддерживается протокол `http/protobuf`; без endpoint провайдер noop.

Пример YAML:

```yaml
http:
  addr: ":8080"
log:
  level: info
database:
  url: postgres://bb:secret@postgres:5432/bebeberloga?sslmode=disable
valkey:
  url: redis://valkey:6379/0
nats:
  url: nats://nats:4222
```

В журнал адреса зависимостей попадают только как `схема://хост:порт/база` (для DSN `key=value` — `host`, `port`, `dbname`): userinfo и параметры запроса не пишутся. Журнал запросов содержит шаблон маршрута, а не сырой путь.

## `GET /api/v1/health`

Тело — `bebeberloga.v1.HealthStatus` в protojson: `status` (`HEALTH_STATE_OK` | `HEALTH_STATE_DOWN`), `version`, `checks` (`postgres`, `valkey`, `nats` → `HEALTH_STATE_OK` | `HEALTH_STATE_DOWN` | `HEALTH_STATE_NOT_CONFIGURED`). Все настроенные зависимости доступны — `200`, иначе `503`. Незаданная зависимость не считается ошибкой. Результат кэшируется на `health.cache_ttl`; проверки выполняются долгоживущими клиентами, созданными при старте, без новых соединений на каждый запрос. Текстов ошибок в ответе нет — они в журнале.

