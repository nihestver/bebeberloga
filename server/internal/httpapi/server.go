// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

// Serve слушает cfg.Addr и обслуживает handler, пока ctx не отменят; затем завершает
// открытые соединения в пределах cfg.ShutdownTimeout. ready (если задан) получает
// фактический адрес после начала прослушивания — удобно тестам и порту 0.
func Serve(ctx context.Context, log zerolog.Logger, cfg config.HTTP, handler http.Handler, ready func(net.Addr)) error {
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		ErrorLog:          nil, // ошибки net/http идут в stderr; собственный журнал запросов — в middleware
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}

	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("слушать %s: %w", cfg.Addr, err)
	}
	log.Info().Str("addr", ln.Addr().String()).Msg("HTTP-сервер слушает")
	if ready != nil {
		ready(ln.Addr())
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("HTTP-сервер: %w", err)
	case <-ctx.Done():
	}

	log.Info().Dur("timeout", cfg.ShutdownTimeout).Msg("останавливаю HTTP-сервер")
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("остановка HTTP-сервера: %w", err)
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("HTTP-сервер: %w", err)
	}
	return nil
}
