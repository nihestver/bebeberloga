// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package observability настраивает журнал (zerolog) и трассировку (OpenTelemetry).
//
// Журнал сервера — общий модуль (ADR-0025): в поставке он пишется в файлы по дням и хранится
// 7 суток или 50 МБ (dailyfile.go), при разработке — в stdout.
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

// Loggers — журнал сервера и то, что нужно закрыть при остановке.
type Loggers struct {
	// Log — основной журнал. С заданным log.dir он пишется в файлы по дням (DailyFile),
	// без него — в stdout.
	Log zerolog.Logger
	// Startup — для строки запуска: она попадает и в основной журнал, и в stdout. Кроме неё
	// в stdout при заданном log.dir идут только фатальные ошибки — их печатает main.
	// Истории запросов в stdout нет: журнал контейнера ротируется по размеру, а не по сроку.
	Startup zerolog.Logger
	// Close закрывает файл журнала.
	Close func() error
}

// NewLogger строит журнал по конфигурации. В формате console — читаемый вывод для разработки
// (только для stdout; в файлы журнал всегда пишется в JSON).
func NewLogger(cfg config.Log, stdout io.Writer) (Loggers, error) {
	level, err := zerolog.ParseLevel(cfg.Level)
	if err != nil {
		return Loggers{}, fmt.Errorf("log.level: %w", err)
	}
	if cfg.Format == "console" {
		stdout = zerolog.ConsoleWriter{Out: stdout, TimeFormat: time.TimeOnly}
	}
	// Глобальные настройки zerolog не трогаем: формат времени по умолчанию — RFC 3339.
	build := func(w io.Writer) zerolog.Logger {
		return zerolog.New(w).Level(level).With().Timestamp().Logger()
	}
	if cfg.Dir == "" {
		log := build(stdout)
		return Loggers{Log: log, Startup: log, Close: func() error { return nil }}, nil
	}
	// Об ошибке записи самого журнала сообщается в stdout — обычной строкой журнала, без пути.
	console := build(stdout)
	file, err := OpenDailyFile(DailyFileOptions{
		Dir:      cfg.Dir,
		MaxDays:  cfg.MaxDays,
		MaxBytes: int64(cfg.MaxSizeMB) * 1024 * 1024,
		OnError: func(err error) {
			console.Error().Str("error", ErrorWithoutPath(err)).Msg("журнал: запись в файл не удалась")
		},
	})
	if err != nil {
		return Loggers{}, err
	}
	return Loggers{
		Log:     build(file),
		Startup: build(zerolog.MultiLevelWriter(file, stdout)),
		Close:   file.Close,
	}, nil
}
