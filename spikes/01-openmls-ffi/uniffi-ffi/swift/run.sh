#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Собрать Swift-привязку uniffi вместе с main.swift на macOS-хосте и выполнить.
# Ожидает target/release/libs1_uniffi_ffi.dylib и uniffi-ffi/generated (см. `just bindings`).

set -euo pipefail
cd "$(dirname "$0")/.."
root=$(cd .. && pwd)
mkdir -p "$root/target/swift"

swiftc -O \
  -Xcc -fmodule-map-file=generated/s1_uniffi_ffiFFI.modulemap \
  -I generated \
  generated/s1_uniffi_ffi.swift swift/main.swift \
  -L "$root/target/release" -ls1_uniffi_ffi \
  -o "$root/target/swift/check"

DYLD_LIBRARY_PATH="$root/target/release" "$root/target/swift/check"
