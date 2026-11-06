// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package httpapi собирает HTTP-сервер: маршрутизатор chi, middleware и реализацию
// сгенерированного интерфейса api.StrictServerInterface (gen/api, из docs/protocol/openapi.yaml).
//
// Тела ответов — protojson по ADR-0017 п. 3 (UseProtoNames, EmitDefaultValues). Сгенерированные
// типы ответов oapi-codegen кодируют encoding/json, поэтому обработчики возвращают собственные
// типы, реализующие интерфейсы `*ResponseObject`, и пишут тело через WriteProto.
package httpapi

import (
	"fmt"
	"net/http"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	bebeberlogav1 "github.com/nihestver/bebeberloga/server/gen/bebeberloga/v1"
)

// Marshal — единственная JSON-форма протокола (ADR-0017 п. 3).
var Marshal = protojson.MarshalOptions{
	UseProtoNames:     true,
	EmitDefaultValues: true,
}

// WriteProto пишет сообщение Protobuf в ответ с указанным статусом.
func WriteProto(w http.ResponseWriter, status int, msg proto.Message) error {
	body, err := Marshal.Marshal(msg)
	if err != nil {
		return fmt.Errorf("protojson: %w", err)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, err = w.Write(body)
	return err
}

// WriteError пишет ошибку протокола (REST.md «Ошибки»). message — служебное описание
// для журналов, не для пользователя; подробности о внутреннем состоянии в него не попадают.
func WriteError(w http.ResponseWriter, status int, code bebeberlogav1.ErrorCode, message string) {
	// Ошибку записи тела ошибки некуда возвращать: соединение уже потеряно.
	_ = WriteProto(w, status, &bebeberlogav1.Error{Code: code, Message: message})
}
