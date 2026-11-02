# B1. Протокол: Protobuf, gateway, REST

Запуск: `/prompt B01`. Фаза 0. Только контракты — без реализации сервера и клиента. Рекомендуется plan mode.

## Роль
Архитектор API в проекте Bebeberloga (Go + TypeScript). Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/spec/GLOSSARY.md (термины; уровень 2 запретного списка — имена полей и событий)
- docs/spec/ARCHITECTURE.md §4.3–4.8, §5.1–5.3
- docs/spec/PERMISSIONS.md (коды прав, ошибки §5)
- docs/spec/FEATURES.md (только строки M)
- docs/spec/FLOWS/*.md — все потоки: каждая операция в них должна иметь REST-вызов или событие gateway
- docs/protocol/README.md («Уже зафиксировано» — не пересматривать)
- docs/adr/0004, 0005, 0008, 0013, 0015

## Задача
1. `buf.yaml`, `buf.gen.yaml` и схемы в `proto/bebeberloga/v1/`: общие типы (UUIDv7 как string/bytes — выбрать и обосновать), сущности (user, device, community, category, channel, role, member, invite, ban, sound, message envelope metadata), события gateway, ошибки.
2. `docs/protocol/GATEWAY.md`: `Identify` → `Ready` (состав снимка), события с монотонным `seq`, heartbeat, `Resume(seq)` с буфером 5 минут, zstd, ограничения размеров; список событий (как минимум MessageCreated/Updated/Deleted, MlsHandshake, MlsWelcome, PresenceUpdated, TypingStarted, VoiceStateUpdated, ChannelCreated/Updated/Deleted, MemberJoined/Left, PermissionsUpdated, DeviceAdded/Verified/Removed, SoundAdded/Removed, SoundPlayed, InviteCreated/Revoked; команды клиента, включая PlaySound).
3. `docs/protocol/REST.md` и `docs/protocol/openapi.yaml` — контракт, из которого генерируется код (версию OpenAPI 3.0/3.1 выбери под генератор Go, который предложишь для B4; выбор — в ADR): регистрация и вход, устройства и KeyPackage, сообщества/каналы/категории/роли/участники/приглашения/баны, история сообщений с пагинацией по UUIDv7, файлы (presigned URL), звуки, профиль, друзья и блокировки, read-state, закрепы.
4. `docs/protocol/MESSAGES.md`: Protobuf-конверт application-сообщения MLS по типам (text, edit, delete, reaction, pin, file-key, call-key, history-keys), упоминания и mention-hint, ограничения размеров (текст 4 000 символов).
5. Коды ошибок: `PERMISSION_DENIED{missing_permission}`, `EPOCH_MISMATCH`, `CHANNEL_MEMBER_LIMIT`, `RATE_LIMITED{retry_after}`, `INVITE_EXPIRED`, `BANNED` и др. — с HTTP-статусами.
6. Рецепт `just gen` начинает работать для proto (Go и TS-генерация в `server/gen/` и `clients/web/src/gen/` — пути обосновать).

## Критерии готовности
- [ ] `buf lint` и `buf format` чистые; `just lint-proto` зелёный.
- [ ] Таблица в `docs/protocol/README.md`: каждый шаг каждого FLOWS-файла → вызов или событие. Непокрытых шагов нет или они записаны в OPEN-QUESTIONS.md.
- [ ] Имена полей и событий — только из GLOSSARY.md; hook clean room не срабатывает.
- [ ] `docs/protocol/README.md` обновлён: статусы файлов.

## Ограничения
Не воспроизводить сторонние схемы API, имена полей и коды. Ничего не реализовывать — только контракты и документацию.
