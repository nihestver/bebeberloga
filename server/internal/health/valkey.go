// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package health

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/valkey-io/valkey-go"
)

// Valkey проверяет Valkey командой PING. Клиент valkey-go соединяется при создании,
// поэтому он создаётся при первой проверке и переиспользуется; если Valkey недоступен
// на старте, новая попытка — на следующей проверке (не чаще cache_ttl реестра).
type Valkey struct {
	opt valkey.ClientOption

	mu     sync.Mutex
	client valkey.Client
	closed bool
}

// NewValkey разбирает URL (redis://, rediss://, valkey://, valkeys://).
func NewValkey(url string) (*Valkey, error) {
	opt, err := valkey.ParseURL(url)
	if err != nil {
		// Текст ошибки может содержать URL с паролем — наружу уходит только факт.
		return nil, fmt.Errorf("valkey: не удалось разобрать valkey.url")
	}
	opt.ClientName = "bebeberloga-server"
	return &Valkey{opt: opt}, nil
}

// Name — имя зависимости.
func (*Valkey) Name() string { return NameValkey }

// Check создаёт клиент при необходимости и шлёт PING.
func (v *Valkey) Check(ctx context.Context) error {
	c, err := v.get(ctx)
	if err != nil {
		return err
	}
	return c.Do(ctx, c.B().Ping().Build()).Error()
}

func (v *Valkey) get(ctx context.Context) (valkey.Client, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return nil, errors.New("valkey: клиент закрыт")
	}
	if v.client != nil {
		return v.client, nil
	}
	opt := v.opt
	// Dialer учитывает контекст проверки, чтобы соединение не висело дольше общего таймаута.
	if deadline, ok := ctx.Deadline(); ok {
		opt.Dialer.Deadline = deadline
	}
	c, err := valkey.NewClient(opt)
	if err != nil {
		return nil, fmt.Errorf("valkey: соединение: %w", err)
	}
	v.client = c
	return c, nil
}

// Close закрывает клиент, если он был создан.
func (v *Valkey) Close() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.closed = true
	if v.client != nil {
		v.client.Close()
		v.client = nil
	}
}
