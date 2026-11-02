# STATUS — протокол (B01)

Модуль: `proto/bebeberloga/v1/`, `docs/protocol/`, `buf.yaml`, `buf.gen.yaml`, `redocly.yaml`. Промпт — `docs/prompts/B01-protocol.md`. Ветка `feat/B01-protocol`.

## Сделано (2026-11-02)

- Protobuf-схемы `bebeberloga.v1`: `common`, `error`, `identity`, `community`, `sound`, `message` (открытые метаданные), `envelope` (зашифрованный конверт), `gateway` (кадры, служебные сообщения, команды, события). `buf lint`, `buf format` чистые; `buf generate` удалёнными плагинами выдаёт Go и TS.
- `docs/protocol/GATEWAY.md`: транспорт и субпротоколы, `Identify` → `Ready` (состав), `seq`, heartbeat, `Resume` с буфером 5 минут, zstd по кадрам, лимиты и коды закрытия, адресация и список событий, команды (включая `PlaySound`).
- `docs/protocol/openapi.yaml` (OpenAPI 3.0.3, проходит `redocly lint`) и `REST.md`: соглашения, таблица ошибок с HTTP-статусами, коды прав, карта ресурсов, ключевые сценарии, генерация.
- `docs/protocol/MESSAGES.md`: конверт по типам, лимиты (текст 4 000), упоминания и mention-hint, семантика правок/удалений/реакций/закрепов, проверки на приёме, граница с B2.
- ADR-0016 (OpenAPI 3.0.3 + oapi-codegen + openapi-typescript; buf с удалёнными плагинами; UUIDv7 строкой; пути генерации).
- `docs/protocol/README.md`: статусы файлов и таблица покрытия FLOWS → вызов/событие.
- Инструменты: `buf` добавлен в `mise.toml`; рецепт `lint-proto` и CI-job `proto` пропускают `buf breaking`, пока в `main` нет `proto/`; `redocly.yaml` отключает правило `operation-4xx-response` (ошибки описаны одним ответом `default`).
- Ответы владельца на вопросы №2–6 записаны в `docs/spec/OPEN-QUESTIONS.md`.

## Технические допущения (не из спецификации, можно пересмотреть)

- Серверный mute/deafen — `PUT /channels/{id}/voice/members/{uid}/mute|deafen` + событие `VoiceStateUpdated` (OPEN-QUESTIONS №4, ответ владельца).
- Опрос статуса подтверждения email до входа — `GET /auth/register/status?registration_token=…` (токен из ответа регистрации на 1 час); FLOWS/01 ш. 4 допускает «событие или опрос», событий до входа нет.
- Повторный запрос подтверждения устройства после 10 минут — `POST /devices/me/verification/request`.
- Обмен коммитментами при подтверждении устройства — REST `POST /devices/{id}/verification/messages` → событие `DeviceVerificationMessage`; содержимое непрозрачно, формат задаёт B2.
- Сообщения о новых и удалённых устройствах и смене ключей («🐾 У имени новое устройство…») создаёт клиент владельца устройства как зашифрованное сообщение `DeviceNoticeBody`; сервер чужим пользователям `DeviceAdded/Removed` не рассылает.
- `broadcast_mention` (`@все`/`@здесь`) передаётся открыто — иначе сервер не может проверить `chat.ping_all` и посчитать бейджи. Хинты ролей — `HMAC(секрет канала, role_id)`, каждый участник регистрирует хинты своих ролей.
- `DeleteBody`/`PinBody` в группе дублируют REST-команды для офлайн-истории; модератор без текста удаляет только через REST.
- Незавершённое создание сообщества (FLOWS/03 ш. 5): клиент вызывает `DELETE /communities/{id}`; сервер дополнительно удаляет сообщества, у каналов которых за 1 час не появилось ни одной MLS-группы.
- ЛС — `Channel` типа `DM`, адресуется теми же `/channels/{id}/…`; `POST /users/me/dm-channels` идемпотентен для пары.
- Commit, Welcome, новый GroupInfo и связка ключей истории идут одним запросом `POST /mls/groups/{id}/handshakes` (атомарно). Блобы MLS в событиях gateway ограничены 256 КиБ, крупнее — через REST.
- Регистрация хинтов упоминаний — отдельный вызов `PUT /channels/{id}/mention-hints {epoch, hints[]}`; сервер хранит хинты двух последних эпох.
- Push-endpoint (S) — `PUT/DELETE /devices/me/push-endpoint`, реализация после 1.0.
- `PresenceSubscribe` — одно сообщество на соединение; присутствие участников сообщества приходит только для открытого сообщества, друзей — всегда.

## Сломано / не сделано

- `buf breaking` реально не выполняется, пока `proto/` не попадёт в `main` (намеренно).
- Сгенерированный код не закоммичен: каталоги `server/gen/` и `clients/web/src/gen/` появятся в B04 и B09 вместе с модулями (ADR-0016 п. 3).
- Конфигурация `oapi-codegen` (`server/oapi-codegen.yaml`) и `openapi-typescript` — в B04/B09.

## Дальше

- B02 (`CRYPTO.md`): формат KeyPackage/GroupInfo/handshake-блобов, ключ сообщения и обёртка ключом истории, `history_key_bundle`, секрет mention-hint, схема чанков файлов, `CallKeyBody`, коммитменты подтверждения устройства.
- B04: `oapi-codegen` по `openapi.yaml`, тест соответствия JSON-моделей Protobuf-схемам.
- B06: реализация gateway по `GATEWAY.md`.
- Открытый вопрос №7 (статус «проверен» собеседника между устройствами) — ответ контура A.
