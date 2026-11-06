// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"time"

	"github.com/rs/zerolog"

	"github.com/nihestver/bebeberloga/server/internal/buildinfo"
	"github.com/nihestver/bebeberloga/server/internal/config"
	"github.com/nihestver/bebeberloga/server/internal/health"
	"github.com/nihestver/bebeberloga/server/internal/httpapi"
	"github.com/nihestver/bebeberloga/server/internal/observability"
)

// cmdServe запускает сервер и работает до отмены ctx (SIGINT/SIGTERM).
func cmdServe(ctx context.Context, args []string, lookupEnv func(string) (string, bool), stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := configFlags(fs, lookupEnv)
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	cfg, err := config.Load(*configPath, lookupEnv)
	if err != nil {
		return err
	}
	return serve(ctx, cfg, stdout, nil)
}

// serve собирает зависимости и обслуживает HTTP. ready сообщает адрес прослушивания (для тестов).
func serve(ctx context.Context, cfg config.Config, logOut io.Writer, ready func(net.Addr)) error {
	log, err := observability.NewLogger(cfg.Log, logOut)
	if err != nil {
		return err
	}
	version := buildinfo.Version()
	log.Info().Str("version", version).Msg("bebeberloga-server запускается")

	tracing, err := observability.SetupTracing(ctx, log, version)
	if err != nil {
		return err
	}
	defer shutdownQuietly(log, "трассировка", tracing.Shutdown)

	registry, closeDeps, err := buildHealth(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer closeDeps()
	log.Info().Strs("dependencies", registry.Names()).Msg("зависимости зарегистрированы")

	handlers := httpapi.NewHandlers(registry, version)
	router := httpapi.NewRouter(log, handlers, tracing.Provider)
	if err := httpapi.Serve(ctx, log, cfg.HTTP, router, ready); err != nil {
		return err
	}
	log.Info().Msg("bebeberloga-server остановлен")
	return nil
}

// buildHealth создаёт клиентов настроенных зависимостей и реестр проверок.
// Незаданный URL — зависимость «не настроена», а не ошибка: часть 0 работает без инфраструктуры.
func buildHealth(ctx context.Context, cfg config.Config, log zerolog.Logger) (*health.Registry, func(), error) {
	var (
		opts    []health.Option
		closers []func()
	)
	closeAll := func() {
		for _, c := range closers {
			c()
		}
	}

	if cfg.Database.URL == "" {
		opts = append(opts, health.WithNotConfigured(health.NamePostgres))
	} else {
		pg, err := health.NewPostgres(ctx, cfg.Database.URL)
		if err != nil {
			closeAll()
			return nil, nil, err
		}
		closers = append(closers, pg.Close)
		opts = append(opts, health.WithChecker(pg))
		log.Info().Str("url", config.Redacted(cfg.Database.URL)).Msg("postgres настроен")
	}

	if cfg.Valkey.URL == "" {
		opts = append(opts, health.WithNotConfigured(health.NameValkey))
	} else {
		vk, err := health.NewValkey(cfg.Valkey.URL)
		if err != nil {
			closeAll()
			return nil, nil, err
		}
		closers = append(closers, vk.Close)
		opts = append(opts, health.WithChecker(vk))
		log.Info().Str("url", config.Redacted(cfg.Valkey.URL)).Msg("valkey настроен")
	}

	if cfg.NATS.URL == "" {
		opts = append(opts, health.WithNotConfigured(health.NameNATS))
	} else {
		nc, err := health.NewNATS(cfg.NATS.URL)
		if err != nil {
			closeAll()
			return nil, nil, err
		}
		closers = append(closers, nc.Close)
		opts = append(opts, health.WithChecker(nc))
		log.Info().Str("url", config.Redacted(cfg.NATS.URL)).Msg("nats настроен")
	}

	return health.NewRegistry(log, cfg.Health.Timeout, cfg.Health.CacheTTL, opts...), closeAll, nil
}

// shutdownQuietly выполняет остановку с собственным таймаутом и пишет ошибку в журнал.
func shutdownQuietly(log zerolog.Logger, what string, fn func(context.Context) error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := fn(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Warn().Err(err).Msg(fmt.Sprintf("%s: остановка с ошибкой", what))
	}
}
