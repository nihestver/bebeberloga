// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

// Команда emul — эмулятор клиентов для замера потолка DS без криптографии: сообщения с
// настоящими заголовками MLS и синтетическим «шифртекстом», вызовы сервиса в процессе (без
// HTTP). Печатает таблицу Markdown.
//
// Сценарии:
//   - join: N одновременных заявок на вход в одну группу — пропускная способность очереди;
//   - race: K участников без пауз коммитят в одну группу — commit-ов в секунду и доля отказов;
//   - cycle: N одновременных входов + мгновенный коммитер — время до последнего Welcome
//     (нижняя граница задержки входа, которую даёт сам DS).
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/ds"
	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/mlswire"
)

func main() {
	dsn := flag.String("db", "postgres://s4:s4@127.0.0.1:55432/s4?sslmode=disable", "Postgres")
	pool := flag.Int("pool", 32, "соединений с Postgres")
	joiners := flag.Int("joiners", 1000, "устройств на вход")
	racers := flag.Int("racers", 10, "участников в гонке commit-ов")
	raceFor := flag.Duration("race-for", 5*time.Second, "длительность гонки")
	flag.Parse()

	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(*dsn)
	if err != nil {
		log.Fatal(err)
	}
	cfg.MaxConns = int32(*pool) //nolint:gosec
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer p.Close()
	if err = ds.Migrate(ctx, p); err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Пул Postgres: %d соединений, устройств: %d, участников в гонке: %d\n\n", *pool, *joiners, *racers)
	fmt.Println("| Сценарий | Блокировка | Батчинг | Результат | Подробности |")
	fmt.Println("|---|---|---|---|---|")
	for _, lock := range []ds.LockMode{ds.LockAdvisory, ds.LockRow} {
		name := map[ds.LockMode]string{ds.LockAdvisory: "advisory", ds.LockRow: "row"}[lock]
		svc := newService(ctx, p, ds.Config{Lock: lock, BatchInterval: time.Hour})
		r := joinThroughput(ctx, svc, *joiners)
		fmt.Printf("| join: %d заявок | %s | очередь | %.0f заявок/с | p50 %.1f мс, p99 %.1f мс |\n", *joiners, name, r.rate, r.p50, r.p99)

		svc = newService(ctx, p, ds.Config{Lock: lock})
		rr := race(ctx, svc, p, *racers, *raceFor)
		fmt.Printf("| race: %d коммитеров | %s | — | %.0f commit/с | принято %d, отказов %d (%.0f%%), lock hold p50 %.2f мс |\n",
			*racers, name, rr.rate, rr.accepted, rr.rejected, 100*float64(rr.rejected)/float64(rr.accepted+rr.rejected), rr.hold)

		for _, b := range []struct {
			interval time.Duration
			max      int
		}{{0, 0}, {time.Second, 0}, {0, 100}, {time.Second, 100}} {
			svc = newService(ctx, p, ds.Config{Lock: lock, BatchInterval: b.interval, MaxBatch: b.max})
			c := cycle(ctx, svc, *joiners)
			fmt.Printf("| cycle: %d входов | %s | %s, max %d | %.2f с до последнего Welcome | commit-ов %d, повторов Add %d, p50 входа %.0f мс |\n",
				*joiners, name, b.interval, b.max, c.total.Seconds(), c.commits, c.reissued, c.p50)
		}
	}
}

func newService(ctx context.Context, p *pgxpool.Pool, cfg ds.Config) *ds.Service {
	if err := ds.Reset(ctx, p); err != nil {
		log.Fatal(err)
	}
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	cfg.ExternalSender = mlswire.ExternalSender{Key: key, Identity: []byte("emul")}
	return ds.New(p, cfg)
}

// prepare создаёт группу с участником "c0" и устройства с KeyPackage.
func prepare(ctx context.Context, svc *ds.Service, gid []byte, n int) []string {
	if err := svc.CreateGroup(ctx, gid, "c0", 0); err != nil {
		log.Fatal(err)
	}
	devs := make([]string, n)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 16)
	for i := range n {
		devs[i] = fmt.Sprintf("dev-%d", i)
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			_, priv, _ := ed25519.GenerateKey(rand.Reader)
			ik, ek := make([]byte, 32), make([]byte, 32)
			_, _ = rand.Read(ik)
			_, _ = rand.Read(ek)
			kp := mlswire.BuildKeyPackage(mlswire.KeyPackageParams{
				Signer: priv, Identity: []byte(devs[i]), InitKey: ik, EncryptionKey: ek,
				NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(24 * time.Hour),
			})
			if err := svc.UploadKeyPackages(ctx, devs[i], [][]byte{kp}); err != nil {
				log.Fatal(err)
			}
		}()
	}
	wg.Wait()
	return devs
}

type rate struct{ rate, p50, p99 float64 }

func joinThroughput(ctx context.Context, svc *ds.Service, n int) rate {
	gid := []byte("emul-join")
	devs := prepare(ctx, svc, gid, n)
	var wg sync.WaitGroup
	lat := make([]float64, n)
	start := time.Now()
	for i, d := range devs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			t := time.Now()
			if err := svc.RequestJoin(ctx, gid, d); err != nil {
				log.Fatal(err)
			}
			lat[i] = float64(time.Since(t).Microseconds()) / 1000
		}()
	}
	wg.Wait()
	el := time.Since(start)
	s := ds.Summarize(lat)
	return rate{rate: float64(n) / el.Seconds(), p50: s.P50, p99: s.P99}
}

type raceResult struct {
	rate               float64
	accepted, rejected int64
	hold               float64
}

// race: K участников без пауз отправляют пустые commit-ы (self-update) в текущую эпоху.
func race(ctx context.Context, svc *ds.Service, p *pgxpool.Pool, k int, d time.Duration) raceResult {
	gid := []byte("emul-race")
	if err := svc.CreateGroup(ctx, gid, "r0", 0); err != nil {
		log.Fatal(err)
	}
	// Участники r1..rK-1 попадают в карту листьев напрямую (подготовка, не замер).
	for i := 1; i < k; i++ {
		if _, err := p.Exec(ctx, `INSERT INTO group_leaves (group_id, leaf, device_id) VALUES ($1, $2, $3)`,
			gid, i, fmt.Sprintf("r%d", i)); err != nil {
			log.Fatal(err)
		}
	}
	var acc, rej atomic.Int64
	empty := mlswire.RosterDelta{}.Encode()
	body := make([]byte, 2000) // размер commit-а self-update в группе ~100 устройств
	stop := time.Now().Add(d)
	var wg sync.WaitGroup
	for i := range k {
		wg.Add(1)
		go func() {
			defer wg.Done()
			me := fmt.Sprintf("r%d", i)
			epoch := uint64(0)
			// Блоб у каждого участника свой: одинаковые commit-ы DS считал бы повтором уже
			// принятого и отвечал бы успехом.
			own := append([]byte(nil), body...)
			copy(own, me)
			for time.Now().Before(stop) {
				blob := mlswire.BuildPrivateMessage(gid, epoch, mlswire.ContentCommit, empty, own)
				a, err := svc.SubmitHandshake(ctx, gid, me, ds.KindCommit, blob, nil)
				switch {
				case err == nil:
					acc.Add(1)
					epoch = a.Epoch
				case ds.ErrorCode(err) == ds.CodeEpochMismatch:
					rej.Add(1)
					var e *ds.Error
					if errors.As(err, &e) {
						epoch = e.CurrentEpoch
					}
				default:
					log.Fatal(err)
				}
			}
		}()
	}
	wg.Wait()
	snap := svc.Stats.Snapshot()
	return raceResult{
		rate: float64(acc.Load()) / d.Seconds(), accepted: acc.Load(), rejected: rej.Load(),
		hold: snap.Dists["lock_hold.commit_ms"].P50,
	}
}

type cycleResult struct {
	total             time.Duration
	commits, reissued int64
	p50               float64
}

// cycle: N одновременных входов; один коммитер мгновенно коммитит все опубликованные Add
// синтетическим commit-ом и Welcome. Время — до последнего доставленного Welcome.
func cycle(ctx context.Context, svc *ds.Service, n int) cycleResult {
	gid := []byte("emul-cycle")
	devs := prepare(ctx, svc, gid, n)
	cctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go svc.RunBatcher(cctx)

	var commits atomic.Int64
	go func() {
		after := uint64(0)
		pending := map[string][]byte{} // устройство → KeyPackageRef
		occupied := map[uint32]struct{}{0: {}}
		epoch := uint64(0)
		for cctx.Err() == nil {
			hs, err := svc.Handshakes(cctx, gid, after, 0, 200*time.Millisecond)
			if err != nil {
				return
			}
			for _, h := range hs {
				after = h.Seq
				if h.Epoch < epoch || !h.FromExternalSender {
					continue
				}
				// Add от сервера: KeyPackage начинается после заголовка; ref и id берём из пакета.
				kp, ok := addedKeyPackage(h.Blob)
				if ok {
					pending[string(kp.Identity)] = kp.Ref
				}
			}
			if len(pending) == 0 {
				continue
			}
			var d mlswire.RosterDelta
			var refs [][]byte
			ids := make([]string, 0, len(pending))
			for id := range pending {
				ids = append(ids, id)
			}
			leaves := mlswire.AssignLeaves(occupied, nil, len(ids))
			for i, id := range ids {
				d.Added = append(d.Added, mlswire.AddedLeaf{Leaf: leaves[i], DeviceID: []byte(id)})
				refs = append(refs, pending[id])
			}
			blob := mlswire.BuildPrivateMessage(gid, epoch, mlswire.ContentCommit, d.Encode(), make([]byte, 1000))
			a, err := svc.SubmitHandshake(cctx, gid, "c0", ds.KindCommit, blob, mlswire.BuildWelcome(refs, make([]byte, 1000)))
			if err != nil {
				if ds.ErrorCode(err) == ds.CodeEpochMismatch || ds.ErrorCode(err) == ds.CodeUnauthorizedChange {
					continue
				}
				if cctx.Err() == nil {
					log.Fatal(err)
				}
				return
			}
			commits.Add(1)
			epoch = a.Epoch
			for _, l := range leaves {
				occupied[l] = struct{}{}
			}
			pending = map[string][]byte{}
		}
	}()

	lat := make([]float64, n)
	var wg sync.WaitGroup
	start := time.Now()
	for i, dev := range devs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			t := time.Now()
			if err := svc.RequestJoin(ctx, gid, dev); err != nil {
				log.Fatal(err)
			}
			for {
				ws, err := svc.Welcomes(ctx, dev, 5*time.Second)
				if err != nil {
					log.Fatal(err)
				}
				if len(ws) > 0 {
					break
				}
			}
			lat[i] = float64(time.Since(t).Milliseconds())
		}()
	}
	wg.Wait()
	total := time.Since(start)
	snap := svc.Stats.Snapshot()
	return cycleResult{total: total, commits: commits.Load(), reissued: snap.Counters["proposals.reissued"],
		p50: ds.Summarize(lat).P50}
}

// addedKeyPackage достаёт KeyPackage из предложения Add сервера: заголовок PublicMessage,
// затем ProposalType (2 байта) и KeyPackage до подписи сообщения.
func addedKeyPackage(msg []byte) (mlswire.KeyPackage, bool) {
	kp, err := mlswire.KeyPackageFromExternalAdd(msg)
	return kp, err == nil
}
