// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package health

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcnats "github.com/testcontainers/testcontainers-go/modules/nats"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	tcvalkey "github.com/testcontainers/testcontainers-go/modules/valkey"
)

// Интеграционные тесты чекеров против настоящих зависимостей в контейнерах.
// Пропускаются при `go test -short` и, вне CI, при недоступном Docker; в CI (`CI=true`)
// недоступный Docker — ошибка, а не пропуск, чтобы тесты не исчезали молча.

func integrationCtx(t *testing.T) context.Context {
	t.Helper()
	if testing.Short() {
		t.Skip("интеграционный тест: пропущен при -short")
	}
	if os.Getenv("CI") == "" {
		testcontainers.SkipIfProviderIsNotHealthy(t)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	t.Cleanup(cancel)
	return ctx
}

func TestIntegrationPostgres(t *testing.T) {
	ctx := integrationCtx(t)
	c, err := tcpostgres.Run(ctx, "postgres:16",
		tcpostgres.WithDatabase("bb"), tcpostgres.WithUsername("bb"), tcpostgres.WithPassword("bb"),
		tcpostgres.BasicWaitStrategies())
	testcontainers.CleanupContainer(t, c)
	if err != nil {
		t.Fatal(err)
	}
	url, err := c.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}

	p, err := NewPostgres(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := p.Check(shortCtx(t)); err != nil {
		t.Fatalf("Check: %v", err)
	}

	if err := c.Stop(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if err := p.Check(shortCtx(t)); err == nil {
		t.Fatal("после остановки контейнера ожидалась ошибка")
	}
}

func TestIntegrationValkey(t *testing.T) {
	ctx := integrationCtx(t)
	c, err := tcvalkey.Run(ctx, "valkey/valkey:8")
	testcontainers.CleanupContainer(t, c)
	if err != nil {
		t.Fatal(err)
	}
	url, err := c.ConnectionString(ctx)
	if err != nil {
		t.Fatal(err)
	}

	v, err := NewValkey(url)
	if err != nil {
		t.Fatal(err)
	}
	defer v.Close()
	if err := v.Check(shortCtx(t)); err != nil {
		t.Fatalf("Check: %v", err)
	}

	if err := c.Stop(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if err := v.Check(shortCtx(t)); err == nil {
		t.Fatal("после остановки контейнера ожидалась ошибка")
	}
}

func TestIntegrationNATS(t *testing.T) {
	ctx := integrationCtx(t)
	c, err := tcnats.Run(ctx, "nats:2")
	testcontainers.CleanupContainer(t, c)
	if err != nil {
		t.Fatal(err)
	}
	url, err := c.ConnectionString(ctx)
	if err != nil {
		t.Fatal(err)
	}

	n, err := NewNATS(url)
	if err != nil {
		t.Fatal(err)
	}
	defer n.Close()
	// RetryOnFailedConnect соединяется асинхронно — дожидаемся.
	deadline := time.Now().Add(10 * time.Second)
	for n.Check(ctx) != nil && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if err := n.Check(ctx); err != nil {
		t.Fatalf("Check: %v", err)
	}

	if err := c.Stop(ctx, nil); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(10 * time.Second)
	for n.Check(ctx) == nil && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if err := n.Check(ctx); err == nil {
		t.Fatal("после остановки контейнера ожидалась ошибка")
	}
}
