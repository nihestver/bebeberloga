// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package observability настраивает журнал (zerolog) и трассировку (OpenTelemetry).
//
// Трассировка включается только стандартными переменными OTEL_EXPORTER_OTLP_* —
// без заданного endpoint провайдер остаётся noop. Собственных настроек у сервера нет.
package observability

import (
	"fmt"
	"io"
	"time"

	"github.com/rs/zerolog"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

// NewLogger строит журнал по конфигурации. В формате console — читаемый вывод для разработки.
func NewLogger(cfg config.Log, w io.Writer) (zerolog.Logger, error) {
	level, err := zerolog.ParseLevel(cfg.Level)
	if err != nil {
		return zerolog.Nop(), fmt.Errorf("log.level: %w", err)
	}
	if cfg.Format == "console" {
		w = zerolog.ConsoleWriter{Out: w, TimeFormat: time.TimeOnly}
	}
	// Глобальные настройки zerolog не трогаем: формат времени по умолчанию — RFC 3339.
	return zerolog.New(w).Level(level).With().Timestamp().Logger(), nil
}
