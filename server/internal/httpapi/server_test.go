// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"strings"
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

// TestHTTPErrorWriterScrubsAddresses: сообщения net/http идут в журнал сервера без адресов
// удалённой стороны (ADR-0028 п. 1).
func TestHTTPErrorWriterScrubsAddresses(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	w := httpErrorWriter{log: zerolog.New(&buf)}
	for _, line := range []string{
		"http: TLS handshake error from 203.0.113.77:51234: EOF\n",
		"http: panic serving [2001:db8::77]:443: boom\n",
		"http: Accept error: accept tcp 0.0.0.0:8080: too many open files; retrying in 5ms\n",
	} {
		if _, err := w.Write([]byte(line)); err != nil {
			t.Fatal(err)
		}
	}
	logged := buf.String()
	for _, addr := range []string{"203.0.113.77", "51234", "2001:db8::77", "0.0.0.0"} {
		if strings.Contains(logged, addr) {
			t.Errorf("адрес %q попал в журнал: %s", addr, logged)
		}
	}
	for _, want := range []string{`"source":"net/http"`, "TLS handshake error from <адрес>: EOF", "panic serving <адрес>: boom", "too many open files"} {
		if !strings.Contains(logged, want) {
			t.Errorf("журнал без %q: %s", want, logged)
		}
	}
}
