// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package health

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	bebeberlogav1 "github.com/nihestver/bebeberloga/server/gen/bebeberloga/v1"
)

type fakeChecker struct {
	name  string
	err   error
	delay time.Duration
	calls atomic.Int32
}

func (f *fakeChecker) Name() string { return f.name }

func (f *fakeChecker) Check(ctx context.Context) error {
	f.calls.Add(1)
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return f.err
}

func TestRegistryAllOK(t *testing.T) {
	t.Parallel()
	r := NewRegistry(zerolog.Nop(), time.Second, time.Second,
		WithChecker(&fakeChecker{name: "a"}),
		WithChecker(&fakeChecker{name: "b"}),
		WithNotConfigured("c"),
	)
	rep := r.Report(context.Background())
	if !rep.Healthy() {
		t.Fatalf("ожидалось OK: %+v", rep)
	}
	want := map[string]bebeberlogav1.HealthState{
		"a": bebeberlogav1.HealthState_HEALTH_STATE_OK,
		"b": bebeberlogav1.HealthState_HEALTH_STATE_OK,
		"c": bebeberlogav1.HealthState_HEALTH_STATE_NOT_CONFIGURED,
	}
	for k, v := range want {
		if rep.Checks[k] != v {
			t.Errorf("checks[%s] = %s, want %s", k, rep.Checks[k], v)
		}
	}
	if len(rep.Checks) != len(want) {
		t.Errorf("лишние записи: %+v", rep.Checks)
	}
	if got := r.Names(); len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Errorf("Names() = %v", got)
	}
}

func TestRegistryOneDown(t *testing.T) {
	t.Parallel()
	r := NewRegistry(zerolog.Nop(), time.Second, time.Second,
		WithChecker(&fakeChecker{name: "a"}),
		WithChecker(&fakeChecker{name: "b", err: errors.New("отказ")}),
	)
	rep := r.Report(context.Background())
	if rep.Healthy() {
		t.Fatalf("ожидалось DOWN: %+v", rep)
	}
	if rep.Checks["a"] != bebeberlogav1.HealthState_HEALTH_STATE_OK || rep.Checks["b"] != bebeberlogav1.HealthState_HEALTH_STATE_DOWN {
		t.Errorf("checks = %+v", rep.Checks)
	}
}

func TestRegistryTimeout(t *testing.T) {
	t.Parallel()
	slow := &fakeChecker{name: "slow", delay: time.Minute}
	r := NewRegistry(zerolog.Nop(), 50*time.Millisecond, time.Second, WithChecker(slow))
	start := time.Now()
	rep := r.Report(context.Background())
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("проверка не уложилась в таймаут: %s", elapsed)
	}
	if rep.Checks["slow"] != bebeberlogav1.HealthState_HEALTH_STATE_DOWN {
		t.Errorf("медленная зависимость должна быть DOWN: %+v", rep)
	}
}

func TestRegistryOnlyNotConfigured(t *testing.T) {
	t.Parallel()
	r := NewRegistry(zerolog.Nop(), time.Second, time.Second,
		WithNotConfigured(NamePostgres), WithNotConfigured(NameValkey), WithNotConfigured(NameNATS))
	rep := r.Report(context.Background())
	if !rep.Healthy() {
		t.Fatalf("без настроенных зависимостей сервер считается здоровым: %+v", rep)
	}
	if len(rep.Checks) != 3 {
		t.Errorf("checks = %+v", rep.Checks)
	}
}

func TestRegistryCache(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_000_000, 0)
	var mu sync.Mutex
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	advance := func(d time.Duration) { mu.Lock(); defer mu.Unlock(); now = now.Add(d) }

	c := &fakeChecker{name: "a"}
	r := NewRegistry(zerolog.Nop(), time.Second, 2*time.Second, WithChecker(c), withNow(clock))

	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() { r.Report(context.Background()) })
	}
	wg.Wait()
	if got := c.calls.Load(); got != 1 {
		t.Errorf("20 параллельных запросов в пределах TTL должны дать одну проверку, было %d", got)
	}

	advance(1900 * time.Millisecond)
	r.Report(context.Background())
	if got := c.calls.Load(); got != 1 {
		t.Errorf("до истечения TTL новой проверки быть не должно, было %d", got)
	}

	advance(200 * time.Millisecond)
	r.Report(context.Background())
	if got := c.calls.Load(); got != 2 {
		t.Errorf("после TTL ожидалась вторая проверка, было %d", got)
	}
}
