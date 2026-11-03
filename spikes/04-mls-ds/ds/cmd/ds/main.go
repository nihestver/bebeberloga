// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

// Команда ds — сервер прототипа MLS Delivery Service спайка S4.
package main

import (
	"context"
	"crypto/ed25519"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/api"
	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/ds"
	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/mlswire"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8484", "адрес HTTP")
	dsn := flag.String("db", "postgres://s4:s4@127.0.0.1:55432/s4?sslmode=disable", "строка подключения Postgres")
	poolSize := flag.Int("pool", 32, "соединений с Postgres")
	batch := flag.Duration("batch-interval", 0, "интервал публикации Add; 0 — сразу")
	maxBatch := flag.Int("max-batch", 0, "Add в ожидании commit-а одновременно; 0 — без ограничения")
	leading := flag.Bool("leading-edge", false, "публиковать заявку в группе без ожидающих Add сразу, не дожидаясь тика")
	allowExt := flag.Bool("allow-external-commit", false, "принимать external commit (допустимость решает B02)")
	leafLimit := flag.Int("leaf-limit", 5000, "лимит листьев новой группы")
	lock := flag.String("lock", "advisory", "сериализация: advisory | row")
	reset := flag.Bool("reset", false, "очистить таблицы при старте")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := pgxpool.ParseConfig(*dsn)
	if err != nil {
		log.Fatal(err)
	}
	cfg.MaxConns = int32(*poolSize) //nolint:gosec // флаг
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err = ds.Migrate(ctx, pool); err != nil {
		log.Fatal(err)
	}
	if *reset {
		if err = ds.Reset(ctx, pool); err != nil {
			log.Fatal(err)
		}
	}
	_, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		log.Fatal(err)
	}
	mode := ds.LockAdvisory
	if *lock == "row" {
		mode = ds.LockRow
	}
	svc := ds.New(pool, ds.Config{
		ExternalSender:      mlswire.ExternalSender{Key: key, Identity: []byte("ds.s4.local")},
		BatchInterval:       *batch,
		MaxBatch:            *maxBatch,
		LeadingEdge:         *leading,
		AllowExternalCommit: *allowExt,
		LeafLimit:           *leafLimit,
		Lock:                mode,
	})
	go svc.RunBatcher(ctx)

	srv := &http.Server{Addr: *addr, Handler: api.Handler(svc), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	fmt.Fprintf(os.Stderr, "ds: слушаю %s (batch=%s max-batch=%d leading-edge=%t lock=%s)\n", *addr, *batch, *maxBatch, *leading, *lock)
	if err = srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
