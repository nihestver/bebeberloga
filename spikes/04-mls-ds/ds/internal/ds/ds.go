// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

// Package ds — прототип MLS Delivery Service спайка S4 (ARCHITECTURE §4.3, §5.1 п. 4, §5.6).
//
// Что делает: склад одноразовых KeyPackage; сериализация handshake-сообщений по группе
// (Postgres advisory lock или блокировка строки группы); приём commit только для текущей
// эпохи; предложения Add/Remove от имени сервера как external sender с батчингом; карта
// листьев по «дельте состава» из authenticated_data commit-а; доставка Welcome по
// KeyPackageRef. Чего не делает: commit-ов, ключей групп, расшифровки — у сервера их нет.
package ds

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/mlswire"
)

//go:embed schema.sql
var schema string

// Kind — вид handshake-сообщения (совпадает с HandshakeKind из proto/bebeberloga/v1/mls.proto).
type Kind int16

// Виды handshake-сообщений.
const (
	KindProposal       Kind = 1
	KindCommit         Kind = 2
	KindExternalCommit Kind = 3
)

const (
	opAdd    int16 = 1
	opRemove int16 = 2

	stateQueued    int16 = 0
	statePublished int16 = 1
	// stateAwaitingConfirm — Remove закоммичен, но DS ждёт commit другого устройства в новой
	// эпохе: до него слово автора commit-а о выполненном Remove не считается фактом.
	stateAwaitingConfirm int16 = 2

	// maxAAD и maxDeltaEntries ограничивают дельту до блокировки группы.
	maxAAD          = 256 << 10
	maxDeltaEntries = 10_000
)

// LockMode — способ сериализации handshake-сообщений одной группы.
type LockMode int

const (
	// LockAdvisory — pg_advisory_xact_lock по хэшу group_id (ARCHITECTURE §5.6).
	LockAdvisory LockMode = iota
	// LockRow — SELECT … FOR UPDATE строки группы.
	LockRow
)

// Config — параметры DS.
type Config struct {
	ExternalSender mlswire.ExternalSender
	// MaxKeyPackageLifetime — верхняя граница срока KeyPackage.
	MaxKeyPackageLifetime time.Duration
	// MinKeyPackageLifetime — минимальный остаток срока при загрузке и резервировании:
	// пакет, истекающий, пока Add ждёт commit-а, заморозил бы группу (openmls отвергает его
	// при сборке commit-а).
	MinKeyPackageLifetime time.Duration
	// MaxAddEpochs — сколько эпох опубликованный Add может ждать commit-а, прежде чем DS его
	// снимет.
	MaxAddEpochs int
	// AllowExternalCommit — принимать ли external commit (допустимость решает B02; клиент
	// спайка его не принимает, поэтому по умолчанию выключено).
	AllowExternalCommit bool
	// BatchInterval — как часто публиковать накопленные Add; 0 — сразу при заявке.
	BatchInterval time.Duration
	// MaxBatch — сколько Add может ждать commit-а одновременно; 0 — без ограничения.
	MaxBatch int
	// LeadingEdge — заявка в группе без ожидающих Add (ни один не ждёт commit-а) публикуется сразу, не
	// дожидаясь тика; под нагрузкой пачки идут вслед за commit-ами, тик — страховка.
	LeadingEdge bool
	// LeafLimit — лимит листьев (устройств) новой группы.
	LeafLimit int
	Lock      LockMode
	Now       func() time.Time
}

// Service — Delivery Service.
type Service struct {
	pool   *pgxpool.Pool
	cfg    Config
	notify *notifier
	Stats  *Stats

	wmu    sync.Mutex
	wcache map[int64]*welcomeEntry
}

// New создаёт сервис поверх пула Postgres.
func New(pool *pgxpool.Pool, cfg Config) *Service {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MaxKeyPackageLifetime == 0 {
		cfg.MaxKeyPackageLifetime = 90 * 24 * time.Hour
	}
	if cfg.MinKeyPackageLifetime == 0 {
		cfg.MinKeyPackageLifetime = time.Hour
	}
	if cfg.MaxAddEpochs == 0 {
		cfg.MaxAddEpochs = 20
	}
	if cfg.LeafLimit == 0 {
		cfg.LeafLimit = 5000
	}
	return &Service{pool: pool, cfg: cfg, notify: newNotifier(), Stats: newStats(), wcache: map[int64]*welcomeEntry{}}
}

// Migrate создаёт таблицы.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schema)
	return err
}

// Reset очищает все таблицы (между сценариями нагрузки и тестами).
func Reset(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `TRUNCATE welcome_deliveries, welcomes, pending_ops, mls_handshakes,
		group_leaves, group_counters, group_requests, mls_groups, hpke_keys, key_packages, devices`)
	return err
}

// Config возвращает действующую конфигурацию.
func (s *Service) Config() Config { return s.cfg }

// --- ошибки -----------------------------------------------------------------

// Error — отказ DS с кодом для клиента. Коды повторяют стиль таблицы ошибок REST.md.
type Error struct {
	Code         string
	CurrentEpoch uint64
	Msg          string
}

func (e *Error) Error() string { return e.Code + ": " + e.Msg }

func dsErr(code, msg string) error { return &Error{Code: code, Msg: msg} }

// Коды ошибок DS.
const (
	CodeEpochMismatch      = "EPOCH_MISMATCH"
	CodeProposalsMissing   = "PROPOSALS_MISSING"
	CodeRemovalPending     = "REMOVAL_PENDING"
	CodeBadMessage         = "BAD_MESSAGE"
	CodeBadDelta           = "BAD_DELTA"
	CodeBadWelcome         = "BAD_WELCOME"
	CodeUnauthorizedChange = "UNAUTHORIZED_CHANGE"
	CodeMemberLimit        = "CHANNEL_MEMBER_LIMIT" // как в docs/protocol/REST.md
	CodeNoKeyPackages      = "NO_KEY_PACKAGES"
	CodeNotGroupMember     = "NOT_GROUP_MEMBER"
	CodeAlreadyMember      = "ALREADY_MEMBER"
	CodeNotFound           = "NOT_FOUND"
	CodeInvalidKeyPackage  = "INVALID_KEY_PACKAGE"
	CodeConflict           = "CONFLICT"
)

// ErrorCode возвращает код отказа DS или пустую строку.
func ErrorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// --- KeyPackage -------------------------------------------------------------

// UploadKeyPackages принимает одноразовые KeyPackage устройства. Первый пакет закрепляет за
// устройством ключ подписи; пакеты с другим ключом отвергаются (в продукте ключ устройства
// регистрируется отдельно и подписан ключом идентичности — B02/B04).
func (s *Service) UploadKeyPackages(ctx context.Context, deviceID string, raws [][]byte) error {
	policy := mlswire.KeyPackagePolicy{
		Now: s.cfg.Now(), MaxLifetime: s.cfg.MaxKeyPackageLifetime, ClockSkew: 5 * time.Minute,
	}
	kps := make([]mlswire.KeyPackage, 0, len(raws))
	for _, raw := range raws {
		kp, err := mlswire.ParseKeyPackage(raw, policy)
		if err != nil {
			return dsErr(CodeInvalidKeyPackage, err.Error())
		}
		if string(kp.Identity) != deviceID {
			return dsErr(CodeInvalidKeyPackage, "credential не совпадает с устройством")
		}
		if len(kps) > 0 && !bytes.Equal(kps[0].SignatureKey, kp.SignatureKey) {
			return dsErr(CodeInvalidKeyPackage, "разные ключи подписи в одной пачке")
		}
		if time.Unix(int64(kp.NotAfter), 0).Before(policy.Now.Add(s.cfg.MinKeyPackageLifetime)) { //nolint:gosec
			return dsErr(CodeInvalidKeyPackage, "срок KeyPackage слишком короткий")
		}
		kps = append(kps, kp)
	}
	if len(kps) == 0 {
		return nil
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var key []byte
		err := tx.QueryRow(ctx, `INSERT INTO devices (id, signature_key) VALUES ($1, $2)
			ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING signature_key`,
			deviceID, kps[0].SignatureKey).Scan(&key)
		if err != nil {
			return err
		}
		if !bytes.Equal(key, kps[0].SignatureKey) {
			return dsErr(CodeInvalidKeyPackage, "ключ подписи не совпадает с ключом устройства")
		}
		type hk struct{ key, ref []byte }
		var keys []hk
		for i, kp := range kps {
			tag, err := tx.Exec(ctx, `INSERT INTO key_packages (ref, device_id, blob, init_key, encryption_key, not_after)
				VALUES ($1, $2, $3, $4, $5, to_timestamp($6)) ON CONFLICT (ref) DO NOTHING`,
				kp.Ref, deviceID, raws[i], kp.InitKey, kp.EncryptionKey, int64(kp.NotAfter)) //nolint:gosec // секунды
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				continue // тот же пакет загружен повторно
			}
			keys = append(keys, hk{kp.InitKey, kp.Ref}, hk{kp.EncryptionKey, kp.Ref})
		}
		if len(keys) == 0 {
			return nil
		}
		// init и encryption — в одно пространство ключей: совпадение в любой паре столбцов (в
		// том числе init одного пакета с encryption другого) — отказ. Ключи вставляются одним
		// оператором в отсортированном порядке: две загрузки со скрещёнными ключами иначе
		// взаимоблокировались бы вместо отказа (раунд 3, П4).
		slices.SortFunc(keys, func(a, b hk) int { return bytes.Compare(a.key, b.key) })
		ks := make([][]byte, len(keys))
		rs := make([][]byte, len(keys))
		for i, k := range keys {
			ks[i], rs[i] = k.key, k.ref
		}
		_, err = tx.Exec(ctx, `INSERT INTO hpke_keys (key, ref) SELECT * FROM unnest($1::bytea[], $2::bytea[])`, ks, rs)
		if isUniqueViolation(err) {
			return dsErr(CodeInvalidKeyPackage, "HPKE-ключ KeyPackage уже использован")
		}
		return err
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// --- группы -----------------------------------------------------------------

type group struct {
	id        []byte
	epoch     uint64
	lastSeq   uint64
	leafLimit int
}

// CreateGroup регистрирует группу в эпохе 0 с создателем в листе 0.
func (s *Service) CreateGroup(ctx context.Context, groupID []byte, creator string, leafLimit int) error {
	if leafLimit <= 0 {
		leafLimit = s.cfg.LeafLimit
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO mls_groups (id, epoch, last_seq, leaf_limit)
			VALUES ($1, 0, 0, $2) ON CONFLICT DO NOTHING`, groupID, leafLimit)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return dsErr(CodeConflict, "группа уже есть")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO group_counters (group_id, leaf_limit, leaf_count, done)
			VALUES ($1, $2, 1, 0)`, groupID, leafLimit); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO group_requests (group_id, requested) VALUES ($1, 0)`, groupID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO group_leaves (group_id, leaf, device_id) VALUES ($1, 0, $2)`,
			groupID, creator)
		return err
	})
}

// GroupState — состояние группы для клиента и отчёта.
type GroupState struct {
	Epoch   uint64            `json:"epoch"`
	LastSeq uint64            `json:"last_seq"`
	Leaves  map[uint32]string `json:"leaves"`
}

// Group возвращает эпоху, последний seq и карту листьев одним запросом — одним снимком,
// чтобы клиент мог сверить свой состав с картой DS в той же эпохе.
func (s *Service) Group(ctx context.Context, groupID []byte) (GroupState, error) {
	st := GroupState{Leaves: map[uint32]string{}}
	rows, err := s.pool.Query(ctx, `SELECT g.epoch, g.last_seq, l.leaf, l.device_id
		FROM mls_groups g LEFT JOIN group_leaves l ON l.group_id = g.id WHERE g.id = $1`, groupID)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var leaf *int32
		var dev *string
		if err = rows.Scan(&st.Epoch, &st.LastSeq, &leaf, &dev); err != nil {
			return st, err
		}
		found = true
		if leaf != nil && dev != nil {
			st.Leaves[uint32(*leaf)] = *dev //nolint:gosec // лист неотрицателен
		}
	}
	if err = rows.Err(); err != nil {
		return st, err
	}
	if !found {
		return st, dsErr(CodeNotFound, "группа не найдена")
	}
	return st, nil
}

// withGroup выполняет fn в транзакции под блокировкой группы и пишет новые epoch/last_seq.
func (s *Service) withGroup(ctx context.Context, groupID []byte, op string, fn func(pgx.Tx, *group) error) error {
	start := time.Now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Строка группы блокируется первой в обоих режимах: commit и публикация трогают
	// pending_ops, а заявка на вход — строку группы и затем pending_ops; при другом порядке
	// они взаимоблокируются (ревью N2). В advisory-режиме строка берётся FOR NO KEY UPDATE —
	// этого хватает, чтобы заявка с UPDATE счётчика ждала конца commit-а.
	q := `SELECT epoch, last_seq, leaf_limit FROM mls_groups WHERE id = $1`
	if s.cfg.Lock == LockAdvisory {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
			hex.EncodeToString(groupID)); err != nil {
			return err
		}
		q += ` FOR NO KEY UPDATE`
	} else {
		q += ` FOR UPDATE`
	}
	g := &group{id: groupID}
	var limit int32
	err = tx.QueryRow(ctx, q, groupID).Scan(&g.epoch, &g.lastSeq, &limit)
	if errors.Is(err, pgx.ErrNoRows) {
		return dsErr(CodeNotFound, "группа не найдена")
	}
	if err != nil {
		return err
	}
	g.leafLimit = int(limit)
	acquired := time.Now()
	s.Stats.observeDur("lock_wait."+op, acquired.Sub(start))
	epoch0, seq0 := g.epoch, g.lastSeq
	if err = fn(tx, g); err != nil {
		return err
	}
	if g.epoch != epoch0 || g.lastSeq != seq0 {
		if _, err = tx.Exec(ctx, `UPDATE mls_groups SET epoch = $2, last_seq = $3 WHERE id = $1`,
			groupID, g.epoch, g.lastSeq); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.Stats.observeDur("lock_hold."+op, time.Since(acquired))
	return nil
}

// hsItem — handshake для вставки; epoch — эпоха, в которой сообщение создано.
type hsItem struct {
	epoch  uint64
	kind   Kind
	sender *string
	blob   []byte
}

// insertHandshakes вставляет сообщения одним запросом (unnest), присваивая seq по порядку.
func insertHandshakes(ctx context.Context, tx pgx.Tx, g *group, items []hsItem) error {
	if len(items) == 0 {
		return nil
	}
	seqs := make([]int64, len(items))
	epochs := make([]int64, len(items))
	kinds := make([]int16, len(items))
	senders := make([]*string, len(items))
	blobs := make([][]byte, len(items))
	for i, it := range items {
		g.lastSeq++
		seqs[i] = int64(g.lastSeq)  //nolint:gosec // seq < 2^63
		epochs[i] = int64(it.epoch) //nolint:gosec
		kinds[i] = int16(it.kind)
		senders[i] = it.sender
		blobs[i] = it.blob
	}
	_, err := tx.Exec(ctx, `INSERT INTO mls_handshakes (group_id, seq, epoch, kind, sender_device_id, blob)
		SELECT $1, t.s, t.e, t.k, t.d, t.b
		FROM unnest($2::bigint[], $3::bigint[], $4::smallint[], $5::text[], $6::bytea[]) AS t(s, e, k, d, b)`,
		g.id, seqs, epochs, kinds, senders, blobs)
	return err
}

func insertHandshake(ctx context.Context, tx pgx.Tx, g *group, kind Kind, sender *string, blob []byte) (uint64, error) {
	err := insertHandshakes(ctx, tx, g, []hsItem{{epoch: g.epoch, kind: kind, sender: sender, blob: blob}})
	return g.lastSeq, err
}

type roster struct {
	leafToDev map[uint32]string
	devToLeaf map[string]uint32
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func loadRoster(ctx context.Context, q querier, groupID []byte) (roster, error) {
	r := roster{leafToDev: map[uint32]string{}, devToLeaf: map[string]uint32{}}
	rows, err := q.Query(ctx, `SELECT leaf, device_id FROM group_leaves WHERE group_id = $1`, groupID)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	for rows.Next() {
		var leaf int32
		var dev string
		if err = rows.Scan(&leaf, &dev); err != nil {
			return r, err
		}
		r.leafToDev[uint32(leaf)] = dev //nolint:gosec // лист неотрицателен
		r.devToLeaf[dev] = uint32(leaf) //nolint:gosec
	}
	return r, rows.Err()
}

type pendingOp struct {
	device     string
	op         int16
	kpRef      []byte
	kpBlob     []byte
	kpNotAfter time.Time
	leaf       uint32
	state      int16
	firstEpoch uint64
	revoked    bool
}

func loadOps(ctx context.Context, tx pgx.Tx, groupID []byte) (map[string]pendingOp, error) {
	rows, err := tx.Query(ctx, `SELECT o.device_id, o.op, o.kp_ref, k.blob, k.not_after, o.leaf, o.state,
			o.first_epoch, o.revoked
		FROM pending_ops o LEFT JOIN key_packages k ON k.ref = o.kp_ref WHERE o.group_id = $1`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ops := map[string]pendingOp{}
	for rows.Next() {
		var o pendingOp
		var leaf *int32
		var notAfter *time.Time
		var first *int64
		if err = rows.Scan(&o.device, &o.op, &o.kpRef, &o.kpBlob, &notAfter, &leaf, &o.state, &first, &o.revoked); err != nil {
			return nil, err
		}
		if leaf != nil {
			o.leaf = uint32(*leaf) //nolint:gosec
		}
		if notAfter != nil {
			o.kpNotAfter = *notAfter
		}
		if first != nil {
			o.firstEpoch = uint64(*first) //nolint:gosec
		}
		ops[o.device] = o
	}
	return ops, rows.Err()
}

// --- external sender: вход и выход ------------------------------------------

// errQueued — заявка уже стоит в очереди: транзакция откатывается, ответ — успех.
var errQueued = errors.New("уже в очереди")

// errRevived — отменённый опубликованный Add снова действителен; транзакцию заявки нужно
// откатить (её UPDATE счётчика лишний), а снятие отметки сделать отдельно.
var errRevived = errors.New("заявка восстановлена")

// reviveJoin снимает отметку отмены с опубликованного Add (повторное приглашение). Строка
// группы берётся первой: commit, который как раз принимает этот Add, держит её до конца, и
// отметка снимается либо до него (вход состоится), либо после (заявка уже обработана).
func (s *Service) reviveJoin(ctx context.Context, tx pgx.Tx, groupID []byte, device string) error {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM mls_groups WHERE id = $1 FOR NO KEY UPDATE`, groupID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE pending_ops SET revoked = false WHERE group_id = $1 AND device_id = $2
		AND op = 1 AND revoked`, groupID, device)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Отменённый Add успели закоммитить или снять — заявку нужно подать заново.
		return dsErr(CodeConflict, "заявка изменилась, повторите")
	}
	s.Stats.inc("join.revived", 1)
	return nil
}

// memberCheck отвечает на заявку устройства, которое уже стоит в карте листьев: ALREADY_MEMBER,
// а если его Remove опубликован и ещё не закоммичен — CONFLICT: устройство вот-вот удалят, и
// приглашение надо повторить после удаления, иначе оно молча потерялось бы (ревью, раунд 3, Н4).
func memberCheck(ctx context.Context, q rowQuerier, groupID []byte, device string) error {
	var member, removing bool
	if err := q.QueryRow(ctx, `SELECT
		EXISTS (SELECT 1 FROM group_leaves WHERE group_id = $1 AND device_id = $2),
		EXISTS (SELECT 1 FROM pending_ops WHERE group_id = $1 AND device_id = $2 AND op = 2 AND state = 1)`,
		groupID, device).Scan(&member, &removing); err != nil {
		return err
	}
	switch {
	case member && removing:
		return dsErr(CodeConflict, "устройство удаляется, повторите после удаления")
	case member:
		return dsErr(CodeAlreadyMember, "устройство уже в группе")
	}
	return nil
}

// RequestJoin ставит устройство в очередь на вход в группу (в продукте — по приглашению,
// подтверждению устройства или правам на канал). Блокировку handshake-сообщений группы
// заявка не берёт: лимит листьев проверяется атомарным счётчиком
// листья + (запрошено − выполнено) < лимит по двум строкам счётчиков (schema.sql). При BatchInterval = 0 Add
// публикуется сразу — тогда уже под блокировкой группы.
func (s *Service) RequestJoin(ctx context.Context, groupID []byte, device string) error {
	start := time.Now()
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := memberCheck(ctx, tx, groupID, device); err != nil {
			return err
		}
		var hasKP, hasOp bool
		err := tx.QueryRow(ctx, `SELECT
			EXISTS (SELECT 1 FROM key_packages WHERE device_id = $2 AND claimed_at IS NULL AND not_after > now()),
			EXISTS (SELECT 1 FROM pending_ops WHERE group_id = $1 AND device_id = $2)`,
			groupID, device).Scan(&hasKP, &hasOp)
		if err != nil {
			return err
		}
		// Свободный KeyPackage нужен только новой заявке: у стоящей в очереди он уже
		// зарезервирован (повтор заявки, повторное приглашение после отмены).
		if !hasKP && !hasOp {
			return dsErr(CodeNoKeyPackages, "у устройства нет свободных KeyPackage")
		}
		// Порядок: сначала строка заявки, потом строка счётчика заявок (UPDATE) — последней, на
		// одну фиксацию. Строку группы и строку счётчиков commit-ов заявка не блокирует, поэтому
		// commit-ы не стоят в очереди за заявками. Внешних ключей на mls_groups у pending_ops
		// нет, поэтому KEY SHARE не повышается до UPDATE (это была взаимоблокировка первой
		// версии). Commit берёт строку группы → pending_ops → group_counters; заявка — свою
		// строку pending_ops → group_requests: общих блокировок, кроме строк pending_ops, нет.
		tag, err := tx.Exec(ctx, `INSERT INTO pending_ops (group_id, device_id, op, state)
			VALUES ($1, $2, 1, 0) ON CONFLICT (group_id, device_id) DO NOTHING`, groupID, device)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var op, state int16
			var revoked bool
			err = tx.QueryRow(ctx, `SELECT op, state, revoked FROM pending_ops WHERE group_id = $1 AND device_id = $2
				FOR UPDATE`, groupID, device).Scan(&op, &state, &revoked)
			if errors.Is(err, pgx.ErrNoRows) {
				// Строку заявки только что удалил commit: чаще всего он и добавил устройство.
				if err = memberCheck(ctx, tx, groupID, device); err != nil {
					return err
				}
				return dsErr(CodeConflict, "заявка изменилась, повторите")
			}
			if err != nil {
				return err
			}
			switch {
			case state == stateAwaitingConfirm || op == opRemove:
				return dsErr(CodeConflict, "удаление устройства ещё не подтверждено группой")
			case revoked:
				// Повторное приглашение после отмены (ревью N9): опубликованный Add снова
				// действителен; заявка уже учтена в счётчике.
				return errRevived
			}
			return errQueued
		}
		tag, err = tx.Exec(ctx, `UPDATE group_requests r SET requested = r.requested + 1
			FROM group_counters c
			WHERE r.group_id = $1 AND c.group_id = $1 AND c.leaf_count + (r.requested - c.done) < c.leaf_limit`, groupID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var exists bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM mls_groups WHERE id = $1)`, groupID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return dsErr(CodeNotFound, "группа не найдена")
			}
			s.Stats.inc("join.rejected_limit", 1)
			return dsErr(CodeMemberLimit, "достигнут лимит участников")
		}
		// Членство проверяется ещё раз — уже после того, как вставка выше дождалась commit-а,
		// который удалял прежнюю заявку этого устройства (а значит, добавлял его). Без этой
		// проверки заявка, разминувшаяся с commit-ом, оставила бы вошедшему устройству
		// «висящий» Add, и его Remove потом не записался бы (ревью N1). Откат снимает и
		// вставку, и счётчик.
		return memberCheck(ctx, tx, groupID, device)
	})
	s.Stats.observeDur("join_tx", time.Since(start))
	if errors.Is(err, errQueued) {
		return nil
	}
	if errors.Is(err, errRevived) {
		return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error { return s.reviveJoin(ctx, tx, groupID, device) })
	}
	if err != nil {
		return err
	}
	s.Stats.inc("join.queued", 1)
	publish := s.cfg.BatchInterval == 0
	if s.cfg.LeadingEdge {
		// Без блокировки: если Add уже ждут commit-а, заявку опубликует продолжение после
		// commit-а (или тик, если заявка разминулась с ним).
		if err = s.pool.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM pending_ops
			WHERE group_id = $1 AND op = 1 AND state = 1)`, groupID).Scan(&publish); err != nil {
			return err
		}
	}
	if publish {
		n := 0
		if err = s.withGroup(ctx, groupID, "publish", func(tx pgx.Tx, g *group) error {
			n, err = s.publishQueued(ctx, tx, g)
			return err
		}); err != nil {
			return err
		}
		if n > 0 {
			s.notify.fire(groupKey(groupID))
		}
	}
	return nil
}

// claimKeyPackage резервирует свободный KeyPackage устройства с самым поздним сроком (и с
// остатком больше $2). Срок пакета проверяет каждый получатель по своим часам в момент
// обработки commit-а, и устройство, обработавшее commit позже срока, застревает в старой эпохе
// (раунд 3) — поэтому берётся самый «долгий» пакет, а нижняя граница — горизонт офлайна.
const claimKeyPackage = `UPDATE key_packages SET claimed_at = now() WHERE ref = (
		SELECT ref FROM key_packages WHERE device_id = $1 AND claimed_at IS NULL AND not_after > $2
		ORDER BY not_after DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
	RETURNING ref, blob`

// minNotAfter — нижняя граница срока KeyPackage, пригодного к публикации.
func (s *Service) minNotAfter() time.Time { return s.cfg.Now().Add(s.cfg.MinKeyPackageLifetime) }

// publishQueued публикует Add для стоящих в очереди устройств в текущей эпохе. Одновременно
// ждёт commit-а не больше MaxBatch добавлений: следующая пачка уходит после commit-а.
// Вызывается под блокировкой группы.
func (s *Service) publishQueued(ctx context.Context, tx pgx.Tx, g *group) (int, error) {
	limit := -1
	if s.cfg.MaxBatch > 0 {
		var outstanding int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM pending_ops
			WHERE group_id = $1 AND op = 1 AND state = 1`, g.id).Scan(&outstanding); err != nil {
			return 0, err
		}
		limit = s.cfg.MaxBatch - outstanding
		if limit <= 0 {
			return 0, nil
		}
	}
	q := `SELECT device_id FROM pending_ops WHERE group_id = $1 AND state = 0 ORDER BY requested_at`
	args := []any{g.id}
	if limit > 0 {
		q += ` LIMIT $2`
		args = append(args, limit)
	}
	rows, err := tx.Query(ctx, q, args...)
	if err != nil {
		return 0, err
	}
	devices, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(devices) == 0 {
		return 0, err
	}
	// Страховка к проверке в RequestJoin: заявка устройства, которое уже стоит в карте листьев,
	// снимается, а не публикуется (ревью N1). Проверяются только кандидаты пачки — поиском по
	// уникальному индексу group_leaves (group_id, device_id); соединение всей очереди со всеми
	// листьями после TRUNCATE давало квадратичный план и держало блокировку группы сотни мс.
	rows, err = tx.Query(ctx, `SELECT device_id FROM group_leaves WHERE group_id = $1 AND device_id = ANY($2)`,
		g.id, devices)
	if err != nil {
		return 0, err
	}
	members, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	if len(members) > 0 {
		if _, err = tx.Exec(ctx, `DELETE FROM pending_ops WHERE group_id = $1 AND device_id = ANY($2) AND op = 1 AND state = 0`,
			g.id, members); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `UPDATE group_counters SET done = done + $2 WHERE group_id = $1`,
			g.id, len(members)); err != nil {
			return 0, err
		}
		s.Stats.inc("join.dangling_dropped", int64(len(members)))
		devices = slices.DeleteFunc(devices, func(d string) bool { return slices.Contains(members, d) })
		if len(devices) == 0 {
			return 0, nil
		}
	}
	// Резервирование KeyPackage — конвейером одного round-trip.
	batch := &pgx.Batch{}
	for _, dev := range devices {
		batch.Queue(claimKeyPackage, dev, s.minNotAfter())
	}
	br := tx.SendBatch(ctx, batch)
	var published, dropped []string
	var refs [][]byte
	items := make([]hsItem, 0, len(devices))
	for _, dev := range devices {
		var ref, blob []byte
		err = br.QueryRow().Scan(&ref, &blob)
		if errors.Is(err, pgx.ErrNoRows) {
			dropped = append(dropped, dev) // KeyPackage кончились между заявкой и публикацией
			continue
		}
		if err != nil {
			_ = br.Close()
			return 0, err
		}
		published = append(published, dev)
		refs = append(refs, ref)
		items = append(items, hsItem{epoch: g.epoch, kind: KindProposal,
			blob: s.cfg.ExternalSender.ProposeAdd(g.id, g.epoch, blob, mlswire.ProposalAAD(dev))})
	}
	if err = br.Close(); err != nil {
		return 0, err
	}
	if err = insertHandshakes(ctx, tx, g, items); err != nil {
		return 0, err
	}
	if len(published) > 0 {
		if _, err = tx.Exec(ctx, `UPDATE pending_ops o SET state = 1, kp_ref = t.ref, published_epoch = $2,
				first_epoch = COALESCE(o.first_epoch, $2)
			FROM unnest($3::text[], $4::bytea[]) AS t(d, ref)
			WHERE o.group_id = $1 AND o.device_id = t.d`, g.id, g.epoch, published, refs); err != nil {
			return 0, err
		}
	}
	if len(dropped) > 0 {
		s.Stats.inc("join.dropped_no_kp", int64(len(dropped)))
		if _, err = tx.Exec(ctx, `DELETE FROM pending_ops WHERE group_id = $1 AND device_id = ANY($2)`,
			g.id, dropped); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `UPDATE group_counters SET done = done + $2 WHERE group_id = $1`,
			g.id, len(dropped)); err != nil {
			return 0, err
		}
	}
	s.Stats.inc("proposals.add", int64(len(published)))
	if len(published) > 0 {
		s.Stats.inc("batches", 1)
		s.Stats.observe("batch_size", float64(len(published)))
	}
	return len(published), nil
}

// PublishTick публикует накопленные Add во всех группах; вызывается батчером раз в BatchInterval.
func (s *Service) PublishTick(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT group_id FROM pending_ops WHERE state = 0`)
	if err != nil {
		return err
	}
	groups, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil {
		return err
	}
	// Ошибка одной группы не останавливает остальные (ревью, раунд 3, Н6): иначе одна
	// испорченная группа (в продукте — заявки удалённой группы) ломала бы тик всем за ней.
	var first error
	for _, gid := range groups {
		n := 0
		if err := s.withGroup(ctx, gid, "batch", func(tx pgx.Tx, g *group) error {
			var err error
			n, err = s.publishQueued(ctx, tx, g)
			return err
		}); err != nil {
			s.Stats.inc("batch.group_errors", 1)
			if first == nil {
				first = err
			}
			continue
		}
		if n > 0 {
			s.notify.fire(groupKey(gid))
		}
	}
	return first
}

// RunBatcher вызывает PublishTick раз в BatchInterval до отмены ctx.
func (s *Service) RunBatcher(ctx context.Context) {
	if s.cfg.BatchInterval <= 0 {
		return
	}
	t := time.NewTicker(s.cfg.BatchInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.PublishTick(ctx); err != nil && ctx.Err() == nil {
				s.Stats.inc("batch.errors", 1)
			}
		}
	}
}

// RequestRemove публикует Remove устройства сразу (удаление не батчится: от него зависит
// PCS). Пока Remove не закоммичен, DS повторяет его в каждой новой эпохе и не принимает
// commit от удаляемого устройства (ADR-0016 п. 4).
func (s *Service) RequestRemove(ctx context.Context, groupID []byte, device string) error {
	err := s.withGroup(ctx, groupID, "remove", func(tx pgx.Tx, g *group) error {
		r, err := loadRoster(ctx, tx, groupID)
		if err != nil {
			return err
		}
		leaf, ok := r.devToLeaf[device]
		if !ok {
			// Заявка в очереди (Add ещё не опубликован): снимаем её, освобождаем KeyPackage и место
			// в лимите. Опубликованный Add отменить нельзя — он уже лежит в очередях участников, и
			// commit его включит; такой вход помечается отменённым: DS примет commit, Welcome не
			// выдаст и сразу опубликует Remove.
			tag, err := tx.Exec(ctx, `WITH d AS (DELETE FROM pending_ops WHERE group_id = $1 AND device_id = $2
				AND op = 1 AND state = 0 RETURNING device_id) UPDATE group_counters SET done = done + 1
				WHERE group_id = $1 AND EXISTS (SELECT 1 FROM d)`, groupID, device)
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				s.Stats.inc("join.cancelled", 1)
				return nil
			}
			tag, err = tx.Exec(ctx, `UPDATE pending_ops SET revoked = true WHERE group_id = $1 AND device_id = $2
				AND op = 1 AND state = 1`, groupID, device)
			if err == nil && tag.RowsAffected() > 0 {
				s.Stats.inc("join.revoked", 1)
			}
			return err
		}
		// Висящая заявка на вход у уже вошедшего устройства заменяется на Remove: иначе строка
		// Remove не записалась бы (конфликт ключа), а commit с опубликованным Remove DS отверг
		// бы как Remove без предложения сервера (ревью N1). Опубликованный пакет израсходован.
		var kpRef []byte
		var prev int16
		err = tx.QueryRow(ctx, `DELETE FROM pending_ops WHERE group_id = $1 AND device_id = $2 AND op = 1
			RETURNING kp_ref, state`, groupID, device).Scan(&kpRef, &prev)
		switch {
		case err == nil:
			if kpRef != nil {
				if _, err = tx.Exec(ctx, `UPDATE key_packages SET consumed_at = now() WHERE ref = $1`, kpRef); err != nil {
					return err
				}
			}
			if _, err = tx.Exec(ctx, `UPDATE group_counters SET done = done + 1 WHERE group_id = $1`, groupID); err != nil {
				return err
			}
			s.Stats.inc("join.dangling_replaced", 1)
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO pending_ops (group_id, device_id, op, leaf, state, published_epoch)
			VALUES ($1, $2, 2, $3, 1, $4) ON CONFLICT (group_id, device_id) DO NOTHING`,
			groupID, device, int32(leaf), g.epoch) //nolint:gosec
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil // Remove уже опубликован и повторяется в каждой эпохе
		}
		// Недоставленный Welcome удаляемого устройства больше не выдаётся: иначе устройство,
		// добавленное, пока было офлайн, после бана прочитало бы трафик эпох до своего удаления
		// (ревью, раунд 3, Н2) — так же, как Welcome не выдаётся отменённому входу.
		if _, err = tx.Exec(ctx, `DELETE FROM welcome_deliveries d USING welcomes w
			WHERE d.device_id = $2 AND d.delivered_at IS NULL AND w.id = d.welcome_id AND w.group_id = $1`,
			groupID, device); err != nil {
			return err
		}
		_, err = insertHandshake(ctx, tx, g, KindProposal, nil,
			s.cfg.ExternalSender.ProposeRemove(groupID, g.epoch, leaf, mlswire.ProposalAAD(device)))
		s.Stats.inc("proposals.remove", 1)
		return err
	})
	if err == nil {
		s.notify.fire(groupKey(groupID))
	}
	return err
}

// --- приём handshake ----------------------------------------------------------

// Accepted — результат принятого handshake.
type Accepted struct {
	Seq   uint64 `json:"seq"`
	Epoch uint64 `json:"epoch"` // эпоха группы после сообщения
}

// SubmitHandshake принимает Proposal, Commit или external commit от устройства `sender`.
// `welcome` — Welcome новых устройств, если commit их добавляет.
func (s *Service) SubmitHandshake(ctx context.Context, groupID []byte, sender string, kind Kind, blob, welcome []byte) (Accepted, error) {
	h, err := mlswire.ParseHeader(blob)
	if err != nil {
		return Accepted{}, dsErr(CodeBadMessage, err.Error())
	}
	if !bytes.Equal(h.GroupID, groupID) {
		return Accepted{}, dsErr(CodeBadMessage, "group_id в заголовке не совпадает")
	}
	// Вид сообщения сверяется с открытым заголовком (REST.md, ADR-0016 п. 2).
	switch kind {
	case KindProposal:
		if h.WireFormat != mlswire.WireFormatPrivate || h.ContentType != mlswire.ContentProposal {
			return Accepted{}, dsErr(CodeBadMessage, "proposal участника — только PrivateMessage")
		}
		// Клиент спайка не принимает предложений от участников (только Add/Remove сервера),
		// поэтому DS их не разносит: иначе он только плодил бы отказы у получателей.
		return Accepted{}, dsErr(CodeUnauthorizedChange, "предложения участников не принимаются")
	case KindCommit:
		if h.WireFormat != mlswire.WireFormatPrivate || h.ContentType != mlswire.ContentCommit {
			return Accepted{}, dsErr(CodeBadMessage, "commit участника — только PrivateMessage")
		}
	case KindExternalCommit:
		if h.WireFormat != mlswire.WireFormatPublic || h.ContentType != mlswire.ContentCommit ||
			h.SenderType != mlswire.SenderNewMemberCommit {
			return Accepted{}, dsErr(CodeBadMessage, "external commit — PublicMessage от new_member_commit")
		}
	default:
		return Accepted{}, dsErr(CodeBadMessage, "неизвестный вид")
	}
	// Быстрый отказ без блокировки: проигравший гонку commit не встаёт в очередь на lock.
	var current uint64
	if err = s.pool.QueryRow(ctx, `SELECT epoch FROM mls_groups WHERE id = $1`, groupID).Scan(&current); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Accepted{}, dsErr(CodeNotFound, "группа не найдена")
		}
		return Accepted{}, err
	}
	if h.Epoch != current {
		// Повтор уже принятого commit-а (ответ DS потерялся): тот же результат, без отказа —
		// иначе автор сбросил бы свой commit и отстал бы от группы, которую сам же и продвинул.
		if h.Epoch+1 == current {
			if acc, ok, err := acceptedCommit(ctx, s.pool, groupID, h.Epoch, blob); err != nil || ok {
				if ok {
					s.Stats.inc("accepted.duplicate", 1)
				}
				return acc, err
			}
		}
		s.Stats.inc("reject.epoch_early", 1)
		return Accepted{}, &Error{Code: CodeEpochMismatch, CurrentEpoch: current, Msg: "эпоха устарела"}
	}
	if len(h.AAD) > maxAAD {
		return Accepted{}, dsErr(CodeBadDelta, "дельта слишком велика")
	}
	delta, err := mlswire.ParseRosterDelta(h.AAD)
	if err != nil {
		s.Stats.inc("reject.bad_delta", 1)
		return Accepted{}, dsErr(CodeBadDelta, err.Error())
	}
	if len(delta.Added)+len(delta.Removed) > maxDeltaEntries {
		return Accepted{}, dsErr(CodeBadDelta, "дельта слишком велика")
	}
	var wh mlswire.WelcomeHeader
	if len(welcome) > 0 {
		if wh, err = mlswire.ParseWelcome(welcome); err != nil {
			return Accepted{}, dsErr(CodeBadWelcome, err.Error())
		}
	}

	var acc Accepted
	var recipients []string
	var duplicate bool
	const op = "commit"
	err = s.withGroup(ctx, groupID, op, func(tx pgx.Tx, g *group) error {
		if h.Epoch != g.epoch {
			// Тот же commit мог проскочить быстрый путь одновременно с первым экземпляром и
			// дождаться блокировки, когда первый уже принят (ревью N4).
			if h.Epoch+1 == g.epoch {
				a, ok, err := acceptedCommit(ctx, tx, groupID, h.Epoch, blob)
				if err != nil {
					return err
				}
				if ok {
					acc, duplicate = a, true
					return nil
				}
			}
			s.Stats.inc("reject.epoch_locked", 1)
			return &Error{Code: CodeEpochMismatch, CurrentEpoch: g.epoch, Msg: "эпоха устарела"}
		}
		r, err := loadRoster(ctx, tx, groupID)
		if err != nil {
			return err
		}
		ops, err := loadOps(ctx, tx, groupID)
		if err != nil {
			return err
		}
		if recipients, err = s.checkCommit(g, r, ops, kind, sender, delta, welcome, wh); err != nil {
			return err
		}
		if acc.Seq, err = s.applyCommit(ctx, tx, g, r, ops, kind, sender, blob, delta, welcome, recipients); err != nil {
			return err
		}
		acc.Epoch = g.epoch
		return nil
	})
	if err != nil {
		if code := ErrorCode(err); code != "" {
			s.Stats.inc("reject."+code, 1)
		}
		return Accepted{}, err
	}
	if duplicate {
		s.Stats.inc("accepted.duplicate", 1)
		return acc, nil
	}
	s.Stats.inc("accepted."+op, 1)
	keys := []string{groupKey(groupID)}
	for _, d := range recipients {
		keys = append(keys, deviceKey(d))
	}
	s.notify.fire(keys...)
	return acc, nil
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// acceptedCommit проверяет, не тот ли это commit, что уже принят в эпохе `epoch`.
func acceptedCommit(ctx context.Context, q rowQuerier, groupID []byte, epoch uint64, blob []byte) (Accepted, bool, error) {
	var seq uint64
	var stored []byte
	err := q.QueryRow(ctx, `SELECT seq, blob FROM mls_handshakes
		WHERE group_id = $1 AND epoch = $2 AND kind IN ($3, $4)`, groupID, epoch, KindCommit, KindExternalCommit).
		Scan(&seq, &stored)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !bytes.Equal(stored, blob)) {
		return Accepted{}, false, nil
	}
	if err != nil {
		return Accepted{}, false, err
	}
	return Accepted{Seq: seq, Epoch: epoch + 1}, true, nil
}

// checkCommit сверяет дельту состава с картой листьев, ожидающими предложениями сервера и
// адресатами Welcome. Возвращает устройства, которым доставить Welcome.
func (s *Service) checkCommit(g *group, r roster, ops map[string]pendingOp, kind Kind, sender string,
	delta mlswire.RosterDelta, welcome []byte, wh mlswire.WelcomeHeader) ([]string, error) {
	senderLeaf, isMember := r.devToLeaf[sender]
	if kind == KindCommit {
		if !isMember {
			return nil, dsErr(CodeNotGroupMember, "отправитель не в группе")
		}
		// По опубликованному Remove листа отправителя, а не по ключу устройства в очереди:
		// у вошедшего устройства не должно быть никакой другой операции (ревью N1).
		for _, o := range ops {
			if o.op == opRemove && o.state == statePublished && o.leaf == senderLeaf {
				return nil, dsErr(CodeRemovalPending, "устройство удаляется и не может коммитить")
			}
		}
	} else if !s.cfg.AllowExternalCommit {
		return nil, dsErr(CodeUnauthorizedChange, "external commit не разрешён")
	}
	removed := map[uint32]bool{}
	for _, l := range delta.Removed {
		dev, ok := r.leafToDev[l]
		if !ok {
			return nil, dsErr(CodeBadDelta, "удаляется пустой лист")
		}
		o, pending := ops[dev]
		allowed := pending && o.op == opRemove && o.state == statePublished && o.leaf == l
		// External commit может убрать старый лист самого присоединяющегося (пересинхронизация).
		if kind == KindExternalCommit && isMember && l == senderLeaf {
			allowed = true
		}
		if !allowed {
			return nil, dsErr(CodeUnauthorizedChange, "Remove без предложения сервера")
		}
		removed[l] = true
	}
	// Commit обязан включить все опубликованные Remove: иначе удаляемое устройство осталось
	// бы в группе ещё на эпоху (ADR-0016 п. 4). External commit ссылаться на предложения не
	// может (RFC 9420 §12.4.3.2), поэтому при опубликованном Remove он не принимается вовсе:
	// сначала Remove коммитит участник (ревью N5).
	for _, o := range ops {
		if o.op == opRemove && o.state == statePublished && !removed[o.leaf] {
			return nil, dsErr(CodeProposalsMissing, "в commit нет опубликованного Remove")
		}
	}
	occupied := make(map[uint32]struct{}, len(r.leafToDev))
	for l := range r.leafToDev {
		occupied[l] = struct{}{}
	}
	expected := mlswire.AssignLeaves(occupied, delta.Removed, len(delta.Added))
	added := make([]string, 0, len(delta.Added))
	var revoked []string
	for i, a := range delta.Added {
		dev := string(a.DeviceID)
		if a.Leaf != expected[i] {
			return nil, dsErr(CodeBadDelta, fmt.Sprintf("лист добавления %d, ожидался %d", a.Leaf, expected[i]))
		}
		if l, ok := r.devToLeaf[dev]; ok && !removed[l] {
			return nil, dsErr(CodeBadDelta, "устройство уже в группе")
		}
		o, ok := ops[dev]
		switch kind {
		case KindCommit:
			if !ok || o.op != opAdd || o.state != statePublished {
				return nil, dsErr(CodeUnauthorizedChange, "Add без предложения сервера")
			}
			if o.revoked {
				revoked = append(revoked, dev) // вход отменён: Welcome не выдаётся, следом Remove
			}
		case KindExternalCommit:
			if dev != sender || len(delta.Added) != 1 || !ok || o.op != opAdd || o.revoked {
				return nil, dsErr(CodeUnauthorizedChange, "external commit без права на вход")
			}
		}
		added = append(added, dev)
	}
	if kind == KindExternalCommit && len(added) != 1 {
		return nil, dsErr(CodeBadDelta, "external commit добавляет ровно одно устройство")
	}
	if len(r.leafToDev)-len(removed)+len(added) > g.leafLimit {
		return nil, dsErr(CodeMemberLimit, "достигнут лимит участников")
	}
	// Welcome: адресаты по KeyPackageRef — ровно добавленные commit-ом устройства.
	if kind != KindCommit || len(added) == 0 {
		if len(welcome) > 0 {
			return nil, dsErr(CodeBadWelcome, "Welcome без добавлений")
		}
		return nil, nil
	}
	if len(welcome) == 0 {
		return nil, dsErr(CodeBadWelcome, "нет Welcome для добавленных устройств")
	}
	refs := make(map[string]bool, len(wh.NewMembers))
	for _, ref := range wh.NewMembers {
		refs[string(ref)] = true
	}
	if len(refs) != len(added) {
		return nil, dsErr(CodeBadWelcome, "адресаты Welcome не совпадают с дельтой")
	}
	for _, dev := range added {
		if !refs[string(ops[dev].kpRef)] {
			return nil, dsErr(CodeBadWelcome, "адресаты Welcome не совпадают с дельтой")
		}
	}
	if len(revoked) == 0 {
		return added, nil
	}
	recipients := make([]string, 0, len(added))
	for _, dev := range added {
		if !slices.Contains(revoked, dev) {
			recipients = append(recipients, dev)
		}
	}
	return recipients, nil
}

func (s *Service) applyCommit(ctx context.Context, tx pgx.Tx, g *group, r roster, ops map[string]pendingOp, kind Kind,
	sender string, blob []byte, delta mlswire.RosterDelta, welcome []byte, recipients []string) (uint64, error) {
	if len(delta.Removed) > 0 {
		leaves := make([]int32, 0, len(delta.Removed))
		devs := make([]string, 0, len(delta.Removed))
		for _, l := range delta.Removed {
			leaves = append(leaves, int32(l)) //nolint:gosec // лист < 2^31
			devs = append(devs, r.leafToDev[l])
			delete(ops, r.leafToDev[l])
		}
		if _, err := tx.Exec(ctx, `DELETE FROM group_leaves WHERE group_id = $1 AND leaf = ANY($2)`, g.id, leaves); err != nil {
			return 0, err
		}
		// Remove закоммичен со слов автора commit-а; фактом он станет, когда другое устройство
		// закоммитит в новой эпохе (значит, применило этот commit). До того Remove помнится, и
		// если процедура восстановления рассинхрона отменит эпоху, его повторят.
		if _, err := tx.Exec(ctx, `UPDATE pending_ops SET state = $4, confirm_epoch = $3, committed_by = $5
			WHERE group_id = $1 AND device_id = ANY($2) AND op = 2`,
			g.id, devs, g.epoch+1, stateAwaitingConfirm, sender); err != nil {
			return 0, err
		}
	}
	// Этот commit подтверждает Remove, закоммиченные раньше другими устройствами.
	if _, err := tx.Exec(ctx, `DELETE FROM pending_ops WHERE group_id = $1 AND state = $2
		AND confirm_epoch <= $3 AND committed_by <> $4`, g.id, stateAwaitingConfirm, g.epoch, sender); err != nil {
		return 0, err
	}
	recipientRefs := make([][]byte, 0, len(recipients))
	for _, d := range recipients {
		recipientRefs = append(recipientRefs, ops[d].kpRef)
	}
	var revokedLeaves []mlswire.AddedLeaf
	if len(delta.Added) > 0 {
		leaves := make([]int32, 0, len(delta.Added))
		devs := make([]string, 0, len(delta.Added))
		var refs [][]byte
		for _, a := range delta.Added {
			dev := string(a.DeviceID)
			leaves = append(leaves, int32(a.Leaf)) //nolint:gosec
			devs = append(devs, dev)
			if ref := ops[dev].kpRef; ref != nil {
				refs = append(refs, ref)
			}
			if ops[dev].revoked {
				revokedLeaves = append(revokedLeaves, a)
			}
			delete(ops, dev)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO group_leaves (group_id, leaf, device_id)
			SELECT $1, t.l, t.d FROM unnest($2::int[], $3::text[]) AS t(l, d)`, g.id, leaves, devs); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM pending_ops WHERE group_id = $1 AND device_id = ANY($2)`, g.id, devs); err != nil {
			return 0, err
		}
		// KeyPackage израсходован; при external commit он не использован, но уже опубликован в
		// Add и повторно резервировать его нельзя.
		if _, err := tx.Exec(ctx, `UPDATE key_packages SET consumed_at = now() WHERE ref = ANY($1)`, refs); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE group_counters SET leaf_count = leaf_count + $2, done = done + $3
		WHERE group_id = $1`, g.id, len(delta.Added)-len(delta.Removed), len(delta.Added)); err != nil {
		return 0, err
	}
	seq, err := insertHandshake(ctx, tx, g, kind, &sender, blob)
	if err != nil {
		return 0, err
	}
	g.epoch++
	var items []hsItem
	for _, a := range revokedLeaves {
		dev := string(a.DeviceID)
		if _, err = tx.Exec(ctx, `INSERT INTO pending_ops (group_id, device_id, op, leaf, state, published_epoch)
			VALUES ($1, $2, 2, $3, 1, $4)`, g.id, dev, int32(a.Leaf), g.epoch); err != nil { //nolint:gosec
			return 0, err
		}
		items = append(items, hsItem{epoch: g.epoch, kind: KindProposal,
			blob: s.cfg.ExternalSender.ProposeRemove(g.id, g.epoch, a.Leaf, mlswire.ProposalAAD(dev))})
		s.Stats.inc("proposals.remove", 1)
	}
	s.Stats.inc("commit.added", int64(len(delta.Added)))
	s.Stats.inc("commit.removed", int64(len(delta.Removed)))
	s.Stats.observe("commit_bytes", float64(len(blob)))
	if len(recipients) > 0 {
		s.Stats.observe("welcome_bytes", float64(len(welcome)))
		var wid int64
		if err = tx.QueryRow(ctx, `INSERT INTO welcomes (group_id, epoch, blob) VALUES ($1, $2, $3) RETURNING id`,
			g.id, g.epoch, welcome).Scan(&wid); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO welcome_deliveries (device_id, welcome_id, kp_ref)
			SELECT t.d, $2, t.r FROM unnest($1::text[], $3::bytea[]) AS t(d, r)`, recipients, wid, recipientRefs); err != nil {
			return 0, err
		}
	}
	// Опубликованные, но не вошедшие в commit предложения действуют одну эпоху: повторяем их
	// в новой эпохе (Remove — обязательно, ADR-0016 п. 4; Add — чтобы вход не потерялся).
	// Add снимается, если вход отменён, если он ждёт дольше MaxAddEpochs или если у устройства
	// кончились KeyPackage с достаточным остатком срока.
	var dropped []string
	reissued := 0
	for _, o := range ops {
		if o.state != statePublished {
			continue
		}
		if o.op == opRemove {
			items = append(items, hsItem{epoch: g.epoch, kind: KindProposal,
				blob: s.cfg.ExternalSender.ProposeRemove(g.id, g.epoch, o.leaf, mlswire.ProposalAAD(o.device))})
			reissued++
			continue
		}
		if _, member := r.devToLeaf[o.device]; member {
			// Add уже вошедшего устройства не повторяется (страховка к ревью N1).
			s.Stats.inc("join.dangling_dropped", 1)
			dropped = append(dropped, o.device)
			continue
		}
		switch {
		case o.revoked:
			s.Stats.inc("join.cancelled", 1)
			dropped = append(dropped, o.device)
			continue
		case g.epoch-o.firstEpoch > uint64(s.cfg.MaxAddEpochs): //nolint:gosec
			s.Stats.inc("add.expired_epochs", 1)
			dropped = append(dropped, o.device)
			continue
		}
		blob := o.kpBlob
		if o.kpNotAfter.Before(s.minNotAfter()) {
			// Пакет истекает: берём у устройства свежий, старый считается израсходованным.
			var ref []byte
			err = tx.QueryRow(ctx, claimKeyPackage, o.device, s.minNotAfter()).Scan(&ref, &blob)
			if errors.Is(err, pgx.ErrNoRows) {
				s.Stats.inc("join.dropped_no_kp", 1)
				dropped = append(dropped, o.device)
				continue
			}
			if err != nil {
				return 0, err
			}
			if _, err = tx.Exec(ctx, `UPDATE key_packages SET consumed_at = now() WHERE ref = $1`, o.kpRef); err != nil {
				return 0, err
			}
			if _, err = tx.Exec(ctx, `UPDATE pending_ops SET kp_ref = $3 WHERE group_id = $1 AND device_id = $2`,
				g.id, o.device, ref); err != nil {
				return 0, err
			}
			s.Stats.inc("add.kp_replaced", 1)
		}
		items = append(items, hsItem{epoch: g.epoch, kind: KindProposal,
			blob: s.cfg.ExternalSender.ProposeAdd(g.id, g.epoch, blob, mlswire.ProposalAAD(o.device))})
		reissued++
	}
	if len(dropped) > 0 {
		// Опубликованный KeyPackage считается израсходованным: его видели участники.
		if _, err = tx.Exec(ctx, `WITH d AS (DELETE FROM pending_ops WHERE group_id = $1 AND device_id = ANY($2)
			RETURNING kp_ref) UPDATE key_packages SET consumed_at = now() WHERE ref IN (SELECT kp_ref FROM d)`,
			g.id, dropped); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `UPDATE group_counters SET done = done + $2 WHERE group_id = $1`,
			g.id, len(dropped)); err != nil {
			return 0, err
		}
	}
	if len(items) > 0 {
		if err = insertHandshakes(ctx, tx, g, items); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, `UPDATE pending_ops SET published_epoch = $2 WHERE group_id = $1 AND state = 1`,
			g.id, g.epoch); err != nil {
			return 0, err
		}
		s.Stats.inc("proposals.reissued", int64(reissued))
	}
	// Очередь, накопленная, пока шёл commit, публикуется сразу следующей пачкой: тик батчера
	// открывает пачку в группе без ожидающих Add, а под нагрузкой темп задают commit-ы. Иначе MaxBatch
	// при интервале ограничил бы вход MaxBatch устройствами за тик.
	if _, err = s.publishQueued(ctx, tx, g); err != nil {
		return 0, err
	}
	return seq, nil
}

// --- выдача -------------------------------------------------------------------

// Handshake — сообщение группы для клиента.
type Handshake struct {
	Seq                uint64 `json:"seq"`
	Epoch              uint64 `json:"epoch"`
	Kind               Kind   `json:"kind"`
	SenderDeviceID     string `json:"sender_device_id,omitempty"`
	FromExternalSender bool   `json:"from_external_sender"`
	Blob               []byte `json:"blob"`
}

// Handshakes возвращает сообщения группы после afterSeq; если их нет — ждёт до wait.
func (s *Service) Handshakes(ctx context.Context, groupID []byte, afterSeq uint64, limit int, wait time.Duration) ([]Handshake, error) {
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	deadline := time.Now().Add(wait)
	for {
		ch := s.notify.wait(groupKey(groupID))
		rows, err := s.pool.Query(ctx, `SELECT seq, epoch, kind, sender_device_id, blob FROM mls_handshakes
			WHERE group_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`, groupID, afterSeq, limit)
		if err != nil {
			return nil, err
		}
		out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Handshake, error) {
			var h Handshake
			var sender *string
			err := row.Scan(&h.Seq, &h.Epoch, &h.Kind, &sender, &h.Blob)
			if sender != nil {
				h.SenderDeviceID = *sender
			} else {
				h.FromExternalSender = true
			}
			return h, err
		})
		if err != nil || len(out) > 0 || !time.Now().Before(deadline) {
			return out, err
		}
		if !sleepOn(ctx, ch, time.Until(deadline)) {
			return nil, ctx.Err()
		}
	}
}

// Welcome — Welcome для устройства.
type Welcome struct {
	GroupID []byte `json:"group_id"`
	Epoch   uint64 `json:"epoch"`
	Blob    []byte `json:"blob"`
}

// Welcomes выдаёт недоставленные Welcome устройства и помечает их доставленными; если их нет —
// ждёт до wait. Блоб Welcome общий для всей пачки: он читается из базы один раз и держится в
// памяти, а каждому адресату отдаётся только его запись EncryptedGroupSecrets. В продукте
// подтверждение доставки — отдельным вызовом (REST.md DELETE).
func (s *Service) Welcomes(ctx context.Context, device string, wait time.Duration) ([]Welcome, error) {
	deadline := time.Now().Add(wait)
	for {
		ch := s.notify.wait(deviceKey(device))
		// Отметка доставки — один атомарный UPDATE … RETURNING: второй одновременный запрос
		// того же устройства его строк уже не получит (ревью N8). Транзакция вокруг сборки
		// ответа не держится: тысяча новичков иначе держала бы соединения пула открытыми и
		// удваивала число обращений к базе. Если ответ не собрался, отметка снимается — устройство
		// не запирается. В продукте — подтверждение клиентом (REST.md DELETE).
		// Отметка и сборка ответа не прерываются обрывом запроса: иначе отметка могла бы
		// зафиксироваться, а ответ — не собраться, и устройство осталось бы без Welcome (ревью,
		// раунд 3, Н3). Обрыв уже после сборки (ответ не дошёл) спайк не закрывает — это закрывает
		// подтверждение клиентом в продукте (ADR-0018 п. 8).
		bctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		out, err := s.deliverWelcomes(bctx, device)
		cancel()
		if err != nil {
			return nil, err
		}
		if len(out) > 0 || !time.Now().Before(deadline) {
			return out, nil
		}
		if !sleepOn(ctx, ch, time.Until(deadline)) {
			return nil, ctx.Err()
		}
	}
}

// deliverWelcomes помечает недоставленные Welcome устройства и собирает ответ; если ответ не
// собрался, снимает отметку.
func (s *Service) deliverWelcomes(ctx context.Context, device string) ([]Welcome, error) {
	rows, err := s.pool.Query(ctx, `UPDATE welcome_deliveries SET delivered_at = now()
		WHERE device_id = $1 AND delivered_at IS NULL RETURNING welcome_id, kp_ref`, device)
	if err != nil {
		return nil, err
	}
	type pending struct {
		ID  int64
		Ref []byte
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByPos[pending])
	if err != nil {
		return nil, err
	}
	slices.SortFunc(list, func(a, b pending) int { return int(a.ID - b.ID) })
	out := make([]Welcome, 0, len(list))
	for _, p := range list {
		w, err := s.welcome(ctx, s.pool, p.ID)
		if err == nil {
			w.Blob, err = mlswire.SplitWelcome(w.Blob, p.Ref)
		}
		if err != nil {
			ids := make([]int64, 0, len(list))
			for _, q := range list {
				ids = append(ids, q.ID)
			}
			if _, uerr := s.pool.Exec(ctx, `UPDATE welcome_deliveries SET delivered_at = NULL
				WHERE device_id = $1 AND welcome_id = ANY($2)`, device, ids); uerr != nil {
				s.Stats.inc("welcome.unmark_failed", 1)
				return nil, errors.Join(err, uerr)
			}
			return nil, err
		}
		out = append(out, w)
	}
	return out, nil
}

// welcome — Welcome по id из кэша процесса (в продукте — Valkey или кэш gateway). Вызывать
// не под открытой транзакцией: соединение, которое ждёт чтения блоба другим запросом, при
// тысяче одновременных запросов исчерпало бы пул. Ошибка (в том числе обрыв запроса, который
// читал) не кэшируется — следующий запрос прочитает сам.
func (s *Service) welcome(ctx context.Context, q rowQuerier, id int64) (Welcome, error) {
	s.wmu.Lock()
	e, ok := s.wcache[id]
	if !ok {
		if len(s.wcache) > 64 {
			s.wcache = map[int64]*welcomeEntry{}
		}
		e = &welcomeEntry{}
		s.wcache[id] = e
	}
	s.wmu.Unlock()
	e.once.Do(func() {
		// Обрыв запроса, который читает, не должен ронять одновременные запросы того же Welcome.
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		e.err = q.QueryRow(rctx, `SELECT group_id, epoch, blob FROM welcomes WHERE id = $1`, id).
			Scan(&e.w.GroupID, &e.w.Epoch, &e.w.Blob)
		s.Stats.inc("welcome.db_reads", 1)
	})
	if e.err != nil {
		s.wmu.Lock()
		if s.wcache[id] == e {
			delete(s.wcache, id)
		}
		s.wmu.Unlock()
	}
	return e.w, e.err
}

type welcomeEntry struct {
	once sync.Once
	w    Welcome
	err  error
}

func sleepOn(ctx context.Context, ch <-chan struct{}, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ch:
	case <-t.C:
	case <-ctx.Done():
		return false
	}
	return true
}
