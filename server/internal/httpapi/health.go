// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package httpapi

import (
	"context"
	"net/http"

	"github.com/nihestver/bebeberloga/server/gen/api"
	bebeberlogav1 "github.com/nihestver/bebeberloga/server/gen/bebeberloga/v1"
	"github.com/nihestver/bebeberloga/server/internal/health"
)

// HealthReporter — то, что умеет реестр health.Registry.
type HealthReporter interface {
	Report(ctx context.Context) health.Report
}

// Handlers реализует api.StrictServerInterface.
type Handlers struct {
	health  HealthReporter
	version string
}

var _ api.StrictServerInterface = (*Handlers)(nil)

// NewHandlers собирает реализацию контракта.
func NewHandlers(h HealthReporter, version string) *Handlers {
	return &Handlers{health: h, version: version}
}

// GetHealth — `GET /health`: 200, если все настроенные зависимости доступны, иначе 503.
func (h *Handlers) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	rep := h.health.Report(ctx)
	status := http.StatusOK
	if !rep.Healthy() {
		status = http.StatusServiceUnavailable
	}
	return healthResponse{status: status, body: &bebeberlogav1.HealthStatus{
		Status:  rep.Status,
		Version: h.version,
		Checks:  rep.Checks,
	}}, nil
}

// healthResponse пишет HealthStatus как protojson (см. doc пакета).
type healthResponse struct {
	status int
	body   *bebeberlogav1.HealthStatus
}

// VisitGetHealthResponse реализует api.GetHealthResponseObject.
func (r healthResponse) VisitGetHealthResponse(w http.ResponseWriter) error {
	return WriteProto(w, r.status, r.body)
}
