// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package observability

import (
	"context"
	"fmt"
	"os"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/nihestver/bebeberloga/server/internal/config"
)

// ServiceName — имя сервиса в телеметрии; OTEL_SERVICE_NAME его перекрывает.
const ServiceName = "bebeberloga-server"

// Tracing — провайдер трассировки и его остановка.
type Tracing struct {
	Provider trace.TracerProvider
	shutdown func(context.Context) error
}

// Shutdown сбрасывает буфер и останавливает экспорт.
func (t *Tracing) Shutdown(ctx context.Context) error {
	if t == nil || t.shutdown == nil {
		return nil
	}
	return t.shutdown(ctx)
}

// SetupTracing включает OTLP/HTTP-экспорт, если задан OTEL_EXPORTER_OTLP_ENDPOINT или
// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT; иначе ставит noop-провайдер. Остальные настройки
// экспортёра (заголовки, таймауты, сжатие) он читает из OTEL_EXPORTER_OTLP_* сам.
// Поддерживается только протокол http/protobuf; при OTEL_EXPORTER_OTLP_PROTOCOL=grpc
// трассировка не включается, о чём пишется предупреждение.
func SetupTracing(ctx context.Context, log zerolog.Logger, version string) (*Tracing, error) {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	}
	if endpoint == "" {
		otel.SetTracerProvider(noop.NewTracerProvider())
		return &Tracing{Provider: noop.NewTracerProvider()}, nil
	}
	if p := os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL"); p != "" && p != "http/protobuf" {
		log.Warn().Str("protocol", p).Msg("трассировка не включена: поддерживается только OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf")
		otel.SetTracerProvider(noop.NewTracerProvider())
		return &Tracing{Provider: noop.NewTracerProvider()}, nil
	}

	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("экспортёр OTLP: %w", err)
	}
	// Порядок важен: более поздний детектор перекрывает ранний, так OTEL_SERVICE_NAME
	// из окружения побеждает имя по умолчанию.
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(ServiceName),
			semconv.ServiceVersion(version),
		),
		resource.WithTelemetrySDK(),
		resource.WithFromEnv(),
	)
	if err != nil {
		return nil, fmt.Errorf("ресурс OTel: %w", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	// Endpoint — без userinfo и query; OTEL_EXPORTER_OTLP_HEADERS не журналируется вовсе.
	log.Info().Str("endpoint", config.Redacted(endpoint)).Msg("трассировка включена")
	return &Tracing{Provider: tp, shutdown: tp.Shutdown}, nil
}
