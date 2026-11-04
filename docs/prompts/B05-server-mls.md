# B5. Сервер: MLS Delivery Service

Запуск: `/prompt B05`. Фаза 1. Зависит от B2, B4 (и S4). Каталог: `server/internal/mls/`.

## Роль
Go-бэкендер с опытом протоколов в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/protocol/CRYPTO.md (правила DS, инварианты и тесты для сервера), GATEWAY.md
- docs/spec/ARCHITECTURE.md §4.3, §5.1, §5.6
- docs/spec/FLOWS/02-new-device.md, 04-invite-join.md, 10-moderation.md
- spikes/04-mls-ds/REPORT.md

## Задача
Склад KeyPackage (одноразовые, учёт расхода, предупреждение клиенту о нехватке), сериализация Proposal/Commit по группе с эпохами, external sender: предложения Add/Remove по событиям прав и устройств, батчинг предложений, Welcome-доставка, возвращение устройства после долгого офлайна (Remove + Add) и пересоздание группы канала при рассинхроне (ADR-0019, `CRYPTO.md` §2), ротация эпох по расписанию (запрос клиенту), лимит участников канала (ADR-0005), события gateway. External commit не принимается, GroupInfo сервер не хранит (ADR-0019). Сервер не создаёт commit-ов и не хранит ключей групп.

## Критерии готовности
- [ ] Тесты сервера из CRYPTO.md; нагрузочный тест 1 000 входов (из S4) в CI-профиле «long» (рецепт `just test-load` — добавить).
- [ ] Ревью security-reviewer; запись в server/internal/mls/SECURITY-CHANGELOG.md.
