// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel/trace/noop"
	"google.golang.org/protobuf/encoding/protojson"

	bebeberlogav1 "github.com/nihestver/bebeberloga/server/gen/bebeberloga/v1"
	"github.com/nihestver/bebeberloga/server/internal/health"
)

type fakeReporter struct{ rep health.Report }

func (f fakeReporter) Report(context.Context) health.Report { return f.rep }

func newTestServer(t *testing.T, rep health.Report, logOut io.Writer) *httptest.Server {
	t.Helper()
	log := zerolog.New(logOut)
	srv := httptest.NewServer(NewRouter(log, NewHandlers(fakeReporter{rep}, "v0.0.1-test"), noop.NewTracerProvider()))
	t.Cleanup(srv.Close)
	return srv
}

// get возвращает статус, заголовки и тело; *http.Response наружу не отдаётся — тело уже закрыто.
func get(t *testing.T, url string) (int, http.Header, []byte) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck // тест
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, resp.Header, body
}

func TestHealthOK(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t, health.Report{
		Status: bebeberlogav1.HealthState_HEALTH_STATE_OK,
		Checks: map[string]bebeberlogav1.HealthState{
			"postgres": bebeberlogav1.HealthState_HEALTH_STATE_OK,
			"valkey":   bebeberlogav1.HealthState_HEALTH_STATE_NOT_CONFIGURED,
		},
	}, io.Discard)

	status, header, body := get(t, srv.URL+"/api/v1/health")
	if status != http.StatusOK {
		t.Fatalf("статус %d, тело %s", status, body)
	}
	if ct := header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}

	// Форма protojson: snake_case, enum полным именем — то, что проверяет smoke-тест hurl.
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["status"] != "HEALTH_STATE_OK" || raw["version"] != "v0.0.1-test" {
		t.Errorf("тело %s", body)
	}
	checks, _ := raw["checks"].(map[string]any)
	if checks["postgres"] != "HEALTH_STATE_OK" || checks["valkey"] != "HEALTH_STATE_NOT_CONFIGURED" {
		t.Errorf("checks %v", raw["checks"])
	}

	var msg bebeberlogav1.HealthStatus
	if err := protojson.Unmarshal(body, &msg); err != nil {
		t.Fatalf("тело не разбирается как HealthStatus: %v", err)
	}
}

func TestHealthDown(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t, health.Report{
		Status: bebeberlogav1.HealthState_HEALTH_STATE_DOWN,
		Checks: map[string]bebeberlogav1.HealthState{"postgres": bebeberlogav1.HealthState_HEALTH_STATE_DOWN},
	}, io.Discard)

	status, _, body := get(t, srv.URL+"/api/v1/health")
	if status != http.StatusServiceUnavailable {
		t.Fatalf("статус %d, тело %s", status, body)
	}
	if !strings.Contains(string(body), `"status":"HEALTH_STATE_DOWN"`) {
		t.Errorf("тело %s", body)
	}
}

func TestHealthEmptyChecksEmitted(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t, health.Report{Status: bebeberlogav1.HealthState_HEALTH_STATE_OK}, io.Discard)
	_, _, body := get(t, srv.URL+"/api/v1/health")
	// EmitDefaultValues: поле checks из required есть и при пустой карте.
	if !strings.Contains(string(body), `"checks":{}`) {
		t.Errorf("тело %s", body)
	}
}

func TestNotFoundIsProtocolError(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t, health.Report{}, io.Discard)
	status, _, body := get(t, srv.URL+"/api/v1/nothing")
	if status != http.StatusNotFound {
		t.Fatalf("статус %d", status)
	}
	var e bebeberlogav1.Error
	if err := protojson.Unmarshal(body, &e); err != nil {
		t.Fatalf("тело не Error: %v (%s)", err, body)
	}
	if e.GetCode() != bebeberlogav1.ErrorCode_ERROR_CODE_NOT_FOUND {
		t.Errorf("code = %s", e.GetCode())
	}
}

func TestRequestLogged(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	srv := newTestServer(t, health.Report{Status: bebeberlogav1.HealthState_HEALTH_STATE_OK}, &buf)
	get(t, srv.URL+"/api/v1/health")
	logLine := buf.String()
	for _, want := range []string{`"request_id"`, `"route":"/api/v1/health"`, `"status":200`} {
		if !strings.Contains(logLine, want) {
			t.Errorf("журнал без %s: %s", want, logLine)
		}
	}
}

func TestUnmatchedRouteNotLoggedRaw(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	srv := newTestServer(t, health.Report{}, &buf)
	status, _, _ := get(t, srv.URL+"/api/v1/invites/SECRET-CODE")
	if status != http.StatusNotFound {
		t.Fatalf("статус %d", status)
	}
	logLine := buf.String()
	if !strings.Contains(logLine, `"route":"unmatched"`) {
		t.Errorf("журнал без route=unmatched: %s", logLine)
	}
	if strings.Contains(logLine, "SECRET-CODE") {
		t.Errorf("сырой путь попал в журнал: %s", logLine)
	}
}

func TestMethodNotAllowedIs404(t *testing.T) {
	t.Parallel()
	srv := newTestServer(t, health.Report{}, io.Discard)
	resp, err := http.Post(srv.URL+"/api/v1/health", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close() //nolint:errcheck // тест
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("статус %d, ожидался 404 (405 в REST.md §2 нет)", resp.StatusCode)
	}
	var e bebeberlogav1.Error
	body, _ := io.ReadAll(resp.Body)
	if err := protojson.Unmarshal(body, &e); err != nil || e.GetCode() != bebeberlogav1.ErrorCode_ERROR_CODE_NOT_FOUND {
		t.Errorf("тело %s", body)
	}
}

func TestRecovererTurnsPanicInto500(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	h := recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("бум") }))
	log := zerolog.New(&buf)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	h.ServeHTTP(rec, req.WithContext(log.WithContext(req.Context())))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("статус %d", rec.Code)
	}
	var e bebeberlogav1.Error
	if err := protojson.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.GetCode() != bebeberlogav1.ErrorCode_ERROR_CODE_INTERNAL {
		t.Errorf("тело %s", rec.Body.String())
	}
	if !strings.Contains(buf.String(), "бум") {
		t.Errorf("паника не попала в журнал: %s", buf.String())
	}
}
