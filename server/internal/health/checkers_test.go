// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package health

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Порт 1 на loopback закрыт: соединение отказывается сразу, Docker не нужен.
const (
	deadPostgres = "postgres://bb:hunter2@127.0.0.1:1/bb?connect_timeout=1"
	deadValkey   = "redis://:hunter2@127.0.0.1:1/0"
	deadNATS     = "nats://bb:hunter2@127.0.0.1:1"
)

func shortCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestPostgresDown(t *testing.T) {
	t.Parallel()
	p, err := NewPostgres(context.Background(), deadPostgres)
	if err != nil {
		t.Fatalf("пул создаётся без соединения: %v", err)
	}
	defer p.Close()
	if err := p.Check(shortCtx(t)); err == nil {
		t.Fatal("ожидалась ошибка на закрытом порту")
	}
}

func TestPostgresBadURL(t *testing.T) {
	t.Parallel()
	_, err := NewPostgres(context.Background(), "postgres://bb:hunter2@[::1/bb")
	if err == nil {
		t.Fatal("ожидалась ошибка разбора")
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Errorf("ошибка раскрывает пароль: %v", err)
	}
}

func TestValkeyDown(t *testing.T) {
	t.Parallel()
	v, err := NewValkey(deadValkey)
	if err != nil {
		t.Fatal(err)
	}
	defer v.Close()
	err = v.Check(shortCtx(t))
	if err == nil {
		t.Fatal("ожидалась ошибка на закрытом порту")
	}
	if strings.Contains(err.Error(), "hunter2") {
		t.Errorf("ошибка раскрывает пароль: %v", err)
	}
	if err := v.Check(shortCtx(t)); err == nil {
		t.Fatal("повторная проверка тоже должна упасть")
	}
}

func TestValkeyBadURL(t *testing.T) {
	t.Parallel()
	if _, err := NewValkey("://нет"); err == nil {
		t.Fatal("ожидалась ошибка разбора")
	}
}

func TestValkeyClosed(t *testing.T) {
	t.Parallel()
	v, err := NewValkey(deadValkey)
	if err != nil {
		t.Fatal(err)
	}
	v.Close()
	if err := v.Check(shortCtx(t)); err == nil {
		t.Fatal("закрытый чекер должен возвращать ошибку")
	}
}

func TestNATSDown(t *testing.T) {
	t.Parallel()
	n, err := NewNATS(deadNATS)
	if err != nil {
		t.Fatalf("соединение с повтором создаётся без сервера: %v", err)
	}
	defer n.Close()
	if err := n.Check(shortCtx(t)); err == nil {
		t.Fatal("ожидалась ошибка: соединение не установлено")
	}
}
