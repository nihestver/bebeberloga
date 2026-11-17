// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"context"
	"errors"
	"fmt"
	stdlog "log"
	"net"
	"net/http"
	"regexp"
	"strings"

	"github.com/rs/zerolog"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

// httpErrorWriter пишет сообщения net/http в журнал сервера. Без него они шли бы в stderr —
// в журнал контейнера, который ротируется по размеру, а не по сроку (RETENTION.md §6).
// net/http называет в некоторых сообщениях адрес удалённой стороны; адреса из текста убираются:
// если сервер стоит без прокси, это адрес клиента (ADR-0028 п. 1).
type httpErrorWriter struct{ log zerolog.Logger }

func (w httpErrorWriter) Write(p []byte) (int, error) {
	w.log.Warn().Str("source", "net/http").Msg(scrubAddrs(strings.TrimSpace(string(p))))
	return len(p), nil
}

// addrPattern — адрес IPv4 или IPv6 в скобках, с портом или без.
var addrPattern = regexp.MustCompile(`\[[0-9a-fA-F:.%]+\](:\d+)?|\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b`)

func scrubAddrs(s string) string {
	return addrPattern.ReplaceAllString(s, "<адрес>")
}

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
		ErrorLog:          stdlog.New(httpErrorWriter{log: log}, "", 0),
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
