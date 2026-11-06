// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

func TestServeStartsAndStops(t *testing.T) {
	t.Parallel()
	cfg := config.Default().HTTP
	cfg.Addr = "127.0.0.1:0"
	cfg.ShutdownTimeout = 2 * time.Second

	ctx, cancel := context.WithCancel(context.Background())
	addrCh := make(chan net.Addr, 1)
	errCh := make(chan error, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	go func() {
		errCh <- Serve(ctx, zerolog.Nop(), cfg, handler, func(a net.Addr) { addrCh <- a })
	}()

	var addr net.Addr
	select {
	case addr = <-addrCh:
	case err := <-errCh:
		t.Fatalf("сервер завершился до старта: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("сервер не начал слушать")
	}

	resp, err := http.Get("http://" + addr.String() + "/")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("статус %d", resp.StatusCode)
	}

	cancel()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Serve: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("сервер не остановился по отмене контекста")
	}
}

func TestServeBadAddr(t *testing.T) {
	t.Parallel()
	cfg := config.Default().HTTP
	cfg.Addr = "999.0.0.1:1"
	if err := Serve(context.Background(), zerolog.Nop(), cfg, http.NotFoundHandler(), nil); err == nil {
		t.Fatal("ожидалась ошибка прослушивания")
	}
}
