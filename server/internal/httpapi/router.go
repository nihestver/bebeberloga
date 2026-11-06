// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"

	"github.com/nihestver/bebeberloga/server/gen/api"
	bebeberlogav1 "github.com/nihestver/bebeberloga/server/gen/bebeberloga/v1"
)

// BasePath — префикс REST (REST.md §1: версия в пути).
const BasePath = "/api/v1"

// NewRouter собирает маршрутизатор: служебные middleware, трассировка и контракт под BasePath.
func NewRouter(log zerolog.Logger, h api.StrictServerInterface, tp trace.TracerProvider) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// Адрес клиента за обратным прокси (X-Forwarded-For) здесь не подменяется: доверять
	// заголовку можно только от известного прокси, это решается вместе с rate limit (B06).
	r.Use(requestLogger(log))
	r.Use(recoverer)
	// Неизвестный маршрут и неподдерживаемый метод — одинаково 404 NOT_FOUND: статуса 405 в REST.md §2 нет,
	// а придумывать код ошибки в коде нельзя (server/STATUS.md, «Технические решения»).
	notFound := func(w http.ResponseWriter, _ *http.Request) {
		WriteError(w, http.StatusNotFound, bebeberlogav1.ErrorCode_ERROR_CODE_NOT_FOUND, "маршрут не найден")
	}
	r.NotFound(notFound)
	r.MethodNotAllowed(notFound)

	strict := api.NewStrictHandlerWithOptions(h, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			zerolog.Ctx(r.Context()).Debug().Err(err).Msg("запрос не разобран")
			WriteError(w, http.StatusBadRequest, bebeberlogav1.ErrorCode_ERROR_CODE_VALIDATION_FAILED, "запрос не разобран")
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			zerolog.Ctx(r.Context()).Error().Err(err).Msg("обработчик вернул ошибку")
			WriteError(w, http.StatusInternalServerError, bebeberlogav1.ErrorCode_ERROR_CODE_INTERNAL, "внутренняя ошибка")
		},
	})
	apiRouter := chi.NewRouter()
	api.HandlerWithOptions(strict, api.ChiServerOptions{
		BaseRouter: apiRouter,
		ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			WriteError(w, http.StatusBadRequest, bebeberlogav1.ErrorCode_ERROR_CODE_VALIDATION_FAILED, "параметры запроса не разобраны")
		},
	})
	r.Mount(BasePath, apiRouter)

	// Имя span-а до маршрутизации — только метод; шаблон маршрута добавляет requestLogger,
	// когда он известен. Сырой путь в телеметрию не попадает: в нём бывают коды приглашений.
	return otelhttp.NewHandler(r, "http.server",
		otelhttp.WithTracerProvider(tp),
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string { return r.Method }),
	)
}

// unmatchedRoute — значение поля route для запросов, не попавших ни в один маршрут.
const unmatchedRoute = "unmatched"

// requestLogger кладёт журнал с request_id в контекст и пишет строку на каждый ответ.
// В журнал и в имя span-а идёт шаблон маршрута (`/api/v1/health`), а не сырой путь:
// параметры пути (коды приглашений и т. п.) не должны оседать в журналах и трассировке.
func requestLogger(log zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			l := log.With().Str("request_id", middleware.GetReqID(r.Context())).Logger()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			ctx := l.WithContext(r.Context())
			next.ServeHTTP(ww, r.WithContext(ctx))
			route := unmatchedRoute
			// Внутри Mount ненайденный путь оставляет шаблон точки монтирования (`/api/v1/*`);
			// собственных wildcard-маршрутов у сервера нет, поэтому `/*` на конце — тоже «не найден».
			if rc := chi.RouteContext(ctx); rc != nil && rc.RoutePattern() != "" && !strings.HasSuffix(rc.RoutePattern(), "/*") {
				route = rc.RoutePattern()
			}
			trace.SpanFromContext(ctx).SetName(r.Method + " " + route)
			l.Info().
				Str("method", r.Method).
				Str("route", route).
				Int("status", ww.Status()).
				Int("bytes", ww.BytesWritten()).
				Dur("duration", time.Since(start)).
				Msg("http")
		})
	}
}

// recoverer превращает панику обработчика в 500 с записью в журнал: паника в обработчике — баг,
// но она не должна ронять процесс вместе с остальными соединениями.
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if err, ok := rec.(error); ok && err == http.ErrAbortHandler { //nolint:errorlint // sentinel сравнивается намеренно, как в net/http
					panic(rec)
				}
				zerolog.Ctx(r.Context()).Error().
					Interface("panic", rec).
					Bytes("stack", debug.Stack()).
					Msg("паника в обработчике")
				WriteError(w, http.StatusInternalServerError, bebeberlogav1.ErrorCode_ERROR_CODE_INTERNAL, "внутренняя ошибка")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
