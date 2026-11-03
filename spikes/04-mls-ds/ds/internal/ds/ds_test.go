// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package ds

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpg "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/mlswire"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	dsn := os.Getenv("S4_TEST_DSN")
	if dsn == "" {
		ctr, err := tcpg.Run(ctx, "postgres:16-alpine",
			tcpg.WithDatabase("s4"), tcpg.WithUsername("s4"), tcpg.WithPassword("s4"),
			testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(2*time.Minute)))
		if err != nil {
			fmt.Fprintln(os.Stderr, "postgres:", err)
			return 1
		}
		defer func() { _ = testcontainers.TerminateContainer(ctr) }()
		if dsn, err = ctr.ConnectionString(ctx, "sslmode=disable"); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	cfg.MaxConns = 40
	if testPool, err = pgxpool.NewWithConfig(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer testPool.Close()
	if err = Migrate(ctx, testPool); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return m.Run()
}

// env — DS на чистой базе и эмулятор устройств.
type env struct {
	t    *testing.T
	ctx  context.Context
	svc  *Service
	gid  []byte
	kps  map[string][][]byte // KeyPackage по устройствам
	keys map[string]ed25519.PrivateKey
	seq  atomic.Int64 // нумерует синтетические commit-ы, чтобы их blob-ы различались
}

func newEnv(t *testing.T, cfg Config) *env {
	t.Helper()
	ctx := context.Background()
	if err := Reset(ctx, testPool); err != nil {
		t.Fatal(err)
	}
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	cfg.ExternalSender = mlswire.ExternalSender{Key: key, Identity: []byte("ds-test")}
	e := &env{t: t, ctx: ctx, svc: New(testPool, cfg), gid: []byte("group-" + t.Name()),
		kps: map[string][][]byte{}, keys: map[string]ed25519.PrivateKey{}}
	if err := e.svc.CreateGroup(ctx, e.gid, "creator", 0); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e *env) device(id string, n int) {
	e.t.Helper()
	priv, ok := e.keys[id]
	if !ok {
		_, priv, _ = ed25519.GenerateKey(rand.Reader)
		e.keys[id] = priv
	}
	fresh := make([][]byte, 0, n)
	for range n {
		fresh = append(fresh, newKeyPackage(priv, id))
	}
	e.kps[id] = append(e.kps[id], fresh...)
	if err := e.svc.UploadKeyPackages(e.ctx, id, fresh); err != nil {
		e.t.Fatal(err)
	}
}

func newKeyPackage(priv ed25519.PrivateKey, id string) []byte {
	init, enc := make([]byte, 32), make([]byte, 32)
	_, _ = rand.Read(init)
	_, _ = rand.Read(enc)
	return mlswire.BuildKeyPackage(mlswire.KeyPackageParams{
		Signer: priv, Identity: []byte(id), InitKey: init, EncryptionKey: enc,
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(7 * 24 * time.Hour),
	})
}

func (e *env) epoch() uint64 {
	st, err := e.svc.Group(e.ctx, e.gid)
	if err != nil {
		e.t.Fatal(err)
	}
	return st.Epoch
}

// commit — синтетический commit участника с дельтой состава; Welcome адресуется по
// KeyPackageRef тех пакетов, которые DS зарезервировал под Add.
func (e *env) commit(sender string, epoch uint64, d mlswire.RosterDelta) (Accepted, error) {
	var welcome []byte
	if len(d.Added) > 0 {
		var refs [][]byte
		for _, a := range d.Added {
			refs = append(refs, e.claimedRef(string(a.DeviceID)))
		}
		welcome = mlswire.BuildWelcome(refs, []byte("egi"))
	}
	blob := mlswire.BuildPrivateMessage(e.gid, epoch, mlswire.ContentCommit, d.Encode(), fmt.Appendf(nil, "ct-%d", e.seq.Add(1)))
	return e.svc.SubmitHandshake(e.ctx, e.gid, sender, KindCommit, blob, welcome)
}

func (e *env) claimedRef(dev string) []byte {
	var ref []byte
	_ = testPool.QueryRow(e.ctx, `SELECT kp_ref FROM pending_ops WHERE group_id = $1 AND device_id = $2`,
		e.gid, dev).Scan(&ref)
	if ref == nil {
		return []byte("no-ref-" + dev)
	}
	return ref
}

func (e *env) handshakes(after uint64) []Handshake {
	hs, err := e.svc.Handshakes(e.ctx, e.gid, after, 0, 0)
	if err != nil {
		e.t.Fatal(err)
	}
	return hs
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	if ErrorCode(err) != code {
		t.Fatalf("ожидался %s, получено %v", code, err)
	}
}

func add(leaf uint32, dev string) mlswire.AddedLeaf {
	return mlswire.AddedLeaf{Leaf: leaf, DeviceID: []byte(dev)}
}

// join доводит устройство до группы: заявка, Add от сервера, commit создателя.
func (e *env) join(dev string, leaf uint32) {
	e.t.Helper()
	e.device(dev, 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, dev); err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.commit("creator", e.epoch(), mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(leaf, dev)}}); err != nil {
		e.t.Fatal(err)
	}
}

func TestCommitOnlyForCurrentEpoch(t *testing.T) {
	e := newEnv(t, Config{})
	acc, err := e.commit("creator", 0, mlswire.RosterDelta{})
	if err != nil || acc.Epoch != 1 || acc.Seq != 1 {
		t.Fatalf("%+v %v", acc, err)
	}
	_, err = e.commit("creator", 0, mlswire.RosterDelta{})
	wantCode(t, err, CodeEpochMismatch)
	var de *Error
	if !errors.As(err, &de) || de.CurrentEpoch != 1 {
		t.Fatal(err)
	}
	_, err = e.commit("creator", 5, mlswire.RosterDelta{})
	wantCode(t, err, CodeEpochMismatch)
	_, err = e.commit("stranger", 1, mlswire.RosterDelta{})
	wantCode(t, err, CodeNotGroupMember)
}

func TestConcurrentCommitsOneWinner(t *testing.T) {
	for _, mode := range []LockMode{LockAdvisory, LockRow} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			e := newEnv(t, Config{Lock: mode})
			const n = 100
			var wg sync.WaitGroup
			var mu sync.Mutex
			codes := map[string]int{}
			start := make(chan struct{})
			for range n {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					_, err := e.commit("creator", 0, mlswire.RosterDelta{})
					mu.Lock()
					codes[ErrorCode(err)]++
					mu.Unlock()
					if err != nil && ErrorCode(err) == "" {
						t.Error(err)
					}
				}()
			}
			close(start)
			wg.Wait()
			if codes[""] != 1 || codes[CodeEpochMismatch] != n-1 {
				t.Fatalf("исходы: %v", codes)
			}
			if e.epoch() != 1 || len(e.handshakes(0)) != 1 {
				t.Fatal("состояние группы")
			}
		})
	}
}

func TestJoinViaExternalAdd(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 2)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	hs := e.handshakes(0)
	if len(hs) != 1 || !hs[0].FromExternalSender || hs[0].Kind != KindProposal {
		t.Fatalf("%+v", hs)
	}
	h, err := mlswire.ParseHeader(hs[0].Blob)
	if err != nil || h.SenderType != mlswire.SenderExternal || h.Epoch != 0 {
		t.Fatalf("%+v %v", h, err)
	}
	// Неверный лист, лишнее устройство и чужой Welcome отвергаются.
	_, err = e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(2, "bob")}})
	wantCode(t, err, CodeBadDelta)
	_, err = e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "mallory")}})
	wantCode(t, err, CodeUnauthorizedChange)
	blob := mlswire.BuildPrivateMessage(e.gid, 0, mlswire.ContentCommit,
		mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}.Encode(), nil)
	_, err = e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindCommit, blob,
		mlswire.BuildWelcome([][]byte{[]byte("other-ref")}, nil))
	wantCode(t, err, CodeBadWelcome)

	if _, err = e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}); err != nil {
		t.Fatal(err)
	}
	st, _ := e.svc.Group(e.ctx, e.gid)
	if st.Leaves[1] != "bob" || st.Epoch != 1 {
		t.Fatalf("%+v", st)
	}
	ws, err := e.svc.Welcomes(e.ctx, "bob", 0)
	if err != nil || len(ws) != 1 || ws[0].Epoch != 1 {
		t.Fatalf("%+v %v", ws, err)
	}
	if ws, _ = e.svc.Welcomes(e.ctx, "bob", 0); len(ws) != 0 {
		t.Fatal("Welcome доставлен дважды")
	}
	var consumed int
	_ = testPool.QueryRow(e.ctx, `SELECT count(*) FROM key_packages WHERE consumed_at IS NOT NULL`).Scan(&consumed)
	if consumed != 1 {
		t.Fatalf("израсходовано %d KeyPackage", consumed)
	}
	wantCode(t, e.svc.RequestJoin(e.ctx, e.gid, "bob"), CodeAlreadyMember)
}

func TestRemoveEnforcedAndRepeated(t *testing.T) {
	e := newEnv(t, Config{})
	e.join("bob", 1)
	e.join("carol", 2)
	if err := e.svc.RequestRemove(e.ctx, e.gid, "carol"); err != nil {
		t.Fatal(err)
	}
	ep := e.epoch()
	// Commit без объявленного Remove и commit самого удаляемого устройства не принимаются.
	_, err := e.commit("bob", ep, mlswire.RosterDelta{})
	wantCode(t, err, CodeProposalsMissing)
	_, err = e.commit("carol", ep, mlswire.RosterDelta{Removed: []uint32{2}})
	wantCode(t, err, CodeRemovalPending)
	// Удалить кого-то без предложения сервера нельзя.
	_, err = e.commit("bob", ep, mlswire.RosterDelta{Removed: []uint32{0, 2}})
	wantCode(t, err, CodeUnauthorizedChange)
	if _, err = e.commit("bob", ep, mlswire.RosterDelta{Removed: []uint32{2}}); err != nil {
		t.Fatal(err)
	}
	st, _ := e.svc.Group(e.ctx, e.gid)
	if _, ok := st.Leaves[2]; ok || len(st.Leaves) != 2 {
		t.Fatalf("%+v", st)
	}
	// Remove закоммичен со слов B: до commit-а другого устройства он ждёт подтверждения.
	if st := opState(e, "carol"); st != stateAwaitingConfirm {
		t.Fatalf("состояние Remove после commit-а: %d", st)
	}
	// Освободившийся лист 2 занимает следующий вошедший; commit создателя подтверждает Remove.
	e.join("dan", 2)
	if st := opState(e, "carol"); st != -1 {
		t.Fatalf("Remove не подтверждён commit-ом другого устройства: %d", st)
	}
}

// opState — состояние операции устройства в группе или -1, если её нет.
func opState(e *env, dev string) int16 {
	var st int16
	err := testPool.QueryRow(e.ctx, `SELECT state FROM pending_ops WHERE group_id = $1 AND device_id = $2`,
		e.gid, dev).Scan(&st)
	if err != nil {
		return -1
	}
	return st
}

func TestRemoveConfirmationNeedsAnotherDevice(t *testing.T) {
	e := newEnv(t, Config{})
	e.join("bob", 1)
	e.join("carol", 2)
	if err := e.svc.RequestRemove(e.ctx, e.gid, "carol"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.commit("bob", e.epoch(), mlswire.RosterDelta{Removed: []uint32{2}}); err != nil {
		t.Fatal(err)
	}
	// Второй commit того же устройства ничего не подтверждает: сообщник удаляемого мог бы
	// «закоммитить» Remove в одиночку.
	if _, err := e.commit("bob", e.epoch(), mlswire.RosterDelta{}); err != nil {
		t.Fatal(err)
	}
	if st := opState(e, "carol"); st != stateAwaitingConfirm {
		t.Fatalf("Remove подтверждён собственным commit-ом автора: %d", st)
	}
	// Пока удаление не подтверждено, carol не может заново встать в очередь.
	e.device("carol", 1)
	wantCode(t, e.svc.RequestJoin(e.ctx, e.gid, "carol"), CodeConflict)
	if _, err := e.commit("creator", e.epoch(), mlswire.RosterDelta{}); err != nil {
		t.Fatal(err)
	}
	if st := opState(e, "carol"); st != -1 {
		t.Fatalf("Remove не подтверждён: %d", st)
	}
}

func TestRevokedAddTurnsIntoRemove(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 1)
	e.device("eve", 1)
	for _, d := range []string{"bob", "eve"} {
		if err := e.svc.RequestJoin(e.ctx, e.gid, d); err != nil {
			t.Fatal(err)
		}
	}
	// Add обоих уже опубликованы и лежат в очередях участников: отмена входа eve не удаляет
	// заявку, иначе commit с этим Add был бы отвергнут и группа встала бы.
	if err := e.svc.RequestRemove(e.ctx, e.gid, "eve"); err != nil {
		t.Fatal(err)
	}
	if st := opState(e, "eve"); st != statePublished {
		t.Fatalf("отменённый опубликованный Add: состояние %d", st)
	}
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob"), add(2, "eve")}}); err != nil {
		t.Fatal(err)
	}
	if ws, _ := e.svc.Welcomes(e.ctx, "eve", 0); len(ws) != 0 {
		t.Fatal("отменённому устройству выдан Welcome")
	}
	if ws, _ := e.svc.Welcomes(e.ctx, "bob", 0); len(ws) != 1 {
		t.Fatal("bob без Welcome")
	}
	// Сразу за commit-ом — Remove листа eve в новой эпохе.
	hs := e.handshakes(3)
	if len(hs) != 1 || !hs[0].FromExternalSender || hs[0].Epoch != 1 {
		t.Fatalf("после commit-а: %+v", hs)
	}
	if st := opState(e, "eve"); st != statePublished {
		t.Fatalf("Remove для eve не опубликован: %d", st)
	}
	_, err := e.commit("creator", 1, mlswire.RosterDelta{})
	wantCode(t, err, CodeProposalsMissing)
	if _, err = e.commit("bob", 1, mlswire.RosterDelta{Removed: []uint32{2}}); err != nil {
		t.Fatal(err)
	}
	// Вариант 2: отменённый Add не вошёл в commit — DS его снимает, место в лимите возвращает.
	e.device("mallory", 1)
	if err = e.svc.RequestJoin(e.ctx, e.gid, "mallory"); err != nil {
		t.Fatal(err)
	}
	if err = e.svc.RequestRemove(e.ctx, e.gid, "mallory"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.commit("creator", e.epoch(), mlswire.RosterDelta{}); err != nil {
		t.Fatal(err)
	}
	if st := opState(e, "mallory"); st != -1 {
		t.Fatalf("снятый Add остался: %d", st)
	}
	var pendingAdds int
	_ = testPool.QueryRow(e.ctx, `SELECT r.requested - c.done FROM group_requests r JOIN group_counters c USING (group_id) WHERE group_id = $1`, e.gid).Scan(&pendingAdds)
	if pendingAdds != 0 {
		t.Fatalf("pending_adds = %d", pendingAdds)
	}
}

func TestDuplicateCommitIsIdempotent(t *testing.T) {
	e := newEnv(t, Config{})
	blob := mlswire.BuildPrivateMessage(e.gid, 0, mlswire.ContentCommit, mlswire.RosterDelta{}.Encode(), []byte("ct"))
	first, err := e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindCommit, blob, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Ответ потерялся, автор шлёт тот же commit снова: тот же результат, не EPOCH_MISMATCH.
	again, err := e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindCommit, blob, nil)
	if err != nil || again != first {
		t.Fatalf("повтор: %+v %v (первый %+v)", again, err, first)
	}
	// Другой commit той же устаревшей эпохи — отказ.
	other := mlswire.BuildPrivateMessage(e.gid, 0, mlswire.ContentCommit, mlswire.RosterDelta{}.Encode(), []byte("ct2"))
	_, err = e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindCommit, other, nil)
	wantCode(t, err, CodeEpochMismatch)
	if e.epoch() != 1 {
		t.Fatal("эпоха сдвинулась от повтора")
	}
}

func TestKeyPackageKeysUniqueAndLifetime(t *testing.T) {
	e := newEnv(t, Config{})
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	init, enc := make([]byte, 32), make([]byte, 32)
	_, _ = rand.Read(init)
	_, _ = rand.Read(enc)
	mk := func(id string, initKey, encKey []byte, ttl time.Duration) []byte {
		return mlswire.BuildKeyPackage(mlswire.KeyPackageParams{
			Signer: priv, Identity: []byte(id), InitKey: initKey, EncryptionKey: encKey,
			NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(ttl),
		})
	}
	if err := e.svc.UploadKeyPackages(e.ctx, "a", [][]byte{mk("a", init, enc, 24*time.Hour)}); err != nil {
		t.Fatal(err)
	}
	// Повтор init_key или encryption_key в другом пакете (даже другого устройства) — отказ:
	// такой Add ломает commit у участников.
	enc2 := make([]byte, 32)
	_, _ = rand.Read(enc2)
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "a", [][]byte{mk("a", init, enc2, 24*time.Hour)}), CodeInvalidKeyPackage)
	// Перекрёстно: init_key нового пакета равен encryption_key прежнего и наоборот (ревью,
	// раунд 3, Н1) — тоже отказ, в том числе у другого устройства.
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	fresh := func() []byte { b := make([]byte, 32); _, _ = rand.Read(b); return b }
	cross := func(id string, initKey, encKey []byte) []byte {
		return mlswire.BuildKeyPackage(mlswire.KeyPackageParams{
			Signer: other, Identity: []byte(id), InitKey: initKey, EncryptionKey: encKey,
			NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(24 * time.Hour),
		})
	}
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "b", [][]byte{cross("b", enc, fresh())}), CodeInvalidKeyPackage)
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "b", [][]byte{cross("b", fresh(), init)}), CodeInvalidKeyPackage)
	// Дубль только encryption-ключа у другого устройства и коллизия внутри одной пачки (П2).
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "b", [][]byte{cross("b", fresh(), enc)}), CodeInvalidKeyPackage)
	x := fresh()
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "b", [][]byte{cross("b", x, fresh()), cross("b", fresh(), x)}), CodeInvalidKeyPackage)
	// Расширение листа, не указанное в capabilities (П1): openmls отверг бы commit со всей пачкой.
	bad := mlswire.BuildKeyPackage(mlswire.KeyPackageParams{
		Signer: other, Identity: []byte("b"), InitKey: fresh(), EncryptionKey: fresh(),
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(24 * time.Hour),
		LeafExtensions: []byte{0xff, 0x00, 0x00},
	})
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "b", [][]byte{bad}), CodeInvalidKeyPackage)
	if err := e.svc.UploadKeyPackages(e.ctx, "b", [][]byte{cross("b", fresh(), fresh())}); err != nil {
		t.Fatalf("честный пакет второго устройства: %v", err)
	}
	// Пакет, истекающий раньше MinKeyPackageLifetime, не принимается.
	init3, enc3 := make([]byte, 32), make([]byte, 32)
	_, _ = rand.Read(init3)
	_, _ = rand.Read(enc3)
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "a", [][]byte{mk("a", init3, enc3, 10*time.Minute)}), CodeInvalidKeyPackage)
}

func TestExpiringKeyPackageReplacedOnReissue(t *testing.T) {
	now := time.Now()
	clock := &now
	e := newEnv(t, Config{Now: func() time.Time { return *clock }})
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	mk := func(ttl time.Duration) []byte {
		init, enc := make([]byte, 32), make([]byte, 32)
		_, _ = rand.Read(init)
		_, _ = rand.Read(enc)
		return mlswire.BuildKeyPackage(mlswire.KeyPackageParams{
			Signer: priv, Identity: []byte("bob"), InitKey: init, EncryptionKey: enc,
			NotBefore: now.Add(-time.Minute), NotAfter: now.Add(ttl),
		})
	}
	short, long, middle := mk(2*time.Hour), mk(48*time.Hour), mk(3*time.Hour)
	// Из двух пакетов резервируется пакет с самым поздним сроком.
	if err := e.svc.UploadKeyPackages(e.ctx, "bob", [][]byte{middle, short}); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if first, err := mlswire.KeyPackageFromExternalAdd(e.handshakes(0)[0].Blob); err != nil ||
		!bytes.Equal(first.Ref, mlswire.KeyPackageRef(middle)) {
		t.Fatalf("зарезервирован не самый поздний пакет: %v", err)
	}
	if err := e.svc.UploadKeyPackages(e.ctx, "bob", [][]byte{long}); err != nil {
		t.Fatal(err)
	}
	// Проходит 2,5 ч — у опубликованного пакета остаток меньше часа.
	*clock = now.Add(150 * time.Minute)
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{}); err != nil {
		t.Fatal(err)
	}
	hs := e.handshakes(2)
	if len(hs) != 1 {
		t.Fatalf("повтор Add: %+v", hs)
	}
	kp, err := mlswire.KeyPackageFromExternalAdd(hs[0].Blob)
	if err != nil || !bytes.Equal(kp.Ref, mlswire.KeyPackageRef(long)) {
		t.Fatalf("повторный Add несёт не свежий пакет: %v", err)
	}
	// Без свежих пакетов Add снимается, а не повторяется с истекающим.
	*clock = now.Add(47*time.Hour + 30*time.Minute)
	if _, err = e.commit("creator", 1, mlswire.RosterDelta{}); err != nil {
		t.Fatal(err)
	}
	for _, h := range e.handshakes(3) {
		if h.FromExternalSender {
			t.Fatal("Add повторён с истекающим пакетом")
		}
	}
	if st := opState(e, "bob"); st != -1 {
		t.Fatalf("заявка без KeyPackage осталась: %d", st)
	}
}

func TestAddExpiresAfterEpochs(t *testing.T) {
	e := newEnv(t, Config{MaxAddEpochs: 2})
	e.device("bob", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		if _, err := e.commit("creator", uint64(i), mlswire.RosterDelta{}); err != nil { //nolint:gosec
			t.Fatal(err)
		}
	}
	// Опубликован в эпохе 0, повторён в 1 и 2, в эпохе 3 снят.
	if st := opState(e, "bob"); st != -1 {
		t.Fatalf("Add живёт дольше MaxAddEpochs: %d", st)
	}
	hs := e.handshakes(0)
	var adds int
	for _, h := range hs {
		if h.FromExternalSender {
			adds++
		}
	}
	if adds != 3 {
		t.Fatalf("Add опубликован %d раз", adds)
	}
}

func TestMemberProposalsRejectedAndDeltaLimited(t *testing.T) {
	e := newEnv(t, Config{})
	prop := mlswire.BuildPrivateMessage(e.gid, 0, mlswire.ContentProposal, nil, []byte("p"))
	_, err := e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindProposal, prop, nil)
	wantCode(t, err, CodeUnauthorizedChange)
	huge := mlswire.RosterDelta{}
	for i := range maxDeltaEntries + 1 {
		huge.Added = append(huge.Added, add(uint32(i+1), fmt.Sprintf("d%d", i))) //nolint:gosec
	}
	blob := mlswire.BuildPrivateMessage(e.gid, 0, mlswire.ContentCommit, huge.Encode(), []byte("c"))
	_, err = e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindCommit, blob, nil)
	wantCode(t, err, CodeBadDelta)
}

func TestUncommittedProposalsReissued(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	// Commit, который не знал о предложении (например, плановая ротация), принимается;
	// Add повторяется в новой эпохе с тем же KeyPackage.
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{}); err != nil {
		t.Fatal(err)
	}
	hs := e.handshakes(2)
	if len(hs) != 1 || !hs[0].FromExternalSender || hs[0].Epoch != 1 {
		t.Fatalf("%+v", hs)
	}
	if _, err := e.commit("creator", 1, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}); err != nil {
		t.Fatal(err)
	}
}

func TestMemberLimit(t *testing.T) {
	e := newEnv(t, Config{LeafLimit: 3})
	e.device("a", 1)
	e.device("b", 1)
	e.device("c", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "a"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RequestJoin(e.ctx, e.gid, "b"); err != nil {
		t.Fatal(err)
	}
	// Лимит считает и вошедших, и стоящих в очереди.
	wantCode(t, e.svc.RequestJoin(e.ctx, e.gid, "c"), CodeMemberLimit)
}

func TestBatching(t *testing.T) {
	e := newEnv(t, Config{BatchInterval: time.Hour, MaxBatch: 2})
	for i := range 5 {
		dev := fmt.Sprintf("d%d", i)
		e.device(dev, 1)
		if err := e.svc.RequestJoin(e.ctx, e.gid, dev); err != nil {
			t.Fatal(err)
		}
	}
	if len(e.handshakes(0)) != 0 {
		t.Fatal("до тика батчера предложений быть не должно")
	}
	if err := e.svc.PublishTick(e.ctx); err != nil {
		t.Fatal(err)
	}
	if n := len(e.handshakes(0)); n != 2 {
		t.Fatalf("пачка %d", n)
	}
	// Пока пачка не закоммичена, новая не публикуется.
	_ = e.svc.PublishTick(e.ctx)
	if n := len(e.handshakes(0)); n != 2 {
		t.Fatalf("вторая пачка до commit: %d", n)
	}
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "d0"), add(2, "d1")}}); err != nil {
		t.Fatal(err)
	}
	_ = e.svc.PublishTick(e.ctx)
	hs := e.handshakes(3)
	if len(hs) != 2 || hs[0].Epoch != 1 {
		t.Fatalf("%+v", hs)
	}
}

func TestExternalCommit(t *testing.T) {
	e := newEnv(t, Config{BatchInterval: time.Hour, AllowExternalCommit: true})
	e.device("eve", 1)
	ext := func(epoch uint64, d mlswire.RosterDelta) error {
		blob := mlswire.BuildPublicCommit(e.gid, epoch, d.Encode(), []byte("commit"))
		_, err := e.svc.SubmitHandshake(e.ctx, e.gid, "eve", KindExternalCommit, blob, nil)
		return err
	}
	self := mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "eve")}}
	// Без права на вход (заявки нет) — отказ.
	wantCode(t, ext(0, self), CodeUnauthorizedChange)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "eve"); err != nil {
		t.Fatal(err)
	}
	wantCode(t, ext(3, self), CodeEpochMismatch)
	// PrivateMessage под видом external commit отвергается по заголовку.
	priv := mlswire.BuildPrivateMessage(e.gid, 0, mlswire.ContentCommit, self.Encode(), nil)
	_, err := e.svc.SubmitHandshake(e.ctx, e.gid, "eve", KindExternalCommit, priv, nil)
	wantCode(t, err, CodeBadMessage)
	if err = ext(0, self); err != nil {
		t.Fatal(err)
	}
	if st, _ := e.svc.Group(e.ctx, e.gid); st.Leaves[1] != "eve" || st.Epoch != 1 {
		t.Fatalf("%+v", st)
	}
}

func TestKeyPackageBinding(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 1)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "bob", [][]byte{newKeyPackage(other, "bob")}), CodeInvalidKeyPackage)
	wantCode(t, e.svc.UploadKeyPackages(e.ctx, "alice", [][]byte{newKeyPackage(other, "bob")}), CodeInvalidKeyPackage)
	wantCode(t, e.svc.RequestJoin(e.ctx, e.gid, "nobody"), CodeNoKeyPackages)
}

func TestLongPoll(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 1)
	got := make(chan []Handshake, 1)
	go func() {
		hs, _ := e.svc.Handshakes(e.ctx, e.gid, 0, 0, 5*time.Second)
		got <- hs
	}()
	time.Sleep(100 * time.Millisecond)
	start := time.Now()
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	select {
	case hs := <-got:
		if len(hs) != 1 || time.Since(start) > time.Second {
			t.Fatalf("%d за %s", len(hs), time.Since(start))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("long-poll не проснулся")
	}
}

// Заявки на вход параллельно с commit-ами не дают внутренних ошибок (взаимоблокировок на
// строке группы) ни при одном режиме блокировки, и лимит листьев не превышается.
func TestConcurrentJoinsAndCommits(t *testing.T) {
	const limit = 500
	for _, mode := range []LockMode{LockAdvisory, LockRow} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			e := newEnv(t, Config{Lock: mode, LeafLimit: limit})
			const n = 600
			for i := range n {
				e.device(fmt.Sprintf("j%d", i), 1)
			}
			var committed atomic.Int64
			var cwg sync.WaitGroup
			for range 3 {
				cwg.Add(1)
				go func() { // коммитеры: всё опубликованное — одним commit-ом, наперегонки
					defer cwg.Done()
					for committed.Load() < limit-1 {
						var d mlswire.RosterDelta
						st, err := e.svc.Group(e.ctx, e.gid)
						if err != nil {
							t.Error(err)
							return
						}
						occ := map[uint32]struct{}{}
						for l := range st.Leaves {
							occ[l] = struct{}{}
						}
						rows, _ := testPool.Query(e.ctx, `SELECT device_id FROM pending_ops
						WHERE group_id = $1 AND state = 1 AND op = 1 ORDER BY device_id`, e.gid)
						var devs []string
						for rows.Next() {
							var s string
							_ = rows.Scan(&s)
							devs = append(devs, s)
						}
						rows.Close()
						leaves := mlswire.AssignLeaves(occ, nil, len(devs))
						for i, dv := range devs {
							d.Added = append(d.Added, add(leaves[i], dv))
						}
						if len(d.Added) == 0 {
							time.Sleep(time.Millisecond)
							continue
						}
						_, err = e.commit("creator", st.Epoch, d)
						switch ErrorCode(err) {
						case "":
							committed.Add(int64(len(d.Added)))
						case CodeEpochMismatch, CodeUnauthorizedChange, CodeBadWelcome:
						default:
							t.Errorf("commit: %v", err)
							return
						}
					}
				}()
			}
			done := make(chan struct{})
			go func() { cwg.Wait(); close(done) }()
			var wg sync.WaitGroup
			var mu sync.Mutex
			codes := map[string]int{}
			for i := range n {
				wg.Add(1)
				go func() {
					defer wg.Done()
					err := e.svc.RequestJoin(e.ctx, e.gid, fmt.Sprintf("j%d", i))
					mu.Lock()
					codes[ErrorCode(err)]++
					mu.Unlock()
					if err != nil && ErrorCode(err) == "" {
						t.Errorf("внутренняя ошибка: %v", err)
					}
				}()
			}
			wg.Wait()
			select {
			case <-done:
			case <-time.After(30 * time.Second):
				t.Fatal("коммитер не довёл вход до конца")
			}
			if codes[""] != limit-1 || codes[CodeMemberLimit] != n-limit+1 {
				t.Fatalf("исходы заявок: %v", codes)
			}
			if st, _ := e.svc.Group(e.ctx, e.gid); len(st.Leaves) != limit {
				t.Fatalf("листьев %d", len(st.Leaves))
			}
		})
	}
}

func TestLeadingEdge(t *testing.T) {
	e := newEnv(t, Config{BatchInterval: time.Hour, MaxBatch: 10, LeadingEdge: true})
	e.device("a", 1)
	e.device("b", 1)
	// Тихая группа: первая заявка публикуется сразу, без тика.
	if err := e.svc.RequestJoin(e.ctx, e.gid, "a"); err != nil {
		t.Fatal(err)
	}
	if n := len(e.handshakes(0)); n != 1 {
		t.Fatalf("первая заявка: %d предложений", n)
	}
	// Пока Add ждёт commit-а, следующая заявка копится.
	if err := e.svc.RequestJoin(e.ctx, e.gid, "b"); err != nil {
		t.Fatal(err)
	}
	if n := len(e.handshakes(0)); n != 1 {
		t.Fatalf("вторая заявка до commit-а: %d предложений", n)
	}
	// Commit тянет за собой следующую пачку.
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "a")}}); err != nil {
		t.Fatal(err)
	}
	hs := e.handshakes(2)
	if len(hs) != 1 || hs[0].Epoch != 1 {
		t.Fatalf("после commit-а: %+v", hs)
	}
}

// Ревью N1 и N2: повторная заявка устройства, пока commit его добавляет. Не должно быть ни
// внутренних ошибок (взаимоблокировок), ни «висящего» Add у вошедшего устройства.
func TestJoinRaceWithCommit(t *testing.T) {
	for _, mode := range []LockMode{LockAdvisory, LockRow} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			e := newEnv(t, Config{Lock: mode})
			for i := range 40 {
				dev := fmt.Sprintf("y%d", i)
				e.device(dev, 2)
				if err := e.svc.RequestJoin(e.ctx, e.gid, dev); err != nil {
					t.Fatal(err)
				}
				st, _ := e.svc.Group(e.ctx, e.gid)
				occ := map[uint32]struct{}{}
				for l := range st.Leaves {
					occ[l] = struct{}{}
				}
				leaf := mlswire.AssignLeaves(occ, nil, 1)[0]
				var wg sync.WaitGroup
				var errs [2]error
				wg.Add(2)
				go func() {
					defer wg.Done()
					_, errs[0] = e.commit("creator", st.Epoch, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(leaf, dev)}})
				}()
				go func() {
					defer wg.Done()
					time.Sleep(time.Duration(i%5) * time.Millisecond)
					errs[1] = e.svc.RequestJoin(e.ctx, e.gid, dev)
				}()
				wg.Wait()
				if errs[0] != nil {
					t.Fatalf("раунд %d: commit: %v", i, errs[0])
				}
				if errs[1] != nil && ErrorCode(errs[1]) != CodeAlreadyMember {
					t.Fatalf("раунд %d: повторная заявка: %v", i, errs[1])
				}
				var dangling int
				if err := testPool.QueryRow(e.ctx, `SELECT count(*) FROM pending_ops o JOIN group_leaves l
					ON l.group_id = o.group_id AND l.device_id = o.device_id
					WHERE o.group_id = $1 AND o.op = 1`, e.gid).Scan(&dangling); err != nil {
					t.Fatal(err)
				}
				if dangling != 0 {
					t.Fatalf("раунд %d: у вошедшего устройства висит Add", i)
				}
			}
			var pendingAdds int
			_ = testPool.QueryRow(e.ctx, `SELECT r.requested - c.done FROM group_requests r JOIN group_counters c USING (group_id) WHERE group_id = $1`, e.gid).Scan(&pendingAdds)
			if pendingAdds != 0 {
				t.Fatalf("pending_adds = %d", pendingAdds)
			}
		})
	}
}

// Ревью N1: если висящий Add всё же оказался у участника, Remove его заменяет, commit с
// Remove принимается, а сам участник коммитить не может; публикация снимает такую заявку.
func TestRemoveReplacesDanglingAdd(t *testing.T) {
	e := newEnv(t, Config{BatchInterval: time.Hour})
	e.device("bob", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	_ = e.svc.PublishTick(e.ctx)
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}); err != nil {
		t.Fatal(err)
	}
	dangle := func(dev string) {
		if _, err := testPool.Exec(e.ctx, `INSERT INTO pending_ops (group_id, device_id, op, state) VALUES ($1, $2, 1, 0)`,
			e.gid, dev); err != nil {
			t.Fatal(err)
		}
		if _, err := testPool.Exec(e.ctx, `UPDATE group_requests SET requested = requested + 1 WHERE group_id = $1`, e.gid); err != nil {
			t.Fatal(err)
		}
	}
	pendingAdds := func() int {
		var n int
		_ = testPool.QueryRow(e.ctx, `SELECT r.requested - c.done FROM group_requests r JOIN group_counters c USING (group_id) WHERE group_id = $1`, e.gid).Scan(&n)
		return n
	}
	// Публикация снимает заявку участника, а не публикует Add.
	dangle("bob")
	before := len(e.handshakes(0))
	_ = e.svc.PublishTick(e.ctx)
	if len(e.handshakes(0)) != before || opState(e, "bob") != -1 || pendingAdds() != 0 {
		t.Fatal("заявка участника опубликована или не снята")
	}
	// Remove заменяет висящую заявку.
	dangle("bob")
	if err := e.svc.RequestRemove(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if st := opState(e, "bob"); st != statePublished || pendingAdds() != 0 {
		t.Fatalf("Remove не записан: состояние %d, pending_adds %d", st, pendingAdds())
	}
	// Повторный бан Remove не дублирует.
	before = len(e.handshakes(0))
	if err := e.svc.RequestRemove(e.ctx, e.gid, "bob"); err != nil || len(e.handshakes(0)) != before {
		t.Fatalf("повторный Remove: %v", err)
	}
	_, err := e.commit("bob", 1, mlswire.RosterDelta{})
	wantCode(t, err, CodeRemovalPending)
	if _, err = e.commit("creator", 1, mlswire.RosterDelta{Removed: []uint32{1}}); err != nil {
		t.Fatal(err)
	}
}

// Ревью N4: тот же commit дважды одновременно — оба получают один и тот же ответ.
func TestDuplicateCommitConcurrent(t *testing.T) {
	for _, mode := range []LockMode{LockAdvisory, LockRow} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			e := newEnv(t, Config{Lock: mode})
			for i := range 20 {
				ep := e.epoch()
				blob := mlswire.BuildPrivateMessage(e.gid, ep, mlswire.ContentCommit, mlswire.RosterDelta{}.Encode(),
					fmt.Appendf(nil, "dup-%d", i))
				submit := func(acc *Accepted, err *error, wg *sync.WaitGroup) {
					defer wg.Done()
					*acc, *err = e.svc.SubmitHandshake(e.ctx, e.gid, "creator", KindCommit, blob, nil)
				}
				var wg sync.WaitGroup
				var accA, accB Accepted
				var errA, errB error
				wg.Add(2)
				go submit(&accA, &errA, &wg)
				go submit(&accB, &errB, &wg)
				wg.Wait()
				if errA != nil || errB != nil || accA != accB || accA.Epoch != ep+1 {
					t.Fatalf("раунд %d: %+v %+v %v %v", i, accA, accB, errA, errB)
				}
			}
		})
	}
}

// Ревью N5: external commit отменённого устройства и external commit мимо опубликованного
// Remove не принимаются.
func TestExternalCommitRespectsRevokeAndRemove(t *testing.T) {
	e := newEnv(t, Config{BatchInterval: time.Hour, AllowExternalCommit: true})
	ext := func(dev string, leaf uint32) error {
		d := mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(leaf, dev)}}
		blob := mlswire.BuildPublicCommit(e.gid, e.epoch(), d.Encode(), []byte("commit-"+dev))
		_, err := e.svc.SubmitHandshake(e.ctx, e.gid, dev, KindExternalCommit, blob, nil)
		return err
	}
	e.device("eve", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "eve"); err != nil {
		t.Fatal(err)
	}
	_ = e.svc.PublishTick(e.ctx)
	if err := e.svc.RequestRemove(e.ctx, e.gid, "eve"); err != nil {
		t.Fatal(err)
	}
	wantCode(t, ext("eve", 1), CodeUnauthorizedChange)

	e.device("bob", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	_ = e.svc.PublishTick(e.ctx)
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}); err != nil {
		t.Fatal(err)
	}
	e.device("zed", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "zed"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RequestRemove(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	wantCode(t, ext("zed", 2), CodeProposalsMissing)
}

// Ревью N8: одновременные запросы Welcome одного устройства выдают его ровно один раз.
func TestWelcomesDeliveredOnce(t *testing.T) {
	e := newEnv(t, Config{})
	e.join("bob", 1)
	var wg sync.WaitGroup
	var mu sync.Mutex
	got := 0
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ws, err := e.svc.Welcomes(e.ctx, "bob", 0)
			if err != nil {
				t.Error(err)
			}
			mu.Lock()
			got += len(ws)
			mu.Unlock()
		}()
	}
	wg.Wait()
	if got != 1 {
		t.Fatalf("Welcome выдан %d раз", got)
	}
}

// Ревью N9: повторное приглашение после отмены опубликованного Add не теряется.
func TestReinviteAfterRevoke(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RequestRemove(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	var revoked bool
	_ = testPool.QueryRow(e.ctx, `SELECT revoked FROM pending_ops WHERE group_id = $1 AND device_id = 'bob'`, e.gid).Scan(&revoked)
	if revoked {
		t.Fatal("отметка отмены не снята")
	}
	var pendingAdds int
	_ = testPool.QueryRow(e.ctx, `SELECT r.requested - c.done FROM group_requests r JOIN group_counters c USING (group_id) WHERE group_id = $1`, e.gid).Scan(&pendingAdds)
	if pendingAdds != 1 {
		t.Fatalf("pending_adds = %d", pendingAdds)
	}
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}); err != nil {
		t.Fatal(err)
	}
	if ws, _ := e.svc.Welcomes(e.ctx, "bob", 0); len(ws) != 1 {
		t.Fatal("повторно приглашённому не выдан Welcome")
	}
	for _, h := range e.handshakes(2) {
		if h.FromExternalSender {
			t.Fatal("после commit-а опубликован Remove повторно приглашённого")
		}
	}
}

// Выдача Welcome не берёт второе соединение из пула под открытой транзакцией: иначе при
// одновременных запросах больше размера пула все соединения ждут друг друга (найдено
// нагрузкой после исправления N8).
func TestWelcomesDoNotExhaustPool(t *testing.T) {
	e := newEnv(t, Config{})
	const n = 20
	var d mlswire.RosterDelta
	for i := range n {
		dev := fmt.Sprintf("w%d", i)
		e.device(dev, 1)
		if err := e.svc.RequestJoin(e.ctx, e.gid, dev); err != nil {
			t.Fatal(err)
		}
		d.Added = append(d.Added, add(uint32(i+1), dev)) //nolint:gosec
	}
	if _, err := e.commit("creator", 0, d); err != nil {
		t.Fatal(err)
	}
	cfg := testPool.Config().Copy()
	cfg.MaxConns = 4
	small, err := pgxpool.NewWithConfig(e.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	svc := New(small, e.svc.Config()) // пустой кэш Welcome
	ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	var got atomic.Int64
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ws, err := svc.Welcomes(ctx, fmt.Sprintf("w%d", i), 0)
			if err != nil {
				t.Errorf("w%d: %v", i, err)
			}
			got.Add(int64(len(ws)))
		}()
	}
	wg.Wait()
	if got.Load() != n {
		t.Fatalf("выдано %d Welcome из %d", got.Load(), n)
	}
}

// Ревью, раунд 3, Н2: устройство, добавленное commit-ом, но не забравшее Welcome, после бана
// его не получает.
func TestBannedDeviceGetsNoWelcome(t *testing.T) {
	e := newEnv(t, Config{})
	e.join("bob", 1)
	if err := e.svc.RequestRemove(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if ws, err := e.svc.Welcomes(e.ctx, "bob", 0); err != nil || len(ws) != 0 {
		t.Fatalf("забаненному выдан Welcome: %d %v", len(ws), err)
	}
}

// Ревью, раунд 3, Н3: оборванный запрос не оставляет Welcome помеченным без выдачи.
func TestWelcomeSurvivesCancelledRequest(t *testing.T) {
	e := newEnv(t, Config{})
	e.join("bob", 1)
	ctx, cancel := context.WithCancel(e.ctx)
	cancel()
	ws, err := e.svc.Welcomes(ctx, "bob", 0)
	if err != nil || len(ws) != 1 {
		t.Fatalf("при оборванном запросе: %d %v", len(ws), err)
	}
	var pending int
	_ = testPool.QueryRow(e.ctx, `SELECT count(*) FROM welcome_deliveries WHERE device_id = 'bob' AND delivered_at IS NULL`).Scan(&pending)
	if pending != 0 {
		t.Fatalf("недоставленных осталось %d", pending)
	}
}

// Ревью, раунд 3, Н4: повторное приглашение устройства, чей отменённый Add уже закоммичен и
// Remove опубликован, получает CONFLICT (повторить после удаления), а не ALREADY_MEMBER.
func TestReinviteWhileRemovalPending(t *testing.T) {
	e := newEnv(t, Config{})
	e.device("bob", 2)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RequestRemove(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.commit("creator", 0, mlswire.RosterDelta{Added: []mlswire.AddedLeaf{add(1, "bob")}}); err != nil {
		t.Fatal(err)
	}
	wantCode(t, e.svc.RequestJoin(e.ctx, e.gid, "bob"), CodeConflict)
	if _, err := e.commit("creator", 1, mlswire.RosterDelta{Removed: []uint32{1}}); err != nil {
		t.Fatal(err)
	}
}

// Ревью, раунд 3, Н6: ошибка одной группы не останавливает тик для остальных.
func TestPublishTickContinuesAfterGroupError(t *testing.T) {
	e := newEnv(t, Config{BatchInterval: time.Hour})
	if _, err := testPool.Exec(e.ctx, `INSERT INTO pending_ops (group_id, device_id, op, state)
		VALUES ('ghost-group', 'ghost', 1, 0)`); err != nil {
		t.Fatal(err)
	}
	e.device("bob", 1)
	if err := e.svc.RequestJoin(e.ctx, e.gid, "bob"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.PublishTick(e.ctx); err == nil {
		t.Fatal("ошибка группы-призрака не возвращена")
	}
	if len(e.handshakes(0)) != 1 {
		t.Fatal("Add живой группы не опубликован")
	}
}
