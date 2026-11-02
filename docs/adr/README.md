# Architecture Decision Records

Каждое существенное решение — отдельный файл по шаблону [MADR](https://adr.github.io/madr/). Решение не меняется правкой старого файла: новый ADR помечает старый как `Superseded`.

| № | Решение | Статус |
|---|---|---|
| [0001](0001-clean-room-process.md) | Разработка по методу clean room: два контура, стена, журнал | Принято |
| [0002](0002-server-language-go.md) | Сервер на Go, модульный монолит | Принято |
| [0003](0003-licenses.md) | AGPL-3.0 сервер, GPL-3.0 + App Store exception клиенты, Apache-2.0 библиотеки | Принято |
| [0004](0004-e2ee-mls-sframe.md) | E2EE для всего на MLS (OpenMLS) + SFrame; стрим без режима отката | Принято |
| [0005](0005-channel-member-limit.md) | Лимит участников канала вместо режима без E2EE | Принято |
| [0006](0006-history-for-new-members.md) | История для новых участников выключена по умолчанию | Принято |
| [0007](0007-desktop-shell-electron.md) | Desktop-оболочка — Electron | Принято |
| [0008](0008-stream-media-engine.md) | Стрим: нативный Rust media-engine на LiveKit Rust SDK; Chromium-путь для AMD/Intel в 1.0 | Принято |
| [0009](0009-platform-minimums.md) | Минимальные версии ОС и уровни платформ | Принято |
| [0010](0010-mobile-after-1-0.md) | Мобильные клиенты — нативные, после 1.0 | Принято |
| [0011](0011-project-name.md) | Название Bebeberloga | Принято |
| [0012](0012-ai-dev-tooling.md) | Инструмент ИИ-разработки — Claude Code | Принято |

## Шаблон

```markdown
# ADR-NNNN: Название

- Статус: Предложено | Принято | Отклонено | Superseded by ADR-MMMM
- Дата: YYYY-MM-DD
- Связано: разделы PLAN.md, другие ADR

## Контекст
## Решение
## Последствия
## Рассмотренные альтернативы
```
