// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package server — корень модуля; здесь только директивы генерации (`just gen`).
//
// Контракт REST — docs/protocol/openapi.yaml: его правят руками, обработчики генерируются.
// Модели Protobuf (server/gen/bebeberloga/v1) создаёт `buf generate` из корня репозитория.
package server

//go:generate go tool oapi-codegen -config oapi-codegen.yaml ../docs/protocol/openapi.yaml
