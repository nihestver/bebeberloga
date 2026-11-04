# REST API

Контракт — [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3, Apache-2.0); из него генерируются Go-обработчики и TS-клиент (`just gen`, [ADR-0017](../adr/0017-api-contracts.md)). Здесь — соглашения, ошибки, коды прав, карта ресурсов и ключевые сценарии. Модели — Protobuf-сообщения [`proto/bebeberloga/v1`](../../proto/bebeberloga/v1) в JSON-форме.

## 1. Соглашения

- База: `https://<инстанс>/api/v1`. Версия в пути; несовместимые изменения — новый префикс.
- Аутентификация: `Authorization: Bearer <access_token>`. Токен выдаёт `POST /auth/login`, живёт `expires_in` секунд, обновляется `POST /auth/refresh`. Без входа доступны: `GET /instance`, регистрация, статус и подтверждение email, вход, восстановление пароля, `GET /users/availability`, `GET /invites/{code}`.
- Неподтверждённое устройство (`DEVICE_VERIFICATION_UNVERIFIED`) может: читать свой аккаунт и устройства, публиковать свои ключи и KeyPackage, запрашивать подтверждение, получать зашифрованный ключ идентичности для восстановления, принимать приглашения в сообщества (без доступа к группам). Остальные запросы к содержимому каналов — `DEVICE_UNVERIFIED`.
- JSON — форма protojson с именами полей как в `.proto` (`snake_case`): время — RFC 3339 в UTC, байты — base64, enum — строковые имена значений Protobuf (`CHANNEL_TYPE_TEXT`, `ERROR_CODE_PERMISSION_DENIED`), 64-битные целые в телах — строки (`"epoch": "17"`), в параметрах пути и запроса — числа. Неизвестные поля в запросах игнорируются; в ответах могут появляться новые поля — клиент их терпит.
- Схемы с `x-proto-message`/`x-proto-enum` в коде заменяются типами, сгенерированными из Protobuf (`x-go-type` для Go; импорт `*_pb` для TS, ADR-0017 п. 2). Схемы без этой пометки — тела запросов и обёртки списков, они есть только в REST.
- Идентификаторы — UUIDv7 строкой. Пагинация — курсорами `before`/`after` по id, `limit` ≤ 150 (по умолчанию 50, SCREENS/08 §1); ответ содержит `page.has_before`/`page.has_after`.
- Идемпотентность: `PUT`/`DELETE` идемпотентны; `POST /channels/{id}/messages` идемпотентен по клиентскому `id` сообщения: повтор с тем же `id` и тем же телом возвращает 201 с тем же результатом, с другим телом — `MESSAGE_EXISTS`.
- Тела запросов — `application/json`, кроме загрузки звуков (`multipart/form-data`) и аудио звука (`audio/ogg`). Вложения сообщений не проходят через API: они загружаются напрямую в хранилище по presigned URL.
- Частота запросов ограничивается по пользователю и по IP; при превышении — `RATE_LIMITED` с `retry_after_ms` и заголовком `Retry-After`.
- Каждый ответ с ошибкой — объект `Error` (ниже). Успешные ответы без тела — `204`.

## 2. Ошибки

Тело ошибки — `Error{code, message, missing_permission?, retry_after_ms?, limit?, current_epoch?, field_errors?, details?}` (`error.proto`). `message` — служебный текст для журналов; интерфейс показывает собственный локализованный текст по `code` в тоне `BRAND.md`. В таблице коды даны без префикса `ERROR_CODE_`, на проводе — с ним.

| Код | HTTP | Когда | Дополнительно |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | Тело или параметры не прошли проверку | `field_errors[]{field, reason}` |
| `MESSAGE_ID_OUT_OF_WINDOW` | 400 | Время в UUIDv7 сообщения старше 30 сут или опережает время приёма больше чем на 5 мин (CRYPTO.md §6.2.8) | клиент присваивает новый `id` |
| `TOKEN_INVALID` | 400 | Ссылка из письма недействительна или истекла | |
| `SIGNATURE_INVALID` | 400 | Подпись ключа устройства не проверяется ключом идентичности | |
| `INVALID_KEY_PACKAGE` | 400 | KeyPackage не прошёл проверки DS (CRYPTO.md §1.4) | |
| `EXTERNAL_COMMIT_UNSUPPORTED` | 400 | `HANDSHAKE_KIND_EXTERNAL_COMMIT`: external commit в 1.0 не используется (ADR-0019) | |
| `BAD_DELTA` | 400 | `RosterDelta` commit-а не разбирается или не сходится с ожидаемым (CRYPTO.md §2.3–§2.4) | |
| `BAD_WELCOME` | 400 | Адресаты Welcome не совпадают с добавленными устройствами или пакет на исходе | |
| `BAD_MESSAGE` | 400 | Вид MLS-сообщения не соответствует запросу (`kind`, wire format, `content_type`) | |
| `ATTACHMENT_INVALID` | 400 | Вложение не загружено, чужое или уже привязано | |
| `TOO_MANY_ATTACHMENTS` | 400 | Больше 10 вложений | `limit` |
| `SOUND_INVALID` | 400 | Звук не Opus/ogg или длиннее 5 с (исходные ogg/mp3 проверяет и перекодирует клиент, FLOWS/09 ш. 2) | |
| `UNAUTHENTICATED` | 401 | Нет или истёк токен | |
| `INVALID_CREDENTIALS` | 401 | Неверные логин или пароль | |
| `PERMISSION_DENIED` | 403 | Нет права на действие | `missing_permission` — код права, клиент показывает «Не хватает права «<название>»» (PERMISSIONS.md §5) |
| `REGISTRATION_CLOSED` | 403 | Регистрация закрыта или нужен код приглашения инстанса | |
| `EMAIL_NOT_VERIFIED` | 403 | Вход до подтверждения email | |
| `PASSWORD_MISMATCH` | 403 | Неверный текущий пароль | |
| `DEVICE_UNVERIFIED` | 403 | Действие требует подтверждённого устройства | |
| `BANNED` | 403 | Пользователь забанен в сообществе | |
| `INVITES_PAUSED` | 403 | Приглашения сообщества приостановлены | |
| `ROLE_HIERARCHY` | 403 | Действие против участника с равной или старшей ролью; выдача роли не младше своей | |
| `NOT_GROUP_MEMBER` | 403 | Устройство не состоит в MLS-группе | |
| `UNAUTHORIZED_CHANGE` | 403 | Изменение состава без предложения сервера; предложение от участника | |
| `BLOCKED` | 403 | Собеседник заблокировал отправителя или заблокирован им | |
| `NOT_FOUND` | 404 | Объект не существует или скрыт от запрашивающего (приватный канал выглядит как несуществующий) | |
| `CONFLICT` | 409 | Общий конфликт состояния (повторное создание, удаление аккаунта владельца сообществ) | `details` |
| `USERNAME_TAKEN` | 409 | Имя занято | |
| `EMAIL_IN_USE` | 409 | На email уже есть аккаунт | |
| `NO_KEY_PACKAGES` | 409 | Нет свободных KeyPackage ни у одного устройства пользователя | |
| `CHANNEL_MEMBER_LIMIT` | 409 | Достигнут лимит участников канала (ADR-0005); текст в UI — о лимите участников, без упоминания шифрования | `limit` |
| `COMMUNITY_LIMIT` | 409 | Лимит сообществ на пользователя | `limit` |
| `OWNER_CANNOT_LEAVE` | 409 | Владелец пытается покинуть сообщество | |
| `PRESET_ROLE_IMMUTABLE` | 409 | Удаление или переименование пресета (PERMISSIONS §2, SCREENS/11 §4.2) | |
| `VOICE_CHANNEL_FULL` | 409 | Голосовой канал полон | `limit` |
| `NOT_IN_VOICE` | 409 | Пользователь не в этом голосовом канале | |
| `RELATIONSHIP_EXISTS` | 409 | Запрос уже отправлен или уже друзья | |
| `EPOCH_MISMATCH` | 409 | Handshake для устаревшей эпохи | `current_epoch`; клиент догоняет commit-ы и собирает commit заново (CRYPTO.md §2.13). Сообщения эпохой не проверяются: для них — `HISTORY_GENERATION_MISMATCH` |
| `MESSAGE_EXISTS` | 409 | Повтор id сообщения с другим телом | |
| `PROPOSALS_MISSING` | 409 | В commit не вошли все опубликованные сервером Remove | |
| `REMOVAL_PENDING` | 409 | Commit от устройства, для которого опубликован Remove | |
| `ALREADY_MEMBER` | 409 | Заявка на вход устройства, которое уже в группе | |
| `GROUP_FROZEN` | 409 | MLS-группа заморожена или заменена новой при пересоздании (CRYPTO.md §2.10) | `successor_group_id`, если замена уже есть |
| `IDENTITY_RESET_PENDING` | 409 | Сброс ключа идентичности ещё не применим — идёт задержка 24 ч (CRYPTO.md §6.3.9) | `retry_after_ms` |
| `IDENTITY_RESET_LIMITED` | 429 | Запрос сброса сейчас ограничен: после «Это не я» — не раньше чем через 24 ч и не больше 3 за 7 сут (CRYPTO.md §6.3.9) | `retry_after_ms`; новое устройство показывает «Сброс ключей сейчас недоступен…» (SCREENS/07 §4); о запросах, отклонённых лимитом, — письмо на email аккаунта не чаще раза в сутки |
| `HISTORY_GENERATION_MISMATCH` | 409 | Сообщение обёрнуто не текущим поколением ключа истории канала (CRYPTO.md §6.2.8) | `current_generation`; клиент догоняет commit-ы и повторяет (до 3 раз) |
| `NOT_DESIGNATED` | 409 | Commit не от устройства, назначенного DS на эту эпоху (CRYPTO.md §2.6), или `GET …/recreation`, `POST …/recreation/key-packages` и `POST /mls/groups` при пересоздании не от назначенного создателя (§2.10.5) | |
| `GROUP_UNDER_REVIEW` | 409 | Идёт проверка спорного commit-а: commit-ы приостановлены, сообщения принимаются (CRYPTO.md §2.9.3) | |
| `SOUND_SLOTS_FULL` | 409 | Слоты звуков заняты | `limit` |
| `INVITE_EXPIRED` | 410 | Срок приглашения истёк | |
| `INVITE_REVOKED` | 410 | Приглашение отозвано | |
| `INVITE_USES_EXHAUSTED` | 410 | Лимит использований исчерпан | |
| `VERIFICATION_EXPIRED` | 410 | Запрос подтверждения устройства старше 10 минут | |
| `PAYLOAD_TOO_LARGE` | 413 | Тело, файл или кадр больше лимита | `limit` |
| `RATE_LIMITED` | 429 | Слишком много запросов | `retry_after_ms`, заголовок `Retry-After` |
| `INTERNAL` | 500 | Ошибка сервера | |
| `UNAVAILABLE` | 503 | Зависимость недоступна (медиасервер, хранилище) | заголовок `Retry-After` |

Ошибки ключа восстановления серверного кода не имеют: ключ проверяет только клиент при расшифровке (FLOWS/02 ш. 5).

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

Форма ресурсов выведена из FLOWS и PERMISSIONS: каждая сущность GLOSSARY — ресурс, действие над участником сообщества — подресурс сообщества, действие над каналом — подресурс канала. Это обычные REST-соглашения «ресурс / подресурс», обоснование — STATUS.md «Форма REST и состав Ready».

| Группа | Методы | Назначение |
|---|---|---|
| Инстанс | `GET /instance`, `GET /gateway` | Политика регистрации, лимиты, адрес шлюза |
| Регистрация и вход | `POST /auth/register`, `GET /auth/register/status`, `POST /auth/email/verify`, `POST /auth/email/resend`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | FLOWS/01, FLOWS/02 |
| Пароль и email | `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/password/change`, `POST /auth/email/change`, `POST /auth/email/change/confirm` | Смена пароля завершает остальные сессии, устройства и ключи остаются; смена email — с подтверждением на новый адрес (OPEN-QUESTIONS №2) |
| Профиль | `GET/PATCH/DELETE /users/me`, `GET /users/availability`, `GET /users/{id}`, `GET /users/{id}/devices` | Имя, аватар из набора, «о себе», цвет баннера; вкладка «Безопасность» чужого профиля (только открытые данные устройств) |
| Ключи идентичности и восстановление | `PUT /users/me/identity-key`, `GET/PUT /users/me/recovery-key`, `GET /users/me/recovery-key/identity` | Публикация ключа; копия приватного ключа, зашифрованная ключом восстановления; «начать заново» |
| Устройства | `GET/DELETE /users/me/devices`, `GET /users/{id}/devices?include_removed=`, `GET /users/{id}/identity-keys`, `GET/POST/DELETE /users/me/identity-reset`, `GET /users/me/personal-backup`, `PUT /devices/me/keys`, `PATCH/DELETE /devices/{id}`, `POST /devices/{id}/verify`, `POST /devices/{id}/reject`, `POST /devices/me/verification/request`, `POST /devices/{id}/verification/messages` | Подтверждение, выход, «это не я», обмен коммитментами; история ключей идентичности и записи удалённых устройств хранятся навсегда; отложенный сброс ключей (CRYPTO.md §6.2.8, §6.3.9) |
| KeyPackage | `POST/GET /devices/me/key-packages`, `POST /users/{id}/key-packages/claim` | Склад одноразовых пакетов |
| Push (S) | `PUT/DELETE /devices/me/push-endpoint` | Схема есть, реализация после 1.0 (OPEN-QUESTIONS №3) |
| Друзья | `GET/POST /users/me/relationships`, `PUT/DELETE /users/me/relationships/{id}`, `PUT/DELETE /users/me/blocks/{id}` | FLOWS/05 |
| ЛС | `GET/POST /users/me/dm-channels`, `DELETE /users/me/dm-channels/{id}` | ЛС — канал типа DM с `participant_ids` |
| Сообщества | `POST /communities`, `GET/PATCH/DELETE /communities/{id}`, `POST …/leave`, `POST …/transfer-ownership`, `GET …/groups`, `GET /users/me/community-removals`, `DELETE /users/me/community-removals/{community_id}` | FLOWS/03, SCREENS/06 §5, SCREENS/11 §9–10; записи «тебя выгнали» для офлайн-устройств |
| Категории | `POST /communities/{id}/categories`, `PATCH/DELETE /categories/{id}` | |
| Каналы | `POST /communities/{id}/channels`, `GET/PATCH/DELETE /channels/{id}`, `GET/PUT /channels/{id}/access`, `POST /channels/{id}/access/self`, `POST /channels/{id}/mls/rotate` | «Кто видит канал», самодобавление владельца/администратора в приватный канал, «Обновить ключи канала» |
| Роли | `GET/POST /communities/{id}/roles`, `PATCH/DELETE /roles/{id}`, `PUT /communities/{id}/members/{uid}/roles` | |
| Участники | `GET /communities/{id}/members`, `GET/DELETE /communities/{id}/members/{uid}` | Список с поиском; выгнать |
| Баны | `GET /communities/{id}/bans`, `PUT/DELETE /communities/{id}/bans/{uid}` | Бан с удалением сообщений за период |
| Приглашения | `GET/POST /communities/{id}/invites`, `GET /channels/{id}/invites`, `GET/DELETE /invites/{code}`, `POST /invites/{code}/accept` | FLOWS/04 |
| Сообщения | `GET/POST /channels/{id}/messages`, `GET/DELETE /channels/{id}/messages/{mid}`, `GET /channels/{id}/pins`, `PUT/DELETE /channels/{id}/pins/{mid}`, `PUT /users/me/mention-hints` (`PUT /channels/{id}/mention-hints` — `deprecated`), `GET /channels/{id}/history-key-links`, `GET /channels/{id}/history-generations` | FLOWS/06; CRYPTO.md §6 |
| Состояние чтения | `PUT /channels/{id}/read-state`, `POST /communities/{id}/read-state`, `POST /users/me/read-state` | |
| Уведомления | `GET /users/me/notification-settings`, `PUT/DELETE /communities/{id}/notification-settings`, `PUT/DELETE /channels/{id}/notification-settings` | OPEN-QUESTIONS №6 |
| Файлы | `POST /files`, `GET/DELETE /files/{id}`, `POST /files/{id}/complete` | Presigned URL, вложения до лимита инстанса |
| MLS DS | `POST /mls/groups`, `GET /mls/groups/{id}`, `GET/POST /mls/groups/{id}/handshakes`, `GET /mls/groups/{id}/handshakes/{seq}`, `GET /mls/groups/{id}/history-key-bundle`, `GET /mls/groups/{id}/roster`, `POST /mls/groups/{id}/disputes`, `POST /mls/groups/{id}/handshakes/{seq}/ack`, `POST /mls/groups/{id}/resync`, `GET /mls/groups/{id}/recreation`, `POST /mls/groups/{id}/recreation/key-packages`, `GET /mls/welcomes`, `DELETE /mls/welcomes/{group_id}`; `GET /mls/groups/{id}/group-info` и `PUT …/history-key-bundle` — `deprecated`, в 1.0 не используются (ADR-0019) | Транспорт блобов, карта состава, жалобы, пересоздание; формат и правила — CRYPTO.md §1–§2 |
| Голос | `POST /channels/{id}/voice/join`, `POST /channels/{id}/voice/leave`, `POST /channels/{id}/voice/members/{uid}/mute`, `POST …/deafen` | Токен SFU; серверный mute/deafen (OPEN-QUESTIONS №4) |
| Саундборд | `GET /sounds/builtin`, `GET/POST /communities/{id}/sounds`, `GET/POST /users/me/sounds`, `GET/PATCH/DELETE /sounds/{id}`, `GET /sounds/{id}/audio` | FLOWS/09; команда «сыграть» — gateway |
| Внутренние | `POST /internal/media/webhooks` | Webhook SFU, общий секрет |
| Админ-API (заготовка для B16, в `openapi.yaml` пока нет) | `GET /admin/channels/{id}/recreation`, `POST /admin/channels/{id}/recreation/repeat {creator_device_id}` | Неудавшееся пересоздание канала и ручной повтор с явным создателем (CRYPTO.md §2.10.11): команда админ-CLI оператора инстанса, не право сообщества; DS проверяет, что пересоздание помечено неудавшимся, а создатель — устройство начального состава без ожидающего Remove |

## 5. Ключевые сценарии

### Отправка сообщения

1. Клиент подписывает `MessageEnvelope` ключом устройства, шифрует случайным ключом сообщения в `SealedMessage` и оборачивает ключ сообщения подключом текущего поколения ключа истории (CRYPTO.md §6.2). MLS в отправке сообщения не участвует.
2. `POST /channels/{id}/messages {id, group_id, epoch, ciphertext, wrapped_message_key, history_key_generation, mention_hints[], broadcast_mention, attachment_ids[]}`.
3. Сервер проверяет: устройство в группе; поколение ключа истории текущее (иначе `HISTORY_GENERATION_MISMATCH{current_generation}`; смена эпохи без нового поколения отправку не прерывает); `chat.post`; `chat.upload`, если есть вложения; `chat.ping_all`, если `broadcast_mention ≠ BROADCAST_MENTION_NONE` или среди хинтов есть хинт роли — без права сообщение принимается, но без уведомлений; размер шифртекста ≤ 128 КиБ; в ЛС — отсутствие блокировки.
4. Сервер сохраняет метаданные (включая `size`) и шифртекст, рассылает `MessageCreated`, считает упоминания по хинтам, шлёт push без текста.

### Вложение

`POST /files {channel_id, size, ciphertext_hash}` → `{attachment, upload_url, upload_headers}` → клиент делает `PUT upload_url` с шифртекстом → `POST /files/{id}/complete` → id вложения идёт в `attachment_ids` сообщения, а ключ, имя и тип — внутрь конверта (`FileRef`). Отмена — `DELETE /files/{id}`. Скачивание — `GET /files/{id}` → presigned URL. Blob без сообщения живёт 1 час.

### Вступление по приглашению

`GET /invites/{code}` (превью, ошибки приглашения) → `POST /invites/{code}/accept` → сервер добавляет участника с ролью «@все», рассылает `MemberJoined`, `CommunityCreated` новым устройствам и как external sender — Add-proposals (`MlsHandshake{from_external_sender}`) во все группы видимых каналов. Commit делает онлайн-участник, которого назначает DS (`MlsUpdateRequested.designated_device_id`, CRYPTO.md §2.6); если в группе никого нет в сети, вход ждёт его появления (ADR-0019). Новичок получает `MlsWelcome` (с мостом, если есть), забирает `GET /mls/groups/{id}/history-key-bundle?epoch=` и ссылки `GET /channels/{id}/history-key-links`, затем читает историю `GET /channels/{id}/messages?before=…` (ADR-0015, CRYPTO.md §6.3.8).

### Вход в голос

`POST /channels/{id}/voice/join` → `{sfu_url, token, call_group_id, call_group_exists, voice_presence{connecting: true}}`. Если группы звонка нет, вошедший создаёт её `POST /mls/groups {channel_id, kind: GROUP_KIND_CALL, group_id: call_group_id}`; иначе ждёт `MlsWelcome`: сервер публикует Add-proposal сразу в ответ на `voice/join`, не дожидаясь подключения к SFU, коммитит назначенный участник звонка (CRYPTO.md §5.1), а клиент тем временем подключается к SFU. Подтверждение подключения приходит webhook-ом от SFU → `VoicePresenceChanged{connecting: false}`. Webhook SFU нужен для сверки состава и Remove: `POST …/voice/leave` — Remove сразу; обрыв с SFU без переподключения за 30 с или не подключился к SFU за 15 с после входа — Remove; последний вышедший — сервер удаляет группу.

### Delivery Service

Правила DS — CRYPTO.md §2; здесь — как они ложатся на REST.

- `POST /mls/groups` регистрирует группу, привязывает к каналу и принимает начальную связку ключей истории. При пересоздании замороженной группы (`predecessor_group_id`) тем же запросом идут начальный commit и Welcome; DS принимает ровно одну новую группу на замороженную (CRYPTO.md §2.10.5).
- `POST /mls/groups/{id}/handshakes` принимает только commit участника (`PrivateMessage`, ADR-0016 п. 2) и только для текущей эпохи; commit несёт Welcome новых устройств, связку для новой эпохи, ссылку цепочки ключей истории при ротации, мосты входящим устройствам и (в личной группе) резервную копию поколения **одним запросом** — состояние группы на сервере меняется атомарно (CRYPTO.md §6.3). DS по `RosterDelta.history_change` ведёт текущее поколение ключа истории канала. Предложения публикует только сервер как external sender (`PublicMessage` с `ProposalAAD`, CRYPTO.md §2.3); предложение участника — `UNAUTHORIZED_CHANGE`.
- **External commit в 1.0 не используется, GroupInfo сервер не хранит** (ADR-0019): на `HANDSHAKE_KIND_EXTERNAL_COMMIT` — `EXTERNAL_COMMIT_UNSUPPORTED`; `GET …/group-info`, `PUT …/history-key-bundle`, поля `encrypted_group_info` помечены `deprecated`.
- Commit делает устройство, которое назначает DS (`MlsUpdateRequested.designated_device_id`); при подтверждении нового устройства — в первую очередь подтвердившее (CRYPTO.md §2.6).
- Сервер читает лишь открытый заголовок и `authenticated_data` (`RosterDelta`): по ним он ведёт карту состава (`GET …/roster`, `Handshake.roster_hash`), проверяет, что вошли все опубликованные Remove, и считает лимит листьев. Проверить содержимое commit-а он не может — это делают клиенты, а при отказе подают жалобу (`POST …/disputes`). Commit принимается только от назначенного устройства (`NOT_DESIGNATED`). На любую жалобу с любой причиной DS считает голоса пользователей, подтвердивших commit и пожаловавшихся на него (CRYPTO.md §2.9.2–§2.9.3), — не больше одного подсчёта в группе сразу: если commit последний — с паузой handshake (`GROUP_UNDER_REVIEW`), иначе без паузы; сообщения идут, устройства, применившие спорный commit, отвечают `POST …/handshakes/{seq}/ack`. По итогам DS возвращает пожаловавшихся, откладывает пересоздание сверх лимита или замораживает группу (`GROUP_FROZEN`), и назначенный участник пересоздаёт её (`GET …/recreation`, `POST …/recreation/key-packages`, `POST /mls/groups`). Все смены состояния — событие `MlsGroupStateChanged`.
- Устройство, не подключавшееся дольше горизонта офлайна (30 сут), получает `Ready.device_returning` и возвращается в группы парой Remove + Add; клиент, которому не хватает состояния, просит то же для одной группы — `POST …/resync` (CRYPTO.md §2.11).
- Содержимого сообщений и ключей у сервера нет.

## 6. Генерация кода

- **Go (B4)**: `oapi-codegen` (Apache-2.0), режим `strict-server` поверх `chi`; конфигурация `server/oapi-codegen.yaml`, вывод `server/gen/api/`. Схемы с `x-go-type`/`x-go-type-import` генератор не создаёт заново, а подставляет тип из `server/gen/bebeberloga/v1` (вывод `buf generate`). Сериализация этих типов — `protojson` с `UseProtoNames: true`, `EmitDefaultValues: true`: скаляры, списки и enum с нулевым значением выводятся, поэтому поля из `required` в ответе есть всегда, а незаданные сообщения (`Timestamp` и т. п.) и незаданные ветки `oneof` не выводятся вовсе — они и не входят в `required`. нулевое значение enum (`*_UNSPECIFIED`) тоже выводится и означает «не задано» — например, `UserProfile.relationship` у пользователя без связи или `Channel.history_visibility` у ЛС, — поэтому оно есть в каждом списке `enum`; пустая строка у необязательного id — тоже «не задано» (схема `Id`); тела запросов без Protobuf-двойника — обычный `encoding/json`.
- **TypeScript (B9)**: `openapi-typescript` + `openapi-fetch` (MIT), вывод `clients/web/src/gen/api.ts`. Хук `transform` заменяет схемы с `x-proto-message`/`x-proto-enum` на импорт соответствующего типа из `clients/web/src/gen/bebeberloga/v1/*_pb.ts` (вывод `protoc-gen-es`); JSON разбирается через `fromJson`/`toJson` библиотеки `@bufbuild/protobuf`.
- Тест в B4 сверяет для каждой схемы с `x-proto-message` список полей и их типы с дескриптором Protobuf, чтобы OpenAPI-описание не разъехалось с источником.
- CI проверяет, что сгенерированный код не отстал от контракта (`just gen` + `git diff --exit-code`).
