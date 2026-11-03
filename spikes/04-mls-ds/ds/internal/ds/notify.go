// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

package ds

import (
	"slices"
	"sync"
	"time"
)

// notifier будит long-poll-запросы. В спайке один процесс DS; в продукте то же делает NATS
// между репликами gateway (ARCHITECTURE §5.6).
type notifier struct {
	mu sync.Mutex
	ch map[string]chan struct{}
}

func newNotifier() *notifier { return &notifier{ch: map[string]chan struct{}{}} }

// wait возвращает канал, который закроется при следующем fire(key). Подписываться нужно до
// чтения из базы, иначе событие между чтением и подпиской потеряется.
func (n *notifier) wait(key string) <-chan struct{} {
	n.mu.Lock()
	defer n.mu.Unlock()
	c, ok := n.ch[key]
	if !ok {
		c = make(chan struct{})
		n.ch[key] = c
	}
	return c
}

func (n *notifier) fire(keys ...string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, k := range keys {
		if c, ok := n.ch[k]; ok {
			close(c)
			delete(n.ch, k)
		}
	}
}

func groupKey(id []byte) string  { return "g:" + string(id) }
func deviceKey(id string) string { return "d:" + id }

// Stats — счётчики и распределения для отчёта нагрузочного теста. Имена распределений
// оканчиваются единицей: `_ms` или `_bytes`.
type Stats struct {
	mu       sync.Mutex
	counters map[string]int64
	values   map[string][]float64
}

func newStats() *Stats {
	return &Stats{counters: map[string]int64{}, values: map[string][]float64{}}
}

func (s *Stats) inc(name string, n int64) {
	s.mu.Lock()
	s.counters[name] += n
	s.mu.Unlock()
}

func (s *Stats) observe(name string, v float64) {
	s.mu.Lock()
	s.values[name] = append(s.values[name], v)
	s.mu.Unlock()
}

func (s *Stats) observeDur(name string, d time.Duration) {
	s.observe(name+"_ms", float64(d.Microseconds())/1000)
}

// Reset обнуляет статистику между сценариями.
func (s *Stats) Reset() {
	s.mu.Lock()
	s.counters = map[string]int64{}
	s.values = map[string][]float64{}
	s.mu.Unlock()
}

// Dist — сводка распределения.
type Dist struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
	Max   float64 `json:"max"`
	Sum   float64 `json:"sum"`
}

// Snapshot — копия статистики.
type Snapshot struct {
	Counters map[string]int64 `json:"counters"`
	Dists    map[string]Dist  `json:"dists"`
}

// Snapshot считает перцентили.
func (s *Stats) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Snapshot{Counters: map[string]int64{}, Dists: map[string]Dist{}}
	for k, v := range s.counters {
		out.Counters[k] = v
	}
	for k, v := range s.values {
		out.Dists[k] = Summarize(v)
	}
	return out
}

// Summarize считает перцентили по выборке.
func Summarize(v []float64) Dist {
	if len(v) == 0 {
		return Dist{}
	}
	x := slices.Clone(v)
	slices.Sort(x)
	q := func(p float64) float64 { return x[min(len(x)-1, int(p*float64(len(x))))] }
	var sum float64
	for _, d := range x {
		sum += d
	}
	return Dist{Count: len(x), P50: q(0.50), P95: q(0.95), P99: q(0.99), Max: x[len(x)-1], Sum: sum}
}
