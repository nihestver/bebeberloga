# REST API

Контракт — [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3); из него генерируются Go-обработчики и TS-клиент (`just gen`, [ADR-0016](../adr/0016-api-contracts.md)). Здесь — соглашения, ошибки, коды прав, карта ресурсов и ключевые сценарии. Модели — те же, что в Protobuf ([`proto/bebeberloga/v1`](../../proto/bebeberloga/v1)), в JSON-форме.

## 1. Соглашения

- База: `https://<инстанс>/api/v1`. Версия в пути; несовместимые изменения — новый префикс.
- Аутентификация: `Authorization: Bearer <access_token>`. Токен выдаёт `POST /auth/login`, живёт `expires_in` секунд, обновляется `POST /auth/refresh`. Без входа доступны: `GET /instance`, регистрация и подтверждение email, вход, восстановление пароля, `GET /users/availability`, `GET /invites/{code}`.
- Неподтверждённое устройство (`DEVICE_VERIFICATION_UNVERIFIED`) может: читать свой аккаунт и устройства, публиковать свои ключи и KeyPackage, запрашивать подтверждение, получать зашифрованный ключ идентичности для восстановления, принимать приглашения в сообщества (без доступа к группам). Остальные запросы к содержимому каналов — `DEVICE_UNVERIFIED`.
- JSON: имена полей `snake_case` (как в `.proto`), время — RFC 3339 в UTC, бинарные поля — base64, enum — строковые имена значений Protobuf (`CHANNEL_TYPE_TEXT`). Неизвестные поля в запросах игнорируются; в ответах могут появляться новые поля — клиент их терпит.
- Идентификаторы — UUIDv7 строкой. Пагинация — курсорами `before`/`after` по id, `limit` ≤ 100 (по умолчанию 50); ответ содержит `page.has_before`/`page.has_after`.
- Идемпотентность: `PUT`/`DELETE` идемпотентны; `POST /channels/{id}/messages` идемпотентен по клиентскому `id` сообщения; повтор с тем же `id` и тем же телом возвращает 201 с тем же результатом, с другим телом — `MESSAGE_EXISTS`.
- Тела запросов — `application/json`, кроме загрузки звуков (`multipart/form-data`) и аудио звука (`audio/ogg`). Вложения сообщений не проходят через API: они загружаются напрямую в хранилище по presigned URL.
- Частота запросов ограничивается по пользователю и по IP; при превышении — `RATE_LIMITED` с `retry_after_ms` и заголовком `Retry-After`.
- Каждый ответ с ошибкой — объект `Error` (ниже). Успешные ответы без тела — `204`.

## 2. Ошибки

Тело ошибки — `Error{code, message, missing_permission?, retry_after_ms?, limit?, current_epoch?, field_errors?, details?}` (`error.proto`). `message` — служебный текст для журналов; интерфейс показывает собственный локализованный текст по `code` в тоне `BRAND.md`.

| Код | HTTP | Когда | Дополнительно |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | Тело или параметры не прошли проверку | `field_errors[]{field, reason}` |
| `TOKEN_INVALID` | 400 | Ссылка из письма недействительна или истекла | |
| `SIGNATURE_INVALID` | 400 | Подпись ключа устройства не проверяется ключом идентичности | |
| `ATTACHMENT_INVALID` | 400 | Вложение не загружено, чужое или уже привязано | |
| `TOO_MANY_ATTACHMENTS` | 400 | Больше 10 вложений | `limit` |
| `SOUND_INVALID` | 400 | Звук длиннее 5 с или не ogg/mp3 | |
| `UNAUTHENTICATED` | 401 | Нет или истёк токен | |
| `INVALID_CREDENTIALS` | 401 | Неверные логин или пароль | |
| `PERMISSION_DENIED` | 403 | Нет права на действие | `missing_permission` — код права, клиент показывает «Не хватает права «<название>»» (PERMISSIONS.md §5) |
| `REGISTRATION_CLOSED` | 403 | Регистрация закрыта или нужен код приглашения инстанса | |
| `EMAIL_NOT_VERIFIED` | 403 | Вход до подтверждения email | |
| `PASSWORD_MISMATCH` | 403 | Неверный текущий пароль | |
| `DEVICE_UNVERIFIED` | 403 | Действие требует подтверждённого устройства | |
| `RECOVERY_KEY_INVALID` | 403 | Ключ восстановления не подошёл | |
| `BANNED` | 403 | Пользователь забанен в сообществе | |
| `INVITES_PAUSED` | 403 | Приглашения сообщества приостановлены | |
| `ROLE_HIERARCHY` | 403 | Действие против участника с равной или старшей ролью; выдача роли не младше своей | |
| `NOT_GROUP_MEMBER` | 403 | Устройство не состоит в MLS-группе | |
| `BLOCKED` | 403 | Собеседник заблокировал отправителя или заблокирован им | |
| `NOT_FOUND` | 404 | Объект не существует или скрыт от запрашивающего (приватный канал выглядит как несуществующий) | |
| `CONFLICT` | 409 | Общий конфликт состояния (повторное создание, удаление аккаунта владельца сообществ) | `details` |
| `USERNAME_TAKEN` | 409 | Имя занято | |
| `EMAIL_IN_USE` | 409 | На email уже есть аккаунт | |
| `NO_KEY_PACKAGES` | 409 | Нет свободных KeyPackage ни у одного устройства пользователя | |
| `CHANNEL_MEMBER_LIMIT` | 409 | Достигнут лимит участников канала (ADR-0005); текст в UI — о лимите участников, без упоминания шифрования | `limit` |
| `COMMUNITY_LIMIT` | 409 | Лимит сообществ на пользователя | `limit` |
| `OWNER_CANNOT_LEAVE` | 409 | Владелец пытается покинуть сообщество | |
| `PRESET_ROLE_IMMUTABLE` | 409 | Удаление или переименование пресета | |
| `VOICE_CHANNEL_FULL` | 409 | Голосовой канал полон | `limit` |
| `NOT_IN_VOICE` | 409 | Пользователь не в этом голосовом канале | |
| `RELATIONSHIP_EXISTS` | 409 | Запрос уже отправлен или уже друзья | |
| `EPOCH_MISMATCH` | 409 | Шифртекст или handshake для устаревшей эпохи | `current_epoch`; клиент догоняет commit-ы и повторяет (до 3 раз для сообщений) |
| `MESSAGE_EXISTS` | 409 | Повтор id сообщения с другим телом | |
| `SOUND_SLOTS_FULL` | 409 | Слоты звуков заняты | `limit` |
| `INVITE_EXPIRED` | 410 | Срок приглашения истёк | |
| `INVITE_REVOKED` | 410 | Приглашение отозвано | |
| `INVITE_USES_EXHAUSTED` | 410 | Лимит использований исчерпан | |
| `VERIFICATION_EXPIRED` | 410 | Запрос подтверждения устройства старше 10 минут | |
| `PAYLOAD_TOO_LARGE` | 413 | Тело, файл или кадр больше лимита | `limit` |
| `RATE_LIMITED` | 429 | Слишком много запросов | `retry_after_ms`, заголовок `Retry-After` |
| `INTERNAL` | 500 | Ошибка сервера | |
| `UNAVAILABLE` | 503 | Зависимость недоступна (медиасервер, хранилище) | заголовок `Retry-After` |

## 3. Коды прав

Список строк вида `<область>.<действие>` (PERMISSIONS.md §1; битовой маски нет). Сервер отдаёт клиенту уже вычисленные права (`EffectivePermissions`) — в `Ready`, `CommunitySnapshot` и событии `PermissionsUpdated`; клиент не вычисляет их сам.

| # | Код | Право (UI) |
|---|---|---|
| 1 | `community.admin` | Управлять сервером |
| 2 | `channel.see` | Видеть канал |
| 3 | `channel.edit` | Управлять каналами |
| 4 | `role.edit` | Управлять ролями |
| 5 | `invite.make` | Приглашать |
| 6 | `chat.post` | Писать |
| 7 | `chat.upload` | Отправлять вложения |
| 8 | `chat.ping_all` | Упоминать всех |
| 9 | `chat.moderate` | Управлять сообщениями |
| 10 | `member.remove` | Выгонять и банить |
| 11 | `voice.join` | Подключаться |
| 12 | `voice.talk` | Говорить |
| 13 | `voice.share` | Стримить |
| 14 | `voice.sounds` | Саундборд |
| 15 | `voice.moderate` | Заглушать других |

## 4. Карта ресурсов

| Группа | Методы | Назначение |
|---|---|---|
| Инстанс | `GET /instance`, `GET /gateway` | Политика регистрации, лимиты, адрес шлюза |
| Регистрация и вход | `POST /auth/register`, `GET /auth/register/status`, `POST /auth/email/verify`, `POST /auth/email/resend`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | FLOWS/01, FLOWS/02 |
| Пароль и email | `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/password/change`, `POST /auth/email/change`, `POST /auth/email/change/confirm` | Смена пароля завершает остальные сессии; смена email — с подтверждением на новый адрес (OPEN-QUESTIONS №2) |
| Профиль | `GET/PATCH/DELETE /users/me`, `GET /users/availability`, `GET /users/{id}`, `GET /users/{id}/devices` | Имя, аватар из набора, «о себе», цвет баннера; вкладка «Безопасность» чужого профиля |
| Ключи идентичности и восстановление | `PUT /users/me/identity-key`, `GET/PUT /users/me/recovery-key`, `GET /users/me/recovery-key/identity` | Публикация ключа; копия приватного ключа, зашифрованная ключом восстановления; «начать заново» |
| Устройства | `GET/DELETE /users/me/devices`, `PUT /devices/me/keys`, `PATCH/DELETE /devices/{id}`, `POST /devices/{id}/verify`, `POST /devices/{id}/reject`, `POST /devices/me/verification/request`, `POST /devices/{id}/verification/messages` | Подтверждение, выход, «это не я», обмен коммитментами |
| KeyPackage | `POST/GET /devices/me/key-packages`, `POST /users/{id}/key-packages/claim` | Склад одноразовых пакетов |
| Push (S) | `PUT/DELETE /devices/me/push-endpoint` | Схема есть, реализация после 1.0 (OPEN-QUESTIONS №3) |
| Друзья | `GET/POST /users/me/relationships`, `PUT/DELETE /users/me/relationships/{id}`, `PUT/DELETE /users/me/blocks/{id}` | FLOWS/05 |
| ЛС | `GET/POST /users/me/dm-channels`, `DELETE /users/me/dm-channels/{id}` | ЛС — канал типа DM |
| Сообщества | `POST /communities`, `GET/PATCH/DELETE /communities/{id}`, `POST …/leave`, `POST …/transfer-ownership`, `GET …/groups` | FLOWS/03, SCREENS/06 §5, SCREENS/11 §9–10 |
| Категории | `POST /communities/{id}/categories`, `PATCH/DELETE /categories/{id}` | |
| Каналы | `POST /communities/{id}/channels`, `GET/PATCH/DELETE /channels/{id}`, `GET/PUT /channels/{id}/access`, `POST /channels/{id}/mls/rotate` | «Кто видит канал», «Обновить ключи канала» |
| Роли | `GET/POST /communities/{id}/roles`, `PATCH/DELETE /roles/{id}`, `PUT /communities/{id}/members/{uid}/roles` | |
| Участники | `GET /communities/{id}/members`, `GET/DELETE /communities/{id}/members/{uid}` | Список с поиском; выгнать |
| Баны | `GET /communities/{id}/bans`, `PUT/DELETE /communities/{id}/bans/{uid}` | Бан с удалением сообщений за период |
| Приглашения | `GET/POST /communities/{id}/invites`, `GET /channels/{id}/invites`, `GET/DELETE /invites/{code}`, `POST /invites/{code}/accept` | FLOWS/04 |
| Сообщения | `GET/POST /channels/{id}/messages`, `GET/DELETE /channels/{id}/messages/{mid}`, `GET /channels/{id}/pins`, `PUT/DELETE /channels/{id}/pins/{mid}`, `PUT /channels/{id}/mention-hints` | FLOWS/06 |
| Состояние чтения | `PUT /channels/{id}/read-state`, `POST /communities/{id}/read-state`, `POST /users/me/read-state` | |
| Уведомления | `GET /users/me/notification-settings`, `PUT/DELETE /communities/{id}/notification-settings`, `PUT/DELETE /channels/{id}/notification-settings` | OPEN-QUESTIONS №6 |
| Файлы | `POST /files`, `GET/DELETE /files/{id}`, `POST /files/{id}/complete` | Presigned URL, вложения до лимита инстанса |
| MLS DS | `POST /mls/groups`, `GET /mls/groups/{id}`, `GET/POST /mls/groups/{id}/handshakes`, `GET /mls/groups/{id}/handshakes/{seq}`, `GET /mls/groups/{id}/group-info`, `GET/PUT /mls/groups/{id}/history-key-bundle`, `GET /mls/welcomes`, `DELETE /mls/welcomes/{group_id}` | Транспорт блобов; формат блобов — CRYPTO.md (B2) |
| Голос | `POST /channels/{id}/voice/join`, `POST /channels/{id}/voice/leave`, `PUT /channels/{id}/voice/members/{uid}/mute`, `PUT …/deafen` | Токен SFU; серверный mute/deafen (OPEN-QUESTIONS №4) |
| Саундборд | `GET /sounds/builtin`, `GET/POST /communities/{id}/sounds`, `GET/POST /users/me/sounds`, `GET/PATCH/DELETE /sounds/{id}`, `GET /sounds/{id}/audio` | FLOWS/09; команда «сыграть» — gateway |
| Внутренние | `POST /internal/media/webhooks` | Webhook SFU, общий секрет |

## 5. Ключевые сценарии

### Отправка сообщения

1. Клиент шифрует `MessageEnvelope` в текущей эпохе группы канала (MESSAGES.md), получает ключ сообщения и оборачивает его действующим ключом истории.
2. `POST /channels/{id}/messages {id, group_id, epoch, ciphertext, wrapped_message_key, history_key_generation, mention_hints[], broadcast_mention, attachment_ids[]}`.
3. Сервер проверяет: устройство в группе; эпоха текущая (иначе `EPOCH_MISMATCH{current_epoch}`); `chat.post`; `chat.upload`, если есть вложения; `chat.ping_all`, если `broadcast_mention ≠ NONE` или среди хинтов есть хинт роли — без права сообщение принимается, но без уведомлений; размер шифртекста ≤ 64 КиБ; в ЛС — отсутствие блокировки.
4. Сервер сохраняет метаданные и шифртекст, рассылает `MessageCreated`, считает упоминания по хинтам, шлёт push без текста.

### Вложение

`POST /files {channel_id, size, ciphertext_hash}` → `{attachment, upload_url, upload_headers}` → клиент делает `PUT upload_url` с шифртекстом → `POST /files/{id}/complete` → id вложения идёт в `attachment_ids` сообщения, а ключ, имя и тип — внутрь конверта (`FileRef`). Отмена — `DELETE /files/{id}`. Скачивание — `GET /files/{id}` → presigned URL. Blob без сообщения живёт 1 час.

### Вступление по приглашению

`GET /invites/{code}` (превью, ошибки приглашения) → `POST /invites/{code}/accept` → сервер добавляет участника с ролью «@все», рассылает `MemberJoined`, `CommunityCreated` новым устройствам и как external sender — Add-proposals (`MlsHandshake{from_external_sender}`) во все группы видимых каналов. Ближайший онлайн-участник коммитит; новичок получает `MlsWelcome`, забирает `GET /mls/groups/{id}/history-key-bundle` и читает историю `GET /channels/{id}/messages?before=…` (ADR-0015).

### Вход в голос

`POST /channels/{id}/voice/join` → `{sfu_url, token, call_group_id, call_group_exists}`. Если группы звонка нет, вошедший создаёт её `POST /mls/groups {channel_id, kind: GROUP_KIND_CALL, group_id: call_group_id}`; иначе ждёт `MlsWelcome` (сервер по webhook SFU шлёт Add-proposal, коммитит участник). Выход — `POST …/voice/leave` или разрыв с SFU (webhook) → Remove-proposal; последний вышедший — сервер удаляет группу.

### Delivery Service

- `POST /mls/groups` регистрирует группу и привязывает к каналу; вместе с ней — зашифрованный GroupInfo и начальная связка ключей истории.
- `POST /mls/groups/{id}/handshakes` принимает Proposal/Commit только для текущей эпохи; commit несёт Welcome новых устройств, новый GroupInfo и связку для новой эпохи **одним запросом** — состояние группы на сервере меняется атомарно. External commit (`HANDSHAKE_KIND_EXTERNAL_COMMIT`) связку не несёт: её обновляет первый участник по `MlsUpdateRequested{REASON_HISTORY_BUNDLE}`.
- Сервер не разбирает блобы MLS дальше заголовка, нужного для `epoch` и `kind`; содержимого сообщений и ключей у него нет.

## 6. Генерация кода

- Go (B4): `oapi-codegen` (Apache-2.0) с `strict-server` и `chi`; конфигурация — `server/oapi-codegen.yaml`, вывод `server/gen/api/`. Типы моделей для сущностей, у которых есть Protobuf-двойник, генерируются из OpenAPI как есть; соответствие полей обеспечивается одинаковыми именами и проверяется тестом в B4.
- TypeScript (B9): `openapi-typescript` + `openapi-fetch` (MIT), вывод `clients/web/src/gen/api.ts`.
- CI проверяет, что сгенерированный код не отстал от контракта (`just gen` + `git diff --exit-code`).
