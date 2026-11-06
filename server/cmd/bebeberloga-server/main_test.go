// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

func noEnv(string) (string, bool) { return "", false }

func TestRunDispatch(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		args       []string
		wantCode   int
		wantStdout string
		wantStderr string
	}{
		{name: "без аргументов", args: nil, wantCode: 2, wantStderr: "Подкоманды"},
		{name: "неизвестная", args: []string{"fly"}, wantCode: 2, wantStderr: "неизвестная подкоманда"},
		{name: "help", args: []string{"help"}, wantCode: 0, wantStdout: "Подкоманды"},
		{name: "version", args: []string{"version"}, wantCode: 0},
		{name: "migrate — заглушка", args: []string{"migrate"}, wantCode: 1, wantStderr: "ещё не реализовано"},
		{name: "admin — заглушка", args: []string{"admin"}, wantCode: 1, wantStderr: "ещё не реализовано"},
		{name: "migrate -h", args: []string{"migrate", "-h"}, wantCode: 0},
		{name: "serve с неизвестным флагом", args: []string{"serve", "--port=1"}, wantCode: 2},
		{name: "serve с лишним аргументом", args: []string{"serve", "extra"}, wantCode: 2, wantStderr: "лишние аргументы"},
		{name: "serve с несуществующим конфигом", args: []string{"serve", "--config", "/nonexistent/bb.yaml"}, wantCode: 1, wantStderr: "конфиг"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var stdout, stderr bytes.Buffer
			code := run(context.Background(), tt.args, noEnv, &stdout, &stderr)
			if code != tt.wantCode {
				t.Errorf("код %d, want %d; stderr: %s", code, tt.wantCode, stderr.String())
			}
			if tt.wantStdout != "" && !strings.Contains(stdout.String(), tt.wantStdout) {
				t.Errorf("stdout %q без %q", stdout.String(), tt.wantStdout)
			}
			if tt.wantStderr != "" && !strings.Contains(stderr.String(), tt.wantStderr) {
				t.Errorf("stderr %q без %q", stderr.String(), tt.wantStderr)
			}
		})
	}
}

func TestVersionPrintsSomething(t *testing.T) {
	t.Parallel()
	var stdout bytes.Buffer
	if code := run(context.Background(), []string{"version"}, noEnv, &stdout, io.Discard); code != 0 || strings.TrimSpace(stdout.String()) == "" {
		t.Fatalf("code=%d stdout=%q", code, stdout.String())
	}
}

func TestServeInvalidConfigFromEnv(t *testing.T) {
	t.Parallel()
	env := func(k string) (string, bool) {
		if k == "BB_LOG_LEVEL" {
			return "loud", true
		}
		return "", false
	}
	var stderr bytes.Buffer
	if code := run(context.Background(), []string{"serve"}, env, io.Discard, &stderr); code != 1 || !strings.Contains(stderr.String(), "log.level") {
		t.Fatalf("code=%d stderr=%q", code, stderr.String())
	}
}

func TestServeConfigFromBBConfig(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "bb.yaml")
	if err := os.WriteFile(path, []byte("http:\n  address: x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := func(k string) (string, bool) {
		if k == "BB_CONFIG" {
			return path, true
		}
		return "", false
	}
	var stderr bytes.Buffer
	if code := run(context.Background(), []string{"serve"}, env, io.Discard, &stderr); code != 1 || !strings.Contains(stderr.String(), "address") {
		t.Fatalf("BB_CONFIG не подхвачен: code=%d stderr=%q", code, stderr.String())
	}
}

// TestServeEndToEnd поднимает сервер без зависимостей и дёргает /api/v1/health: без инфраструктуры
// все зависимости NOT_CONFIGURED и статус OK — это сценарий smoke-теста B17 части 1.
func TestServeEndToEnd(t *testing.T) {
	t.Parallel()
	cfg := config.Default()
	cfg.HTTP.Addr = "127.0.0.1:0"
	cfg.Log.Level = "error"

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addrCh := make(chan net.Addr, 1)
	errCh := make(chan error, 1)
	var logs bytes.Buffer
	go func() { errCh <- serve(ctx, cfg, &logs, func(a net.Addr) { addrCh <- a }) }()

	var addr net.Addr
	select {
	case addr = <-addrCh:
	case err := <-errCh:
		t.Fatalf("serve завершился: %v; журнал: %s", err, logs.String())
	case <-time.After(10 * time.Second):
		t.Fatal("сервер не стартовал")
	}

	resp, err := http.Get("http://" + addr.String() + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck // тест
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("статус %d", resp.StatusCode)
	}
	var body struct {
		Status  string            `json:"status"`
		Version string            `json:"version"`
		Checks  map[string]string `json:"checks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "HEALTH_STATE_OK" || body.Version == "" {
		t.Errorf("тело %+v", body)
	}
	for _, dep := range []string{"postgres", "valkey", "nats"} {
		if body.Checks[dep] != "HEALTH_STATE_NOT_CONFIGURED" {
			t.Errorf("checks[%s] = %q", dep, body.Checks[dep])
		}
	}

	cancel()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("serve: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("сервер не остановился")
	}
}

// TestServeWithDeadDependencies: настроенные, но недоступные зависимости дают 503 и DOWN,
// а сервер при этом стартует.
func TestServeWithDeadDependencies(t *testing.T) {
	t.Parallel()
	cfg := config.Default()
	cfg.HTTP.Addr = "127.0.0.1:0"
	cfg.Log.Level = "error"
	cfg.Health.Timeout = 500 * time.Millisecond
	cfg.Database.URL = "postgres://bb:hunter2@127.0.0.1:1/bb?connect_timeout=1"
	cfg.Valkey.URL = "redis://:hunter2@127.0.0.1:1/0"
	cfg.NATS.URL = "nats://bb:hunter2@127.0.0.1:1"

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addrCh := make(chan net.Addr, 1)
	errCh := make(chan error, 1)
	var logs bytes.Buffer
	go func() { errCh <- serve(ctx, cfg, &logs, func(a net.Addr) { addrCh <- a }) }()

	var addr net.Addr
	select {
	case addr = <-addrCh:
	case err := <-errCh:
		t.Fatalf("serve завершился: %v; журнал: %s", err, logs.String())
	case <-time.After(10 * time.Second):
		t.Fatal("сервер не стартовал")
	}

	resp, err := http.Get("http://" + addr.String() + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck // тест
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("статус %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(raw), "hunter2") || strings.Contains(string(raw), "127.0.0.1") {
		t.Errorf("ответ раскрывает адреса или пароли: %s", raw)
	}
	for _, dep := range []string{"postgres", "valkey", "nats"} {
		if !strings.Contains(string(raw), `"`+dep+`":"HEALTH_STATE_DOWN"`) {
			t.Errorf("checks[%s] не DOWN: %s", dep, raw)
		}
	}

	cancel()
	if err := <-errCh; err != nil {
		t.Fatalf("serve: %v", err)
	}
	if strings.Contains(logs.String(), "hunter2") {
		t.Errorf("журнал раскрывает пароль: %s", logs.String())
	}
}
