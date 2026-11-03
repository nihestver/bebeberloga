# Gateway: WebSocket-шлюз

Схемы кадров — [`proto/bebeberloga/v1/gateway.proto`](../../proto/bebeberloga/v1/gateway.proto). Этот документ описывает поведение: подключение, `Identify` → `Ready`, нумерацию событий, heartbeat, `Resume`, сжатие, лимиты, адресацию событий и команды клиента. Всё, что не нужно мгновенно, идёт через REST ([`REST.md`](REST.md)). Числовые значения, которых нет в спецификации, обоснованы в [`STATUS.md`](STATUS.md) «Собственные значения».

## 1. Транспорт

- Адрес: `GET /api/v1/gateway` возвращает `wss://<инстанс>/gateway/v1`. Клиент не хардкодит путь: инстанс может вынести шлюз на другой хост.
- Один WebSocket-кадр = одно сообщение `ClientFrame` (от клиента) или `ServerFrame` (от сервера).
- Формат выбирается WebSocket-субпротоколом при рукопожатии:
  - `bebeberloga.v1.proto` — бинарные кадры Protobuf (основной);
  - `bebeberloga.v1.json` — текстовые кадры protojson с именами полей как в `.proto` (`snake_case`), только для отладки и тестов. Сервер поддерживает оба.
- Версия протокола — `1`. При несовместимой версии сервер отвечает `SessionInvalid{REASON_PROTOCOL_MISMATCH}` и закрывает соединение кодом 4103.
- Соединение аутентифицируется первым кадром `Identify`, а не заголовком: так шлюз работает одинаково в браузере и в нативных клиентах.

## 2. Жизненный цикл сессии

```
клиент                                   сервер
  │── WS connect ─────────────────────────▶│
  │── Identify{access_token, device_id} ──▶│  проверка токена, устройства
  │◀─ Ready{session_id, heartbeat, seq=0} ─│  снимок состояния
  │◀─ ServerFrame{seq=1, …} ───────────────│  события
  │── Heartbeat{seq} ─────────────────────▶│  каждые heartbeat_interval_ms
  │◀─ HeartbeatAck ────────────────────────│
  │   … разрыв …
  │── WS connect ─────────────────────────▶│
  │── Resume{session_id, seq=N} ──────────▶│
  │◀─ Resumed{replayed_events=k} ──────────│  затем k событий с seq N+1…N+k
  │◀─ ServerFrame{seq=N+k+1, …} ───────────│  живые события
```

1. После установления соединения клиент обязан прислать `Identify` или `Resume` в течение 10 с, иначе сервер закрывает соединение кодом 4100.
2. `Identify` содержит токен доступа (`POST /auth/login`), `device_id` устройства сессии, желаемое сжатие и версию клиента. Устройство должно принадлежать сессии токена; иначе 4101.
3. Сервер отвечает `Ready` — полный снимок (§3). `Ready.seq` — последний выданный номер (для новой сессии 0).
4. Далее сервер шлёт события с монотонно растущим `seq` (1, 2, 3 … без пропусков в пределах сессии). Служебные кадры (`Ready`, `Resumed`, `HeartbeatAck`, `SessionInvalid`, `CommandRejected`) идут с `seq = 0` и не участвуют в нумерации.
5. Повторный `Identify` с тем же `device_id`, пока открыто другое соединение этого устройства, закрывает старое соединение кодом 4107 — у устройства всегда одно соединение.

Неподтверждённое устройство (`DEVICE_VERIFICATION_UNVERIFIED`) подключается и получает `Ready` с сообществами и каналами, но без MLS-событий чужих групп: ему приходят только события о своих устройствах и `DeviceVerificationMessage` (SCREENS/07 §3).

## 3. Состав `Ready`

| Поле | Что внутри | Зачем сразу |
|---|---|---|
| `session_id`, `heartbeat_interval_ms`, `seq` | Параметры сессии | Нужны для heartbeat и Resume |
| `account` | Свой аккаунт (`Account`) | Шапка, настройки |
| `devices` | Свои устройства с состоянием подтверждения | Список устройств, окно «Новое устройство хочет войти» |
| `communities[]` | `CommunitySnapshot`: сообщество, категории, **видимые** каналы, роли, своя запись участника, вычисленные права (`EffectivePermissions`), присутствие в голосовых каналах, для владельца и администраторов — `locked_channels` («🔒 закрытый для тебя», PERMISSIONS §3 п. 2) | Рейл, боковая панель, права без расчёта на клиенте |
| `dm_channels` | ЛС и групповые чаты (`Channel` типа DM/GROUP_DM) | Список ЛС |
| `read_states` | Последнее прочитанное и число упоминаний по каналам | Бейджи непрочитанного |
| `relationships` | Друзья, запросы, блокировки | Вкладки «Друзья» |
| `presences` | Присутствие друзей | Точки статуса |
| `notification_settings` | Настройки уведомлений по сообществам и каналам | Решение показывать ли уведомление |
| `limits` | Лимиты инстанса (`InstanceLimits`) | Счётчик символов, лимит вложений, пресет стрима |
| `mls_pending` | Группы с недоставленными Welcome или handshake; `returning` — группы, куда устройство возвращается парой Remove + Add | Догнать MLS-состояние через REST до первого сообщения; группы с `returning` не догонять, а ждать Welcome; при `review_seq` — ответить на проверку после догона |
| `identity_reset` | Действующий запрос сброса ключа идентичности (CRYPTO.md §6.3.9) | Предупреждение «Запрошен сброс твоих ключей» с отменой на старых устройствах и обратный отсчёт на новом (SCREENS/07 §4, §8) |
| `device_returning` | Устройство не подключалось дольше горизонта офлайна (30 сут, CRYPTO.md §2.11) | Не обрабатывать старые handshake, сразу загрузить свежие KeyPackage, показать «Подключаемся к каналу…» (SCREENS/08 §1) |
| `community_removals` | Сообщества, из которых пользователя удалили, пока устройство было офлайн, и показ которых оно не подтвердило | `Modal` «Тебя выгнали с сервера …» (FLOWS/10 ш. 3) даже после долгого офлайна; подтверждение — `DELETE /users/me/community-removals/{community_id}` |
| `server_time` | Время сервера | Коррекция часов для таймеров |

В `Ready` **не входят**: списки участников сообществ (`GET /communities/{id}/members`), история сообщений (`GET /channels/{id}/messages`), закрепы, приглашения, баны, звуки — всё это запрашивается через REST по мере открытия экранов. Присутствие участников сообществ (не друзей) приходит после `PresenceSubscribe`.

Размер `Ready` для пользователя в 50 сообществах по 50 каналов — сотни КиБ; поэтому рекомендуется `COMPRESSION_ZSTD`.

## 4. Heartbeat

- Интервал задаёт сервер в `Ready`/`Resumed` (`heartbeat_interval_ms`, по умолчанию 30 000 — STATUS.md). Клиент шлёт `Heartbeat{seq}` каждые `heartbeat_interval_ms`; `seq` — последний обработанный номер события (помогает серверу подрезать буфер Resume).
- Сервер отвечает `HeartbeatAck{server_time}` сразу.
- Если клиент не получил `HeartbeatAck` за два интервала — считает соединение мёртвым, закрывает его и переподключается с `Resume`.
- Если сервер не получил `Heartbeat` за два интервала — закрывает соединение кодом 4105; сессия остаётся возобновляемой 5 минут.

## 5. Resume

- Сервер хранит события каждой сессии в кольцевом буфере (Valkey) **5 минут** после отправки (ARCHITECTURE.md §5.2).
- После разрыва клиент открывает новое соединение и шлёт `Resume{access_token, session_id, seq}`, где `seq` — последний обработанный номер.
- Если сессия существует и все события с `seq + 1` ещё в буфере — сервер отвечает `Resumed{replayed_events}` и досылает пропущенные события **с их исходными `seq`**, затем продолжает живыми событиями. Клиент обрабатывает их как обычно; дубликатов не будет, потому что номера не пересекаются.
- Иначе — `SessionInvalid{REASON_RESUME_WINDOW_EXPIRED}` и закрытие кодом 4102; клиент отправляет новый `Identify` и получает полный `Ready`. При этом клиент должен сбросить кэш присутствия и присутствия в голосе (они не инкрементальны), а MLS-состояние догнать по `mls_pending`.
- Переподключение — с экспоненциальной паузой 1, 2, 4 … 30 с с джиттером.
- Токен доступа мог истечь за время разрыва: клиент сначала обновляет его через `POST /auth/refresh`, потом шлёт `Resume`.

Команды клиента (`TypingStart`, `PlaySound`, `SetVoicePresence`), отправленные в разорванное соединение, не буферизуются и не повторяются автоматически: они описывают текущее состояние, клиент при необходимости отправляет их заново.

## 6. Сжатие

- `Identify.compression = COMPRESSION_ZSTD`: сервер сжимает **каждый кадр отдельно** zstd без словаря (уровень 3). Клиент декодирует кадр целиком, затем парсит Protobuf. Кадры клиента не сжимаются.
- `COMPRESSION_NONE` (по умолчанию, если не указано): кадры как есть.
- Выбор действует на всё соединение; при `Resume` указывается заново.

## 7. Лимиты и коды закрытия

| Лимит | Значение |
|---|---|
| Кадр от клиента | ≤ 64 КиБ (`InstanceLimits.max_client_frame_size`); больше — 4104 |
| Кадр от сервера | ≤ 8 МиБ (после распаковки) |
| Блоб MLS внутри события (`Handshake.blob`, `Welcome.blob`) | ≤ 256 КиБ; больше — поле пустое, клиент берёт `GET /mls/groups/{id}/handshakes/{seq}` или `GET /mls/welcomes` |
| Команды клиента | ≤ 30 за 10 с на соединение (heartbeat не считается); превышение — `CommandRejected{ERROR_CODE_RATE_LIMITED}`, повторное — 4106 |
| `TypingStart` | ≤ 1 за 5 с на канал; лишние молча отбрасываются |
| `PlaySound` | кулдаун 2 с на пользователя (FLOWS/09); `CommandRejected{ERROR_CODE_RATE_LIMITED, retry_after_ms}` |
| Время до `Identify`/`Resume` | 10 с; иначе 4100 |
| Буфер Resume | 5 минут |

Коды закрытия WebSocket — собственная схема проекта: блок 41xx (по аналогии с 4xx в REST — «проблема на стороне клиента или сессии»), номера идут в порядке жизненного цикла сессии из §2. Каждому коду соответствует имя для журналов и клиентского кода.

| Код | Имя | Смысл | Что делает клиент |
|---|---|---|---|
| 1000, 1001 | — | Штатное закрытие: остановка или перезапуск шлюза | Переподключение с `Resume` |
| 4100 | `HANDSHAKE_TIMEOUT` | Не было `Identify`/`Resume` за 10 с | `Identify` |
| 4101 | `IDENTIFY_REJECTED` | Токен недействителен или устройство не принадлежит сессии | Обновить токен, `Identify`; если не помогло — экран входа |
| 4102 | `RESUME_REJECTED` | Сессию нельзя возобновить (`SessionInvalid{REASON_RESUME_WINDOW_EXPIRED}`) | `Identify` |
| 4103 | `PROTOCOL_MISMATCH` | Несовместимая версия протокола или субпротокол | Показать «Обнови клиент» |
| 4104 | `FRAME_REJECTED` | Кадр не разобран или слишком большой | Записать в журнал, `Resume` |
| 4105 | `HEARTBEAT_LOST` | Нет heartbeat два интервала | `Resume` |
| 4106 | `COMMAND_FLOOD` | Превышена частота команд | Пауза 10 с, `Resume` |
| 4107 | `CONNECTION_SUPERSEDED` | Другое соединение этого устройства прислало `Identify` | Не переподключаться автоматически |
| 4108 | `SESSION_ENDED` | Сессия завершена без удаления устройства: смена или сброс пароля (`SessionInvalid{REASON_SESSION_ENDED}`) | Экран входа; **ключи устройства и локальная база остаются** (OPEN-QUESTIONS №2); после входа — тот же `device_id` |
| 4109 | `DEVICE_REMOVED` | Устройство удалено: выход на нём (`POST /auth/logout` — само выходящее устройство тоже получает 4109), «выйти на всех других устройствах», выход с другого устройства, «это не я», «начать заново» (`SessionInvalid{REASON_DEVICE_REMOVED}`) | Стереть локальные ключи и базу (FLOWS/02), экран входа с баннером «Это устройство отключено». Исключение — `SessionInvalid{REASON_DEVICE_REMOVED_BY_RESET}`: ничего не стирать молча, спросить «Это был ты?» (SCREENS/07 §8, CRYPTO.md §3.7) |
| 4199 | `SERVER_FAULT` | Внутренняя ошибка шлюза | `Resume` с паузой |

## 8. Адресация событий

Событие доставляется каждому подключённому устройству получателя. Получатели:

| Область | Кто получает | События |
|---|---|---|
| Свои устройства | Все устройства пользователя | `UserUpdated` (своё), `DeviceAdded/Verified/Removed`, `DeviceVerificationMessage`, `IdentityResetRequested/Cancelled`, `RelationshipUpdated/Removed`, `ReadStateUpdated`, `NotificationSettingsUpdated`, `CommunityCreated`, `CommunityRemoved`, `LockedChannelsUpdated`, `MlsWelcome`, `CallStarted/Ended`, `SoundAdded/Updated/Removed` для личных звуков |
| Видящие канал | Участники сообщества с правом `channel.see` на канал (или участники ЛС) | `MessageCreated/Updated/Deleted`, `TypingStarted`, `ChannelCreated/Updated/Deleted`, `VoicePresenceChanged`, `SoundPlayed` (только присутствующим в голосовом канале) |
| Члены MLS-группы | Устройства, состоящие в группе (по данным DS) | `MlsHandshake`, `MlsGroupStateChanged`; `MlsUpdateRequested` — только онлайн-устройствам группы |
| Участники сообщества | Все участники | `CommunityUpdated`, `CategoryCreated/Updated/Deleted`, `MemberJoined/Updated/Left`, `RoleCreated/Updated/Deleted`, `SoundAdded/Updated/Removed` для звуков сообщества, `UserUpdated` (чужой профиль) |
| Участники с правом | `community.admin` — приглашения (плюс создатель приглашения); `member.remove` — баны | `InviteCreated/Revoked`, `BanAdded/Removed` |
| Затронутый участник | Тот, чьи права пересчитаны | `PermissionsUpdated` (каждому участнику своя копия с его действующими правами) |
| Друзья и подписчики присутствия | Друзья пользователя и подписавшиеся через `PresenceSubscribe` | `PresenceUpdated` |
| Собеседники в ЛС и группах | Участники общих групп | `DeviceAdded`/`DeviceRemoved` чужого пользователя **не рассылаются**: заметки «новое устройство» создаёт клиент владельца устройства зашифрованным сообщением (`DeviceNoticeBody`, MESSAGES.md) |

Порядок: события одной сессии упорядочены по `seq`. Для одной MLS-группы `MlsHandshake` приходят в порядке `Handshake.seq` сервера-DS; события разных групп между собой не упорядочены. События групп звонка (`MlsHandshake`, `MlsWelcome`, `MlsUpdateRequested` с `GROUP_KIND_CALL`) сервер ставит в начало очереди отправки соединения — от них зависит время входа в звонок и смена ключей медиа (CRYPTO.md §5.1); `seq` присваивается при отправке, поэтому порядок `seq` не нарушается.

## 9. События

Полные схемы — в `gateway.proto`; ниже — триггер и адресат.

| Событие | Когда | Кому |
|---|---|---|
| `MessageCreated{MessageMeta}` | Принят `POST /channels/{id}/messages`; системное сообщение сервера | Видящие канал |
| `MessageUpdated{MessageMeta}` | Изменились серверные метаданные: закреп/откреп, вложение загружено | Видящие канал |
| `MessageDeleted{channel_id, message_ids[]}` | `DELETE …/messages/{id}`; бан с удалением сообщений (пачками до 100 id) | Видящие канал |
| `TypingStarted{channel_id, user_id}` | Команда `TypingStart` | Видящие канал, кроме отправителя; клиент показывает 8 с |
| `ReadStateUpdated{ReadState}` | `PUT …/read-state` с другого устройства; сброс счётчиков сервером | Свои устройства |
| `MlsHandshake{Handshake}` | Принят handshake (`POST /mls/groups/{id}/handshakes`) или сервер как external sender создал proposal | Члены группы |
| `MlsWelcome{Welcome}` | Commit содержал Welcome для устройства | Устройство-адресат |
| `MlsUpdateRequested{group_id, reason, designated_device_id, epoch}` | Накопились proposals external sender; плановая ротация; `POST /channels/{id}/mls/rotate`; пересоздание замороженной группы (`REASON_RECREATE`); замена ключа инстанса (`REASON_EXTERNAL_SENDER_ROTATION`); повторное включение настройки «Новые участники видят историю» (`REASON_HISTORY_SETTING`, разрыв цепочки ключей истории). `REASON_HISTORY_BUNDLE` в 1.0 не используется (external commit нет, ADR-0019) | Онлайн-устройства группы; коммитит только `designated_device_id`. Нет commit-а эпохи за 3 с — сервер назначает следующее устройство новым событием (CRYPTO.md §2.6) |
| `MlsGroupStateChanged{group_id, channel_id, state, review_seq, recreation_reason, recreation_deferred_until, successor_group_id}` | Смена состояния группы на DS (CRYPTO.md §2.9–§2.10): начало проверки спорного commit-а (`REVIEW`, клиент, применивший его, отвечает `POST …/handshakes/{seq}/ack`); жалоба отклонена или пересоздание отложено (`ACTIVE`); заморозка перед пересозданием (`FROZEN`); замена новой группой (`SUPERSEDED`) | Члены группы |
| `PresenceUpdated{Presence}` | Первое подключение или последнее отключение устройства пользователя | Друзья и подписчики |
| `VoicePresenceChanged{presence, left_channel_id, user_id}` | Вход в голос (`connecting: true`), подтверждение от медиасервера (`connecting: false`), `SetVoicePresence`, серверный mute/deafen, старт/стоп стрима, выход (`presence` пуст, `left_channel_id` задан) | Видящие канал |
| `CallStarted{channel_id, caller_id}` / `CallEnded` | Первый вход в звонок ЛС / последний выход | Участники ЛС |
| `SoundPlayed{channel_id, user_id, sound_id, volume}` | Команда `PlaySound` прошла проверки | Присутствующие в голосовом канале, включая отправителя |
| `CommunityCreated{CommunitySnapshot}` | `POST /communities`, `POST /invites/{code}/accept` | Свои устройства |
| `CommunityUpdated{Community}` | `PATCH /communities/{id}`, передача владения | Участники |
| `CommunityRemoved{CommunityRemoval}` | Удаление сообщества; выход; выгнан; забанен. Запись хранится и отдаётся в `Ready.community_removals`, пока устройство не подтвердит показ | Свои устройства |
| `CategoryCreated/Updated/Deleted` | REST категорий | Участники |
| `ChannelCreated/Updated/Deleted` | REST каналов; `ChannelDeleted` также тем, кто потерял `channel.see`; `ChannelCreated` — владельцу или администратору после `POST /channels/{id}/access/self` | Видящие канал |
| `LockedChannelsUpdated{community_id, locked_channels[]}` | Создан или удалён приватный канал; владелец или администратор добавил себя; сменился состав администраторов | Владелец и администраторы |
| `MemberJoined/Updated/Left` | Вступление; смена ролей; выход/кик/бан | Участники |
| `RoleCreated/Updated/Deleted` | REST ролей | Участники |
| `PermissionsUpdated{EffectivePermissions}` | Любое изменение, влияющее на права получателя: роли, выдача ролей, доступ к каналу, передача владения | Затронутые участники |
| `InviteCreated{Invite}` / `InviteRevoked` | REST приглашений | Участники с правом `community.admin` и создатель |
| `BanAdded{Ban}` / `BanRemoved` | REST банов | Участники с правом `member.remove` |
| `SoundAdded/Updated/Removed` | REST звуков сообщества; личные звуки — только своим устройствам | Участники / свои устройства |
| `UserUpdated{User}` | `PATCH /users/me`; смена ключа идентичности | Свои устройства; участники общих сообществ и ЛС |
| `DeviceAdded{Device, verification_request}` | Вход на новом устройстве; повторный запрос подтверждения | Свои устройства |
| `DeviceVerified{Device}` | `POST /devices/{id}/verify` | Свои устройства |
| `DeviceRemoved{user_id, device_id}` | `DELETE /devices/{id}`, «это не я», «начать заново» | Свои устройства |
| `DeviceVerificationMessage{request_id, from_device_id, payload}` | `POST /devices/{id}/verification/messages` | Устройство-адресат |
| `IdentityResetRequested{IdentityResetRequest}` / `IdentityResetCancelled{request_id}` | `POST /users/me/identity-reset` с задержкой 24 ч / отмена `DELETE …/identity-reset` или подтверждение нового устройства другим способом (CRYPTO.md §6.3.9) | Свои подтверждённые устройства |
| `RelationshipUpdated{Relationship}` / `RelationshipRemoved{user_id}` | Запрос в друзья, принятие, удаление, блокировка | Оба пользователя (у каждого своя сторона `kind`) |
| `NotificationSettingsUpdated{NotificationSettings}` | REST настроек уведомлений | Свои устройства |

## 10. Команды клиента

| Команда | Что делает сервер | Ошибки (`CommandRejected`) |
|---|---|---|
| `Identify`, `Resume`, `Heartbeat` | §2, §4, §5 | — (ошибки через `SessionInvalid` и коды закрытия) |
| `TypingStart{channel_id}` | Проверяет `chat.post` и видимость канала; рассылает `TypingStarted` | `PERMISSION_DENIED`, `NOT_FOUND` |
| `SetVoicePresence{channel_id, mic_off, sound_off, camera_on, streaming}` | Проверяет, что пользователь в этом голосовом канале; при `streaming` — право `voice.share`, при `camera_on` — `voice.talk`; рассылает `VoicePresenceChanged` | `NOT_IN_VOICE`, `PERMISSION_DENIED` |
| `PlaySound{channel_id, sound_id}` | Проверяет `voice.sounds` в канале, присутствие в голосовом канале, существование звука (сообщества, личный, стандартный) и кулдаун 2 с; рассылает `SoundPlayed` | `PERMISSION_DENIED`, `NOT_IN_VOICE`, `NOT_FOUND`, `RATE_LIMITED{retry_after_ms}` |
| `PresenceSubscribe{community_id}` | Подписывает соединение на присутствие участников сообщества (одно сообщество на соединение — то, что открыто); пустой id — отписка. В ответ шлёт `PresenceUpdated` для всех онлайн-участников | `NOT_FOUND` |

Успех команды отдельно не подтверждается — он виден по событию. `nonce` в `ClientFrame` возвращается в `CommandRejected.nonce`, чтобы клиент сопоставил ошибку с командой.

## 11. Реализация (для B6)

- Шардинг по пользователю: все соединения одного пользователя обслуживает один экземпляр gateway (ключ маршрутизации — `user_id`), fan-out между экземплярами — NATS JetStream (ARCHITECTURE.md §5.1, §5.6).
- Буфер Resume — список в Valkey с TTL 5 минут на `session_id`; `Heartbeat.seq` позволяет подрезать его раньше.
- Адресация «видящие канал» вычисляется из тех же данных прав, что `EffectivePermissions`; при изменении прав сервер сначала пересчитывает подписки, потом рассылает `PermissionsUpdated`.
- `CommunityRemoval` хранится в таблице до подтверждения устройством; записи старше 90 дней удаляются (STATUS.md).
- Сервер не читает и не изменяет `MessageMeta.ciphertext` и блобы MLS — только пересылает.
