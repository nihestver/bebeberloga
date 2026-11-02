# B7. Сервер: media (LiveKit), звонки, саундборд

Запуск: `/prompt B07`. Фаза 2. Зависит от B4, B5 (и S2). Каталог: `server/internal/media/`, `deploy/compose/` (сервисы LiveKit и coturn).

## Роль
Go-бэкендер реального времени в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/protocol/CRYPTO.md (медиа), GATEWAY.md; создать/дополнить docs/protocol/MEDIA.md
- docs/spec/ARCHITECTURE.md §4.6, §6.5 (транспорт), §8 (soundboard)
- docs/spec/PERMISSIONS.md (права 11–15)
- docs/spec/FLOWS/07-voice.md, 08-stream.md, 09-soundboard.md
- docs/adr/0008

## Задача
1. Токены LiveKit по правам: подключение (11), публикация микрофона/камеры (12), публикация треков стрима отдельным участником «стрим» (13); серверный mute/deafen (15) — запрет публикации.
2. Webhooks LiveKit → события VoiceStateUpdated и предложения Add/Remove в MLS-группу звонка (через `mls`); группа звонка создаётся первым вошедшим, удаляется после последнего.
3. Лимиты инстанса: максимальный пресет стрима, лимит участников голосового канала.
4. Саундборд (FLOWS/09): команда `PlaySound` — проверка права 14, присутствия в голосовом канале, существования звука и кулдауна 2 с по пользователю (Valkey), рассылка `SoundPlayed` участникам канала; загрузка, лимиты и слоты звуков сообщества и личных звуков.
5. `docs/protocol/MEDIA.md`; сервисы `livekit` и `coturn` в compose с портами из WORKFLOW (уточнить).

## Критерии готовности
- [ ] Интеграционный тест с LiveKit в Docker: токены с правильными правами, webhook меняет состав группы звонка.
- [ ] Ревью security-reviewer; линт и тесты зелёные; STATUS.md.
