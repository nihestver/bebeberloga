# Протокол

Каталог заполняется промптами B1 (транспорт и схемы) и B2 (криптографический дизайн) в фазе 0–1. Контракты, решённые планом и ADR, не пересматриваются без нового ADR. Состояние работ — [`STATUS.md`](STATUS.md).

## Состав

| Файл | Что содержит | Промпт | Статус |
|---|---|---|---|
| [`GATEWAY.md`](GATEWAY.md) | WebSocket-шлюз: `Identify` → `Ready`, события с монотонным `seq`, heartbeat, `Resume(seq)` с буфером 5 минут, сжатие zstd, лимиты и коды закрытия 41xx, адресация событий, команды клиента (включая `PlaySound`), шардинг по пользователю | B1 | черновик 2 (после ревью), готов для B6 |
| [`REST.md`](REST.md) + [`openapi.yaml`](openapi.yaml) | Контракт REST (OpenAPI 3.0.3, Apache-2.0), из которого генерируются обработчики и клиент (`just gen`, ADR-0017); модели — Protobuf через `x-proto-message`/`x-go-type`: учётная запись, устройства и KeyPackage, сообщества/каналы/роли/участники/приглашения/баны, история сообщений (пагинация по UUIDv7), файлы, MLS DS, голос, саундборд, уведомления; таблица ошибок и коды прав | B1 | черновик 2, `redocly lint` чистый |
| [`MESSAGES.md`](MESSAGES.md) | Конверт application-сообщения MLS по типам (text, edit, delete, reaction, pin, file-key, call-key, history-keys, device-notice; poll-vote зарезервирован), упоминания и mention-hint, лимиты (текст 4 000, шифртекст 128 КиБ) | B1 (крипто-часть — B2) | черновик 2 |
| [`CRYPTO.md`](CRYPTO.md) | MLS-профиль, ключи идентичности и устройств, Delivery Service (карта состава, назначенный коммитер, жалобы, пересоздание группы, горизонт офлайна, ключ инстанса), вывод SFrame-ключей, ключи истории и связки, формат блобов, формальные инварианты | B2 | черновик 1: §0–§5, §7, §8 (без §6) и инварианты I1–I33; §6 и §9 — после решений по Р1, Р2, Р4, Р5 |
| `MEDIA.md` | Комнаты SFU, токены с правами, webhooks, смена эпохи звонка, лимиты качества стрима | B7 (контракт `voice/*` и `PlaySound`/`SoundPlayed` уже в REST и gateway) | не начат |
| [`../../proto/`](../../proto/bebeberloga/v1) | Protobuf-схемы `bebeberloga.v1` — единственный источник моделей для Go/TS/Kotlin/Swift: `common`, `error`, `identity`, `community`, `sound`, `message`, `envelope`, `mls`, `gateway` | B1 | черновик 2, `buf lint` чистый |

## Уже зафиксировано

- MLS RFC 9420 через OpenMLS; ciphersuite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (0x0001); credential Basic. Одна группа на DM, групповой DM, текстовый канал, приватную ветку, активный звонок ([ADR-0004](../adr/0004-e2ee-mls-sframe.md)).
- Сервер = Delivery Service + Authentication Service: принимает commit только для текущей эпохи; external-sender-предложения Add/Remove по правам; commit делает онлайн-участник, которого назначает DS. External commit и GroupInfo в 1.0 не используются: любой вход — Add сервера и commit участника, возврат после горизонта офлайна — Remove + Add, рассинхрон — пересоздание группы канала ([ADR-0019](../adr/0019-no-external-commit-1-0.md), `CRYPTO.md` §2). Ротация эпохи при смене состава и не реже раза в сутки.
- Лимит участников канала по умолчанию 2 000 ([ADR-0005](../adr/0005-channel-member-limit.md)).
- История видна всем, кто видит канал, через ключи истории канала ([ADR-0015](../adr/0015-history-visible-to-members.md)).
- Файлы: XChaCha20-Poly1305 чанками по 1 МиБ, presigned URL в S3, ключ и хэш — в MLS-сообщении; превью генерирует отправитель.
- Push: только id группы и сообщения (UnifiedPush, FCM, APNs).
- Упоминания: `mention-hint` = HMAC(id упоминаемого, секрет канала из MLS exporter) в открытых метаданных сообщения; сервер сравнивает с хинтами участников, не узнавая адресата.
- Удаление и редактирование — новые MLS-сообщения по id; сервер ставит tombstone на шифртекст по команде автора или модератора.
- Стрим: отдельный участник «стрим» в комнате звонка; SFU пересылает только подписавшимся; simulcast из двух слоёв; H.264 всегда, HEVC/AV1 — если все зрители декодируют ([ADR-0008](../adr/0008-stream-media-engine.md)).
- Soundboard: звуки — публичные ассеты; команда `PlaySound` идёт через gateway, сервер проверяет право 14, присутствие в канале и кулдаун и рассылает `SoundPlayed`; каждый клиент играет локальную копию.
- Модель данных ядра — [`docs/spec/ARCHITECTURE.md`](../spec/ARCHITECTURE.md) раздел 5.3.
- Контракты: OpenAPI 3.0.3 поверх Protobuf-моделей (`x-proto-message`/`x-go-type`), `oapi-codegen`/`openapi-typescript`, Protobuf через buf с удалёнными плагинами, id — UUIDv7 строкой, JSON — protojson, сгенерированный код коммитится ([ADR-0017](../adr/0017-api-contracts.md)).

## Покрытие пользовательских потоков

Каждый шаг `docs/spec/FLOWS/*.md`, в котором участвует сервер, сопоставлен с вызовом REST или событием/командой gateway. Шаги только на клиенте помечены «клиент». Сверх FLOWS покрыты требования PERMISSIONS §3 п. 2 («🔒 закрытый для тебя») и показ «тебя выгнали» после долгого офлайна. Допущения и собственные числовые значения — в [`STATUS.md`](STATUS.md).

### 01 — Регистрация и первый вход

| Шаг | Вызов или событие |
|---|---|
| 1 Экран входа, политика инстанса | `GET /instance` (`registration_policy`) |
| 2 Проверка имени при вводе | `GET /users/availability?username=` |
| 3 Создать аккаунт; ошибки | `POST /auth/register` → `USERNAME_TAKEN`, `EMAIL_IN_USE`, `REGISTRATION_CLOSED`, `RATE_LIMITED` |
| 4 «Проверь почту», ссылка, повтор письма, опрос каждые 5 с | `POST /auth/email/verify` (по ссылке), `POST /auth/email/resend` (≥ 60 с), `GET /auth/register/status?registration_token=` |
| 5 Ключи идентичности и устройства, KeyPackage; повтор при ошибке | `POST /auth/login` → `PUT /devices/me/keys` → `PUT /users/me/identity-key` → `POST /devices/me/key-packages` |
| 6 Ключ восстановления и проверка групп | Клиент; копия ключа идентичности под ключом восстановления уходит в `PUT /users/me/identity-key.encrypted_identity_key` |
| 7 Аватар и отображаемое имя | `PATCH /users/me` |
| 8 Домашний экран | gateway `Identify` → `Ready` |

### 02 — Новое устройство

| Шаг | Вызов или событие |
|---|---|
| 1 Вход, сессия с неподтверждённым устройством | `POST /auth/login` → `Session.device.verification = DEVICE_VERIFICATION_UNVERIFIED` |
| 2 Ключи нового устройства, экран «Подтверди» | `PUT /devices/me/keys` (ключ подписи устройства); KeyPackage — только после подтверждения (ш. 4.4, `CRYPTO.md` §1.4) |
| 3 Уведомление других устройств | событие `DeviceAdded{device, verification_request}` своим устройствам |
| 4.1 Окно «Новое устройство хочет войти» | данные из `DeviceAdded` |
| 4.2 Обмен коммитментами, сравнение картинок | `POST /devices/{id}/verification/messages` ↔ событие `DeviceVerificationMessage` |
| 4.3 Подпись ключа нового устройства | клиент |
| 4.4 Пометка `verified`, Add-предложения во все группы | `POST /devices/{id}/verify` → `DeviceVerified`, `MlsHandshake{from_external_sender, HANDSHAKE_KIND_PROPOSAL}`; `MlsUpdateRequested{designated_device_id}` — в первую очередь подтвердившему устройству; commit — `POST /mls/groups/{id}/handshakes`; новое устройство загружает KeyPackage `POST /devices/me/key-packages` сразу после `DeviceVerified` |
| 4.5 История на новом устройстве | `MlsWelcome` → `GET /mls/groups/{id}/history-key-bundle` → `GET /channels/{id}/messages?before=` |
| 5 Ключом восстановления | `GET /users/me/recovery-key/identity` → клиент расшифровывает → `POST /devices/{id}/verify` (своё устройство) → далее 4.4 |
| 6 «Начать заново» | `PUT /users/me/identity-key {reset: true}` → `DeviceRemoved` и `SessionInvalid{REASON_DEVICE_REMOVED}` (код 4109) прочим устройствам, Remove-предложения; `UserUpdated` (новый `identity_pubkey`); системное «Ключи изменились» — конверт `DeviceNoticeBody{KIND_IDENTITY_KEY_CHANGED}` от клиента |
| 7 «Это не я» | `POST /devices/{id}/reject` → `DeviceRemoved`; смена пароля `POST /auth/password/change` |
| Таймаут 10 минут, «отправить снова» | `VERIFICATION_EXPIRED`; `POST /devices/me/verification/request` → повторный `DeviceAdded` |
| Возвращение 1 Устройство дольше горизонта офлайна | `Identify` → `Ready.device_returning`, `MlsPending.returning`; `POST /devices/me/key-packages`; сервер публикует Remove + Add (`MlsHandshake{from_external_sender}`), `MlsUpdateRequested{designated_device_id}` |
| Возвращение 2 «Подключаемся к каналу…» | клиент до `MlsWelcome` |
| Возвращение 3 История и очередь | `GET /mls/groups/{id}/history-key-bundle`, `GET /channels/{id}/messages?before=`; очередь шифруется в момент отправки (CRYPTO.md §2.11.4); запасной путь клиента — `POST /mls/groups/{id}/resync` |
| Выход на устройстве 1–2 | `DELETE /devices/{id}` → `DeviceRemoved`, `MlsHandshake` (Remove-предложения); удалённое устройство получает `SessionInvalid{REASON_DEVICE_REMOVED}` / код 4109 и стирает ключи; так же для `POST /auth/logout` и «выйти на всех других устройствах». Смена пароля (`POST /auth/password/change`) завершает только сессии: код 4108, ключи остаются |
| Выход 3 | клиент стирает ключи и базу |
| Выход 4 Системное сообщение собеседникам | конверт `DeviceNoticeBody{KIND_DEVICE_REMOVED}` от оставшегося устройства |

### 03 — Создание сервера и каналов

| Шаг | Вызов или событие |
|---|---|
| 1 Мастер | клиент |
| 2 Создать сообщество, пресеты ролей, каналы по умолчанию, владелец | `POST /communities` → `CommunitySnapshot`; `CommunityCreated` другим своим устройствам |
| 3 MLS-группы текстовых каналов; группы голосового — лениво | `POST /mls/groups {channel_id, kind: GROUP_KIND_CHAT}`; группа звонка — при `POST /channels/{id}/voice/join` с `call_group_exists: false` |
| 4 Открыть первый канал | клиент |
| 5 Лимит; откат | `COMMUNITY_LIMIT`; `DELETE /communities/{id}` + серверная уборка (STATUS.md) |
| Канал 1 | клиент (права из `EffectivePermissions`) |
| Канал 2 Создать канал | `POST /communities/{id}/channels {type, name, category_id, private, allowed_role_ids, allowed_user_ids}` |
| Канал 3 `ChannelCreated`; группа и добавление устройств пакетами | событие `ChannelCreated`; `POST /mls/groups`; `POST /users/{id}/key-packages/claim` × участники; `POST /mls/groups/{id}/handshakes` (commit + welcomes) |
| Канал 4 Появление у всех | `ChannelCreated` видящим канал |

### 04 — Приглашение и вступление

| Шаг | Вызов или событие |
|---|---|
| Создать 1 Действующая ссылка или новая | `GET /channels/{id}/invites?mine=true`; `POST /communities/{id}/invites {channel_id, ttl_seconds: 604800, max_uses: 0}` → `InviteCreated` |
| Создать 2 Копировать; пригласить друга в ЛС | клиент; ЛС — обычное `text`-сообщение со ссылкой (OPEN-QUESTIONS №5); `InviteCreated` — создателю и участникам с `community.admin` |
| Создать 3 Настроить ссылку | `POST /communities/{id}/invites` с параметрами; старая действует |
| Вступить 1 Превью; ошибки | `GET /invites/{code}` → `INVITE_EXPIRED`, `INVITE_REVOKED`, `INVITE_USES_EXHAUSTED`, `BANNED`, `CHANNEL_MEMBER_LIMIT`, `INVITES_PAUSED` |
| Вступить 2 Принять | `POST /invites/{code}/accept` → `MemberJoined` участникам, `CommunityCreated` своим устройствам |
| Вступить 3 Add-предложения, Skeleton до commit; ожидание, если никого нет в сети | `MlsHandshake{from_external_sender}` членам групп; `MlsUpdateRequested{designated_device_id}`; commit назначенным онлайн-участником; без онлайн-участников заявка ждёт (ADR-0019) |
| Вступить 4 Связка ключей истории; история | `MlsWelcome` → `GET /mls/groups/{id}/history-key-bundle` → `GET /channels/{id}/messages` (при выключенной истории сервер не отдаёт сообщения до вступления) |
| Вступить 5 Системное сообщение о входе | `MessageCreated{system: KIND_MEMBER_JOINED}` в канале системных сообщений |

### 05 — Друзья и личные сообщения

| Шаг | Вызов или событие |
|---|---|
| Запрос 1 | `POST /users/me/relationships {username}` |
| Запрос 2 Проверки, ответ | `NOT_FOUND`, `BLOCKED`, `RELATIONSHIP_EXISTS`; успех — `Relationship{RELATIONSHIP_KIND_REQUEST_OUTGOING}` |
| Запрос 3 Уведомление, принять/отклонить | событие `RelationshipUpdated{RELATIONSHIP_KIND_REQUEST_INCOMING}`; `PUT /users/me/relationships/{id}` → `RelationshipUpdated{RELATIONSHIP_KIND_FRIEND}` обоим; `DELETE …/relationships/{id}` → `RelationshipRemoved` без уведомления инициатора |
| ЛС 1 «Написать» | `POST /users/me/dm-channels {participant_ids}` → `Channel{CHANNEL_TYPE_DM}` |
| ЛС 2 KeyPackage, группа, Welcome | `POST /users/{id}/key-packages/claim` (собеседник и свои устройства) → `POST /mls/groups {channel_id, kind: GROUP_KIND_CHAT}` → `POST /mls/groups/{id}/handshakes` (commit + welcomes) → `MlsWelcome` |
| ЛС 3 Офлайн-собеседник | пакеты уже на сервере — то же |
| ЛС 4 Нет KeyPackage | `NO_KEY_PACKAGES` → `Banner`, очередь на клиенте; повтор при `PresenceUpdated{PRESENCE_STATUS_ONLINE}` |
| Блокировка 1–2 | `PUT /users/me/blocks/{id}` → `RelationshipUpdated{RELATIONSHIP_KIND_BLOCKED}`; у заблокированного `POST /channels/{id}/messages` → `BLOCKED`; снять — `DELETE /users/me/blocks/{id}` |

### 06 — Сообщения

| Шаг | Вызов или событие |
|---|---|
| Отправка 1 UUIDv7, «отправляется» | клиент |
| Отправка 2 Шифрование и отправка | `POST /channels/{id}/messages {id, group_id, epoch, ciphertext, wrapped_message_key, mention_hints, broadcast_mention, attachment_ids}` |
| Отправка 3 Права, сохранение, рассылка, push | сервер: `chat.post`, `chat.upload`, `chat.ping_all`; `MessageCreated`; push без текста |
| Отправка 4 Ошибки | очередь без сети; `PERMISSION_DENIED{missing_permission}`; `EPOCH_MISMATCH{current_epoch}` → `GET /mls/groups/{id}/handshakes?after_seq=` и повтор до 3 раз |
| Отправка 5 У других | `MessageCreated`; бейдж по `mention_hints`/`broadcast_mention`; `ReadStateUpdated` |
| Ответ | `TextBody.reply_to` |
| Правка | `MessageCreated` с конвертом `EditBody` |
| Удаление | `DELETE /channels/{id}/messages/{mid}` → `MessageDeleted`; плюс конверт `DeleteBody` |
| Реакция | `MessageCreated` с конвертом `ReactionBody` |
| Вложения 1 Выбор файлов | клиент; лимиты из `InstanceLimits` |
| Вложения 2 Ключ, шифрование, загрузка, метаданные в конверт | `POST /files` → `PUT upload_url` → `POST /files/{id}/complete`; `FileRef` в `TextBody.attachments` |
| Вложения 3 Прогресс и отмена | `DELETE /files/{id}`; сообщение не отправляется |
| Вложения 4 Получение | `GET /files/{id}` → скачивание и расшифровка; `Skeleton` по `FileRef.width/height` |

### 07 — Голосовой канал

| Шаг | Вызов или событие |
|---|---|
| Вход 1 Клик, переход из другого звонка | `POST /channels/{old}/voice/leave` → `POST /channels/{id}/voice/join` |
| Вход 2 «Подключение…», полупрозрачный участник | `VoicePresenceChanged{connecting: true}` всем после `join` |
| Вход 3 Токен SFU, права 2 и 11, лимит, права 12–13 в токене | `POST /channels/{id}/voice/join` → `{sfu_url, token, call_group_id, call_group_exists}` |
| Вход 4 Группа звонка, SFrame-ключ, публикация | `POST /mls/groups {kind: GROUP_KIND_CALL}` (первый) или `MlsWelcome`; далее SFU |
| Вход 5 «В голосе», звук входа | webhook SFU → `VoicePresenceChanged{connecting: false}`; звуки — клиент |
| Вход 6 Ошибки | `PERMISSION_DENIED{voice.join}`, `VOICE_CHANNEL_FULL{limit}`, `UNAVAILABLE` → повтор каждые 5 с |
| В звонке: говорящий | клиент |
| В звонке: mute/deafen | команда `SetVoicePresence{mic_off, sound_off}` → `VoicePresenceChanged` |
| В звонке: вход/выход участников, смена эпохи | webhook SFU → `MlsHandshake{from_external_sender}` (Add/Remove) → commit участником → новый ключ |
| В звонке: громкость участника | клиент |
| Переподключение | gateway `Resume`; `GET /mls/groups/{id}/handshakes?after_seq=`; повторный `join` → `connecting: true` у других на время переподключения |
| Выход | `POST /channels/{id}/voice/leave` → `VoicePresenceChanged{left_channel_id}`, Remove-предложение; последний — сервер удаляет группу |
| Серверный mute/deafen (право 15) | `POST /channels/{id}/voice/members/{uid}/mute|deafen` → `VoicePresenceChanged{server_mic_off, server_sound_off}` (OPEN-QUESTIONS №4) |

### 08 — Стрим

| Шаг | Вызов или событие |
|---|---|
| Начать 1–4 Выбор источника, пресет, захват, публикация треков | клиент и media-engine (B12); треки — SFU по токену с правом `voice.share` |
| Начать 5–6 Панель стрима, «В ЭФИРЕ» у других | команда `SetVoicePresence{streaming: true}` → `VoicePresenceChanged` |
| Начать 7 Ошибки | нет права — `PERMISSION_DENIED{voice.share}` на `SetVoicePresence`; энкодер и окно — клиент |
| Смотреть 1–4 | подписка на треки в SFU; метки задержки — B12; API не участвует |
| Смена источника и качества | клиент; треки подменяются в SFU |
| Деградация | клиент; шифрование не отключается |
| Завершить | `SetVoicePresence{streaming: false}` → `VoicePresenceChanged`; выход из звонка — `voice/leave` |

### 09 — Soundboard

| Шаг | Вызов или событие |
|---|---|
| Загрузить 1–2 Файл, обрезка, нормализация | клиент |
| Загрузить 3 Загрузить звук сервера; лимиты | `POST /communities/{id}/sounds` (multipart) → `SOUND_INVALID`, `SOUND_SLOTS_FULL`, `PAYLOAD_TOO_LARGE`; `SoundAdded` |
| Загрузить 4 Кэширование у других | `GET /sounds/{id}/audio` по `SoundAdded` |
| Проиграть 1 Клик или клавиша | клиент |
| Проиграть 2 Команда и проверки | gateway `PlaySound{channel_id, sound_id}` → право 14, присутствие, существование, кулдаун 2 с → `SoundPlayed{channel_id, user_id, sound_id, volume}` |
| Проиграть 3–4 Локальное воспроизведение, кольцо | клиент по `SoundPlayed` |
| Проиграть 5 Ошибки | `CommandRejected{ERROR_CODE_RATE_LIMITED, retry_after_ms}`, `{ERROR_CODE_PERMISSION_DENIED}`, `{ERROR_CODE_NOT_IN_VOICE}`; нет в кэше — `GET /sounds/{id}` + `/audio` |
| Личные 1–2 | `POST /users/me/sounds` → `SoundAdded` своим устройствам; лимит `SOUND_SLOTS_FULL` |
| Личные 3 Скачивание при первом `SoundPlayed` | `GET /sounds/{id}`, `GET /sounds/{id}/audio` |
| Горячие клавиши 1–3 | клиент; `SoundRemoved` → пометка «Звук больше недоступен» |

### 10 — Модерация

| Шаг | Вызов или событие |
|---|---|
| Приватный канал 1 | `POST /communities/{id}/channels {private, allowed_*}` или `PUT /channels/{id}/access {private, entries}` |
| Приватный канал 2 Переопределения `channel.see`, состав группы | сервер; `PermissionsUpdated` затронутым; владельцу и администраторам, не выбранным в канал, — `LockedChannelsUpdated` («🔒 закрытый для тебя», PERMISSIONS §3 п. 2); самодобавление — `POST /channels/{id}/access/self` → системное `KIND_CHANNEL_SELF_JOINED` |
| Приватный канал 3 Remove, commit | `MlsHandshake{from_external_sender, HANDSHAKE_KIND_PROPOSAL}` → commit участником |
| Приватный канал 4 Канал исчезает | `ChannelDeleted` потерявшим доступ |
| Роли 1 Сохранить роль | `POST /communities/{id}/roles`, `PATCH /roles/{id}`, `PUT /communities/{id}/members/{uid}/roles` |
| Роли 2 Пересчёт прав, `PermissionsUpdated` | `RoleUpdated`, `MemberUpdated`, `PermissionsUpdated`; при смене `channel.see` — шаг 3 выше |
| Выгнать 1 Подтверждение | клиент |
| Выгнать/забанить 2 | `DELETE /communities/{id}/members/{uid}` → `MemberLeft{COMMUNITY_REMOVAL_REASON_KICKED}`; `PUT /communities/{id}/bans/{uid} {reason, delete_messages_window_seconds}` → `BanAdded`, `MemberLeft{COMMUNITY_REMOVAL_REASON_BANNED}`, `MessageDeleted` пачками; Remove-предложения во всех группах |
| Выгнать 3 Modal у выгнанного | `CommunityRemoved{reason: COMMUNITY_REMOVAL_REASON_KICKED | COMMUNITY_REMOVAL_REASON_BANNED}`; если устройство было офлайн дольше буфера Resume — `Ready.community_removals` / `GET /users/me/community-removals`, подтверждение показа `DELETE …/community-removals/{community_id}` |
| Выгнать 4 Журнал (S) | без события участникам |
| Снять бан | `DELETE /communities/{id}/bans/{uid}` → `BanRemoved` |
