# B6. Сервер: messaging, gateway, files, push

Запуск: `/prompt B06`. Фаза 1. Зависит от B4, B5. Каталоги: `server/internal/{messaging,gateway,files,push}`.

## Роль
Go-бэкендер в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/protocol/GATEWAY.md, REST.md, MESSAGES.md
- docs/spec/ARCHITECTURE.md §4.4, §4.5, §4.8, §5.2, §5.4, §5.6
- docs/spec/FLOWS/06-messages.md, 05-dm.md
- docs/spec/PERMISSIONS.md (права 6–9)

## Задача
1. `messaging`: приём шифртекста с проверкой прав по отправителю, хранение, история с пагинацией по UUIDv7 (вместе с обёрнутыми ключами сообщений), хранение связок ключей истории по эпохам (ADR-0015), tombstone, закрепы (id), read-state, mention-hint и уведомления об упоминаниях, индикатор набора.
2. `gateway`: WSS, Identify/Ready, seq, heartbeat, Resume с буфером в Valkey, zstd, fan-out через NATS между репликами, rate limits.
3. `files`: presigned URL в S3 (MinIO), квоты, лимит размера инстанса, удаление при удалении сообщения.
4. `push`: реестр устройств, UnifiedPush (desktop-уведомления идут через gateway), payload только с id; FCM/APNs — заглушки за интерфейсом (мобильные после 1.0).

## Критерии готовности
- [ ] Интеграционный тест: два клиента-эмулятора обмениваются сообщениями через gateway, Resume после разрыва досылает пропущенное.
- [ ] Тест: тела запросов и записи в БД не содержат открытого текста (контрольные строки).
- [ ] Линт и тесты зелёные; STATUS.md.
