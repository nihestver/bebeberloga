// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package health проверяет зависимости сервера для `GET /health`.
//
// Чекеры работают с долгоживущими клиентами, созданными при старте, и не открывают
// соединений на каждый запрос. Реестр кэширует результат на cache_ttl и выполняет
// проверки под одной блокировкой, так что параллельные запросы не плодят проверок.
// Наружу уходят только состояния; тексты ошибок остаются в журнале.
package health

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/rs/zerolog"

	bebeberlogav1 "github.com/nihestver/bebeberloga/server/gen/bebeberloga/v1"
)

// Имена зависимостей в ответе.
const (
	NamePostgres = "postgres"
	NameValkey   = "valkey"
	NameNATS     = "nats"
)

// Checker — одна зависимость. Check возвращает nil, если зависимость доступна.
// Контекст несёт общий таймаут; реализация обязана его уважать.
type Checker interface {
	Name() string
	Check(ctx context.Context) error
}

// Report — результат проверки всех зависимостей.
type Report struct {
	// Status — HEALTH_STATE_OK, если ни одна настроенная зависимость не упала, иначе HEALTH_STATE_DOWN.
	Status bebeberlogav1.HealthState
	Checks map[string]bebeberlogav1.HealthState
}

// Healthy — true, если можно отвечать 200.
func (r Report) Healthy() bool {
	return r.Status == bebeberlogav1.HealthState_HEALTH_STATE_OK
}

// Registry собирает чекеры и кэширует результат.
type Registry struct {
	checkers []Checker
	// notConfigured — зависимости, адрес которых не задан; в ответе — HEALTH_STATE_NOT_CONFIGURED.
	notConfigured []string
	timeout       time.Duration
	ttl           time.Duration
	log           zerolog.Logger
	now           func() time.Time

	mu       sync.Mutex
	cached   Report
	cachedAt time.Time
}

// Option настраивает реестр.
type Option func(*Registry)

// WithChecker добавляет зависимость.
func WithChecker(c Checker) Option {
	return func(r *Registry) { r.checkers = append(r.checkers, c) }
}

// WithNotConfigured отмечает зависимость, адрес которой не задан.
func WithNotConfigured(name string) Option {
	return func(r *Registry) { r.notConfigured = append(r.notConfigured, name) }
}

// withNow подменяет часы в тестах.
func withNow(now func() time.Time) Option {
	return func(r *Registry) { r.now = now }
}

// NewRegistry создаёт реестр. timeout — общее время на все проверки, ttl — срок кэша.
func NewRegistry(log zerolog.Logger, timeout, ttl time.Duration, opts ...Option) *Registry {
	r := &Registry{timeout: timeout, ttl: ttl, log: log, now: time.Now}
	for _, o := range opts {
		o(r)
	}
	return r
}

// Report возвращает состояние зависимостей, при свежем кэше — без новой проверки.
func (r *Registry) Report(ctx context.Context) Report {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	if !r.cachedAt.IsZero() && now.Sub(r.cachedAt) < r.ttl {
		return r.cached
	}
	r.cached = r.run(ctx)
	r.cachedAt = now
	return r.cached
}

// run выполняет проверки параллельно под общим таймаутом.
func (r *Registry) run(ctx context.Context) Report {
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()

	type result struct {
		name string
		err  error
	}
	results := make(chan result, len(r.checkers))
	for _, c := range r.checkers {
		go func(c Checker) {
			results <- result{name: c.Name(), err: c.Check(ctx)}
		}(c)
	}

	rep := Report{
		Status: bebeberlogav1.HealthState_HEALTH_STATE_OK,
		Checks: make(map[string]bebeberlogav1.HealthState, len(r.checkers)+len(r.notConfigured)),
	}
	for _, name := range r.notConfigured {
		rep.Checks[name] = bebeberlogav1.HealthState_HEALTH_STATE_NOT_CONFIGURED
	}
	for range r.checkers {
		res := <-results
		if res.err != nil {
			r.log.Warn().Str("dependency", res.name).Err(res.err).Msg("зависимость недоступна")
			rep.Checks[res.name] = bebeberlogav1.HealthState_HEALTH_STATE_DOWN
			rep.Status = bebeberlogav1.HealthState_HEALTH_STATE_DOWN
			continue
		}
		rep.Checks[res.name] = bebeberlogav1.HealthState_HEALTH_STATE_OK
	}
	return rep
}

// Names возвращает имена всех зависимостей реестра по алфавиту — для журнала при старте.
func (r *Registry) Names() []string {
	names := make([]string, 0, len(r.checkers)+len(r.notConfigured))
	for _, c := range r.checkers {
		names = append(names, c.Name())
	}
	names = append(names, r.notConfigured...)
	sort.Strings(names)
	return names
}
