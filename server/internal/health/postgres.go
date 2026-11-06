// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package health

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres проверяет PostgreSQL через Ping пула. Пул создаётся лениво самим pgx:
// сервер стартует и при недоступной базе, а состояние показывает `GET /health`.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres разбирает URL и создаёт пул без немедленного соединения.
func NewPostgres(ctx context.Context, url string) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		// Текст ошибки pgx может содержать сам URL — наружу уходит только факт.
		return nil, fmt.Errorf("postgres: не удалось разобрать database.url")
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: пул: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

// Name — имя зависимости.
func (*Postgres) Name() string { return NamePostgres }

// Check выполняет Ping под контекстом вызывающего.
func (p *Postgres) Check(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// Pool отдаёт пул для остальных модулей сервера.
func (p *Postgres) Pool() *pgxpool.Pool { return p.pool }

// Close закрывает пул.
func (p *Postgres) Close() { p.pool.Close() }
