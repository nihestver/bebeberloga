# Bebeberloga

Open-source self-hosted платформа общения для сообществ: текстовые и голосовые каналы, видео, стрим экрана, окна или приложения со звуком только этого приложения, soundboard. Всё общение, включая стрим, защищено сквозным шифрованием (E2EE на MLS, RFC 9420): сервер хранит и передаёт только шифртекст.

Проект разрабатывается по методу clean room и не использует код, ассеты, тексты и API сторонних продуктов (см. `docs/cleanroom/POLICY.md`).

**Статус:** фаза 0. Спецификация (A1–A5), ADR и промпты готовы; следующий шаг — протокол (B1) и спайки S1–S6. Кода ещё нет. Прогресс — в [`docs/prompts/README.md`](docs/prompts/README.md) (таблица статусов) и в `STATUS.md` каждого модуля.

**Инфраструктура:** домен `bebeberloga.org` (Cloudflare DNS); тест-сервер — `test.bebeberloga.org`.

## Что будет в версии 1.0

- Сервер на Go: один бинарник, Docker Compose, Helm-чарт.
- Desktop-клиент (Electron + React): Windows 10 21H2+ и 11, macOS 13+, Linux (Debian 12+ / Ubuntu 22.10+ с PipeWire).
- E2EE для личных сообщений, каналов, файлов, голоса, камеры и стрима — одним режимом, без отката на транспортное шифрование.
- Стрим экрана, окна или приложения: 720p30–1080p60, стерео 48 кГц, задержка < 1 с, звук только из транслируемого приложения.
- Soundboard в голосовых каналах.
- Минимальные сообщества: каналы, роли-пресеты, инвайты, сообщения с вложениями и реакциями.

Мобильные клиенты (Android, затем iOS), боты и webhooks — после 1.0.

## Документация

| Документ | Что в нём |
|---|---|
| [`docs/spec/ARCHITECTURE.md`](docs/spec/ARCHITECTURE.md) | Архитектура: E2EE на MLS и SFrame, компоненты сервера, модель данных, стек, стрим, компромиссы E2EE |
| [`docs/adr/`](docs/adr/README.md) | Принятые архитектурные решения (ADR) |
| [`docs/cleanroom/`](docs/cleanroom/POLICY.md) | Политика clean room, журнал, чеклист ревью |
| [`docs/spec/`](docs/spec/README.md) | Функциональная спецификация: глоссарий, инвентарь функций, права, потоки, экраны |
| [`docs/protocol/`](docs/protocol/README.md) | Протокол: gateway, REST, MLS-профиль, формат сообщений (заполняется в фазе 0–1) |
| [`docs/prompts/`](docs/prompts/README.md) | Промпты для Claude Code: порядок запуска, статусы, шаблон |
| [`docs/dev/WORKFLOW.md`](docs/dev/WORKFLOW.md) | Как разрабатывать: VSCodium + Claude Code, инструменты, локальная среда, тест-сервер, CI/CD |
| [`docs/README.md`](docs/README.md) | Карта всей документации, включая рабочий план контура A |
| [`BRAND.md`](BRAND.md) | Бренд: голос, логотип, палитра, шрифты; ассеты в `brand/` |
| [`LICENSING.md`](LICENSING.md) | Схема лицензий по компонентам |
| [`CLAUDE.md`](CLAUDE.md) | Инструкции для Claude Code (контур реализации) |

## Планируемая структура репозитория

```
bebeberloga/
├── docs/            # спецификация, ADR, протокол, clean room, промпты
├── proto/           # Protobuf-схемы (общие для всех)
├── crypto-core/     # Rust: MLS, ключи, файлы, SFrame-ключи, ключи истории; uniffi/napi/wasm
├── media-engine/    # Rust: захват экрана/окна/звука, аппаратное кодирование, публикация стрима
├── server/          # Go: cmd/, internal/{identity,community,messaging,mls,gateway,media,files,push,admin}
├── clients/
│   ├── web/         # React + TS (используется и в desktop)
│   ├── desktop/     # Electron-оболочка, сборки
│   ├── android/     # Kotlin + Compose (после 1.0)
│   └── ios/         # Swift + SwiftUI (после 1.0)
├── sdk/             # Bot SDK: Go и TypeScript (после 1.0)
├── design/          # токены, иконки, Penpot-экспорт, Storybook
├── deploy/          # docker-compose, helm
└── tools/           # скрипты, кодогенерация, lint-конфиги
```

## Лицензии

Сервер — AGPL-3.0; клиенты — GPL-3.0 с исключением для магазинов приложений; crypto-core, media-engine, proto и SDK — Apache-2.0; документация — CC BY-SA 4.0. Подробности — в [`LICENSING.md`](LICENSING.md).
