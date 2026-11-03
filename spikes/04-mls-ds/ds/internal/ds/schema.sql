-- SPDX-FileCopyrightText: 2026 Bebeberloga contributors
-- SPDX-License-Identifier: Apache-2.0

-- Схема спайка S4: только то, что нужно Delivery Service. Продуктовая схема — B05 (goose).

CREATE TABLE IF NOT EXISTS devices (
    id            text PRIMARY KEY,
    -- Ed25519-ключ подписи устройства: все его KeyPackage обязаны нести этот ключ.
    signature_key bytea NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS key_packages (
    ref         bytea PRIMARY KEY,        -- KeyPackageRef (RFC 9420 §5.2)
    device_id   text NOT NULL REFERENCES devices (id),
    blob        bytea NOT NULL,
    init_key       bytea NOT NULL,
    encryption_key bytea NOT NULL,
    not_after   timestamptz NOT NULL,
    claimed_at  timestamptz,              -- зарезервирован под предложение Add
    consumed_at timestamptz               -- устройство вошло в группу по этому пакету
);
CREATE INDEX IF NOT EXISTS key_packages_free ON key_packages (device_id) WHERE claimed_at IS NULL;

-- Общее пространство HPKE-ключей всех пакетов: init_key и encryption_key не повторяются ни
-- между собой, ни перекрёстно. Пакет, чей init_key равен чужому encryption_key (или наоборот),
-- openmls отвергает при сборке commit-а вместе со всей пачкой (RFC 9420, ValSem104), — так
-- один пакет замораживал бы группу (ревью, раунд 3, Н1). Ключи листьев из UpdatePath DS не
-- видит, поэтому тот же фильтр обязателен и у клиента.
CREATE TABLE IF NOT EXISTS hpke_keys (
    key bytea PRIMARY KEY,
    ref bytea NOT NULL
);

CREATE TABLE IF NOT EXISTS mls_groups (
    id         bytea PRIMARY KEY,
    epoch      bigint NOT NULL,
    last_seq   bigint NOT NULL,
    leaf_limit integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Счётчики лимита — не в строке группы и разнесены на две строки. Commit берёт строку группы
-- первым и держит её до конца: будь счётчик там, заявки стояли бы в очереди за каждым
-- commit-ом. А общий счётчик заявок и commit-ов — горячая строка, за которой commit ждал бы
-- десятки заявок. Поэтому заявки пишут только `requested` (своя строка), commit-ы — только
-- листья и `done` (своя строка); ожидающих Add = requested − done. Заявка читает строку
-- commit-ов без блокировки: устаревшее значение лишь занижает свободное место (commit
-- меняет leaf_count и done одним оператором, снятие заявки только растит done), поэтому
-- лимит не превышается никогда.
CREATE TABLE IF NOT EXISTS group_counters (
    group_id   bytea PRIMARY KEY,
    leaf_limit integer NOT NULL,
    leaf_count integer NOT NULL,
    done       bigint NOT NULL      -- заявки, закрытые commit-ом, снятые или отменённые
);
-- bigint: счётчики только растут, и циклом «вход — выход» integer можно переполнить, после
-- чего каждый commit с Add падал бы (ревью, раунд 3, Н6).
CREATE TABLE IF NOT EXISTS group_requests (
    group_id  bytea PRIMARY KEY,
    requested bigint NOT NULL       -- принятые заявки на вход, всего
);

-- Карта листьев, которую DS ведёт по дельтам состава из authenticated_data commit-ов.
CREATE TABLE IF NOT EXISTS group_leaves (
    group_id  bytea NOT NULL REFERENCES mls_groups (id) ON DELETE CASCADE,
    leaf      integer NOT NULL,
    device_id text NOT NULL,
    PRIMARY KEY (group_id, leaf),
    UNIQUE (group_id, device_id)
);

CREATE TABLE IF NOT EXISTS mls_handshakes (
    group_id         bytea NOT NULL REFERENCES mls_groups (id) ON DELETE CASCADE,
    seq              bigint NOT NULL,
    epoch            bigint NOT NULL,
    kind             smallint NOT NULL,   -- 1 proposal, 2 commit, 3 external commit
    sender_device_id text,                -- NULL: сервер как external sender
    blob             bytea NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, seq)
);

-- Изменения состава, которые сервер решил сделать и которые ещё не закоммичены.
-- Внешнего ключа на mls_groups нет намеренно: заявка на вход вставляет строку сюда до UPDATE
-- счётчика в строке группы, и внешний ключ взял бы KEY SHARE на строку группы, а потом
-- повысил его до UPDATE — взаимоблокировка с commit-ом, ждущим строку группы. Существование
-- группы заявка проверяет тем же UPDATE.
CREATE TABLE IF NOT EXISTS pending_ops (
    group_id        bytea NOT NULL,
    device_id       text NOT NULL,
    op              smallint NOT NULL,    -- 1 add, 2 remove
    kp_ref          bytea,                -- add: зарезервированный KeyPackage
    leaf            integer,              -- remove: лист устройства
    state           smallint NOT NULL,    -- 0 в очереди, 1 опубликовано, 2 Remove закоммичен, ждёт подтверждения
    published_epoch bigint,
    first_epoch     bigint,               -- add: эпоха первой публикации (для TTL в эпохах)
    revoked         boolean NOT NULL DEFAULT false, -- add: вход отменён после публикации
    confirm_epoch   bigint,               -- remove: эпоха, с которой ждём commit другого устройства
    committed_by    text,                 -- remove: кто закоммитил
    requested_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (group_id, device_id)
);
CREATE INDEX IF NOT EXISTS pending_ops_queued ON pending_ops (group_id, requested_at) WHERE state = 0;

-- Welcome хранится один раз на commit, доставка — по строке на адресата.
CREATE TABLE IF NOT EXISTS welcomes (
    id       bigserial PRIMARY KEY,
    group_id bytea NOT NULL,
    epoch    bigint NOT NULL,
    blob     bytea NOT NULL
);
CREATE TABLE IF NOT EXISTS welcome_deliveries (
    device_id    text NOT NULL,
    welcome_id   bigint NOT NULL REFERENCES welcomes (id) ON DELETE CASCADE,
    kp_ref       bytea NOT NULL,          -- по нему DS вырезает из Welcome запись адресата
    delivered_at timestamptz,
    PRIMARY KEY (device_id, welcome_id)
);
CREATE INDEX IF NOT EXISTS welcome_deliveries_pending ON welcome_deliveries (device_id) WHERE delivered_at IS NULL;
