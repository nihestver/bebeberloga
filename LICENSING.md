# Лицензии проекта

Решение зафиксировано в [ADR-0003](docs/adr/0003-licenses.md). CLA не требуется — достаточно DCO (`Signed-off-by` в каждом коммите).

| Каталог | Лицензия | SPDX-идентификатор | Почему |
|---|---|---|---|
| `server/`, `deploy/` | AGPL-3.0-or-later | `AGPL-3.0-or-later` | Тот, кто запускает изменённый сервер для других, обязан опубликовать изменения; защита от закрытых SaaS-форков |
| `clients/` (web, desktop, android, ios) | GPL-3.0-or-later с исключением для магазинов приложений (§7 GPLv3) | `GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception` | Любая распространяемая сборка клиента обязана быть открытой — это гарантия того, что E2EE не подменён; исключение разрешает распространение через App Store, Google Play и другие магазины с дополнительными условиями |
| `crypto-core/`, `media-engine/`, `proto/`, `sdk/` | Apache-2.0 | `Apache-2.0` | Чтобы библиотеки можно было встроить в любые клиенты и боты |
| `design/` (токены, иконки), `spikes/` | Apache-2.0 | `Apache-2.0` | Токены и иконки используются во всех клиентах; спайки — одноразовые эксперименты, их код может перейти в любой компонент |
| `tests/` (сквозные тесты нескольких компонентов) | AGPL-3.0-or-later | `AGPL-3.0-or-later` | Как у сервера, который они проверяют |
| Корневые конфиги (`Cargo.toml`, `package.json`, `buf.yaml`, `.golangci.yml` и т. п.), `.github/`, `.claude/`, `.vscode/`, `.devcontainer/`, `.dockerignore` | CC0-1.0 | `CC0-1.0` | Служебные файлы без творческого содержания; список — в `REUSE.toml` |
| `docs/`, `BRAND.md` | CC BY-SA 4.0 | `CC-BY-SA-4.0` | Документация свободно переиспользуется с указанием авторства |
| `docs/protocol/openapi.yaml` (исключение из `docs/`) | Apache-2.0 | `Apache-2.0` | Контракт, из которого генерируется код сервера, клиентов и SDK; как `proto/` ([ADR-0017](docs/adr/0017-api-contracts.md) п. 9) |
| `brand/` (логотип, символ, иконка) | Все права защищены, кроме упоминания проекта | — | Логотип и имя — товарный знак проекта, не часть свободной лицензии |

## Что ещё нужно сделать

- [x] Положить полные тексты лицензий: `LICENSE` (AGPL-3.0) в корень, `LICENSE` в каждый каталог кода с другой лицензией (`clients/` — GPL-3.0, `tools/` — Apache-2.0; `crypto-core/`, `media-engine/`, `proto/`, `sdk/` — при создании каталога), `clients/LICENSE-EXCEPTION` с текстом исключения для магазинов приложений. Документация и `brand/` покрыты `REUSE.toml` и `LICENSES/`.
- [x] REUSE-линт (`reuse lint`): CI (job `cleanroom`) и `just cleanroom` локально.
- [ ] SPDX-заголовки в шаблонах файлов — вместе с первыми модулями.
- [ ] Включить автоматические проверки зависимостей: `cargo deny` (Rust), `go-licenses` (Go), `license-checker` (npm).

## Разрешённые лицензии зависимостей

MIT, BSD-2/3, Apache-2.0, ISC, MPL-2.0, Zlib, Unlicense, CC0, Unicode-3.0 (таблицы Unicode в `unicode-ident`, есть в любом Rust-проекте), SIL OFL 1.1 (шрифты). GPL/LGPL-зависимости — только в каталогах с совместимой лицензией (`server/`, `clients/`) и только после записи в ADR. Код и ассеты сторонних мессенджеров и их SDK не используются ни под какой лицензией (политика clean room).

## Шаблон заголовка файла

```
// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
```
