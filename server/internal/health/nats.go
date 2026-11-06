// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package health

import (
	"context"
	"fmt"

	"github.com/nats-io/nats.go"
)

// NATS проверяет состояние долгоживущего соединения. Соединение создаётся при старте
// с бесконечными повторами, поэтому сервер поднимается и при недоступном NATS.
type NATS struct {
	conn *nats.Conn
}

// NewNATS открывает соединение с повтором при неудаче.
func NewNATS(url string) (*NATS, error) {
	conn, err := nats.Connect(url,
		nats.Name("bebeberloga-server"),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
	)
	if err != nil {
		// Текст ошибки может содержать URL с учётными данными — наружу уходит только факт.
		return nil, fmt.Errorf("nats: не удалось создать соединение по nats.url")
	}
	return &NATS{conn: conn}, nil
}

// Name — имя зависимости.
func (*NATS) Name() string { return NameNATS }

// Check считает зависимость доступной, когда соединение установлено.
func (n *NATS) Check(context.Context) error {
	if st := n.conn.Status(); st != nats.CONNECTED {
		return fmt.Errorf("nats: состояние соединения %s", st)
	}
	return nil
}

// Conn отдаёт соединение для остальных модулей сервера.
func (n *NATS) Conn() *nats.Conn { return n.conn }

// Close закрывает соединение.
func (n *NATS) Close() { n.conn.Close() }
