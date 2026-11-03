// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

// Package api — HTTP-обвязка DS спайка. Форма запросов упрощена по сравнению с
// docs/protocol/REST.md (нет аутентификации: устройство называет себя в теле), но смысл
// операций тот же. Байты — base64 в JSON, id группы в пути — hex.
package api

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/nihestver/bebeberloga/spikes/04-mls-ds/ds/internal/ds"
)

// maxBody — предел тела запроса: commit + Welcome группы в 5 000 листьев с запасом.
const maxBody = 8 << 20

// Handler возвращает маршруты DS.
func Handler(svc *ds.Service) http.Handler {
	h := &handler{svc: svc}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/external-sender", h.externalSender)
	mux.HandleFunc("POST /v1/devices/{id}/key-packages", h.uploadKeyPackages)
	mux.HandleFunc("GET /v1/devices/{id}/welcomes", h.welcomes)
	mux.HandleFunc("POST /v1/groups", h.createGroup)
	mux.HandleFunc("GET /v1/groups/{gid}", h.group)
	mux.HandleFunc("POST /v1/groups/{gid}/join", h.join)
	mux.HandleFunc("POST /v1/groups/{gid}/remove", h.remove)
	mux.HandleFunc("POST /v1/groups/{gid}/handshakes", h.submit)
	mux.HandleFunc("GET /v1/groups/{gid}/handshakes", h.handshakes)
	mux.HandleFunc("GET /v1/stats", h.stats)
	mux.HandleFunc("POST /v1/stats/reset", h.resetStats)
	return http.MaxBytesHandler(mux, maxBody)
}

type handler struct{ svc *ds.Service }

// write отдаёт JSON с Content-Length: минимальный HTTP-клиент нагрузочного теста не
// разбирает chunked-кодировку.
func write(w http.ResponseWriter, status int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "encode", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

type errorBody struct {
	Code         string `json:"code"`
	Message      string `json:"message"`
	CurrentEpoch uint64 `json:"current_epoch,omitempty"`
}

func fail(w http.ResponseWriter, err error) {
	var e *ds.Error
	if !errors.As(err, &e) {
		log.Printf("ds: внутренняя ошибка: %v", err)
		write(w, http.StatusInternalServerError, errorBody{Code: "INTERNAL", Message: "внутренняя ошибка"})
		return
	}
	status := http.StatusBadRequest
	switch e.Code {
	case ds.CodeEpochMismatch, ds.CodeProposalsMissing, ds.CodeMemberLimit, ds.CodeNoKeyPackages,
		ds.CodeAlreadyMember, ds.CodeConflict:
		status = http.StatusConflict
	case ds.CodeRemovalPending, ds.CodeNotGroupMember, ds.CodeUnauthorizedChange:
		status = http.StatusForbidden
	case ds.CodeNotFound:
		status = http.StatusNotFound
	}
	write(w, status, errorBody{Code: e.Code, Message: e.Msg, CurrentEpoch: e.CurrentEpoch})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		write(w, http.StatusBadRequest, errorBody{Code: "VALIDATION_FAILED", Message: "тело запроса"})
		return false
	}
	return true
}

func groupID(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	gid, err := hex.DecodeString(r.PathValue("gid"))
	if err != nil || len(gid) == 0 || len(gid) > 255 {
		write(w, http.StatusBadRequest, errorBody{Code: "VALIDATION_FAILED", Message: "id группы"})
		return nil, false
	}
	return gid, true
}

func waitParam(r *http.Request) time.Duration {
	ms, _ := strconv.Atoi(r.URL.Query().Get("wait_ms"))
	return time.Duration(min(max(ms, 0), 60_000)) * time.Millisecond
}

func (h *handler) externalSender(w http.ResponseWriter, _ *http.Request) {
	write(w, http.StatusOK, map[string]any{"entry": h.svc.Config().ExternalSender.Entry()})
}

func (h *handler) uploadKeyPackages(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KeyPackages [][]byte `json:"key_packages"`
	}
	if !decode(w, r, &req) {
		return
	}
	if err := h.svc.UploadKeyPackages(r.Context(), r.PathValue("id"), req.KeyPackages); err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, map[string]any{})
}

func (h *handler) welcomes(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Welcomes(r.Context(), r.PathValue("id"), waitParam(r))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, map[string]any{"welcomes": out})
}

func (h *handler) createGroup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GroupID   []byte `json:"group_id"`
		Creator   string `json:"creator_device_id"`
		LeafLimit int    `json:"leaf_limit"`
	}
	if !decode(w, r, &req) {
		return
	}
	if err := h.svc.CreateGroup(r.Context(), req.GroupID, req.Creator, req.LeafLimit); err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, map[string]any{})
}

func (h *handler) group(w http.ResponseWriter, r *http.Request) {
	gid, ok := groupID(w, r)
	if !ok {
		return
	}
	st, err := h.svc.Group(r.Context(), gid)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, st)
}

type deviceReq struct {
	DeviceID string `json:"device_id"`
}

func (h *handler) join(w http.ResponseWriter, r *http.Request) {
	gid, ok := groupID(w, r)
	var req deviceReq
	if !ok || !decode(w, r, &req) {
		return
	}
	if err := h.svc.RequestJoin(r.Context(), gid, req.DeviceID); err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusAccepted, map[string]any{})
}

func (h *handler) remove(w http.ResponseWriter, r *http.Request) {
	gid, ok := groupID(w, r)
	var req deviceReq
	if !ok || !decode(w, r, &req) {
		return
	}
	if err := h.svc.RequestRemove(r.Context(), gid, req.DeviceID); err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusAccepted, map[string]any{})
}

func (h *handler) submit(w http.ResponseWriter, r *http.Request) {
	gid, ok := groupID(w, r)
	var req struct {
		Sender  string  `json:"sender_device_id"`
		Kind    ds.Kind `json:"kind"`
		Blob    []byte  `json:"blob"`
		Welcome []byte  `json:"welcome"`
	}
	if !ok || !decode(w, r, &req) {
		return
	}
	acc, err := h.svc.SubmitHandshake(r.Context(), gid, req.Sender, req.Kind, req.Blob, req.Welcome)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, acc)
}

func (h *handler) handshakes(w http.ResponseWriter, r *http.Request) {
	gid, ok := groupID(w, r)
	if !ok {
		return
	}
	after, _ := strconv.ParseUint(r.URL.Query().Get("after_seq"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	out, err := h.svc.Handshakes(r.Context(), gid, after, limit, waitParam(r))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, map[string]any{"handshakes": out})
}

func (h *handler) stats(w http.ResponseWriter, _ *http.Request) {
	write(w, http.StatusOK, h.svc.Stats.Snapshot())
}

func (h *handler) resetStats(w http.ResponseWriter, _ *http.Request) {
	h.svc.Stats.Reset()
	write(w, http.StatusOK, map[string]any{})
}
