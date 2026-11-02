#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Собрать библиотеку для хоста (Linux x86_64 в dev-контейнере), сгенерировать Kotlin-привязку,
# скомпилировать её с Main.kt и выполнить на JVM. Нужны kotlinc, java, JNA и kotlinx-coroutines
# (в dev-контейнере — /opt/jars; иначе задать CLASSPATH).

set -euo pipefail
cd "$(dirname "$0")/.."
root=$(cd .. && pwd)
lib="$root/target/release/libs1_uniffi_ffi.so"
cp=${CLASSPATH:-/opt/jars/jna.jar:/opt/jars/kotlinx-coroutines-core-jvm.jar}

cargo build --release -p s1-uniffi-ffi
cargo run --release -q -p s1-uniffi-ffi --bin uniffi-bindgen -- \
  generate --library "$lib" --language kotlin --out-dir generated --no-format

mkdir -p "$root/target/kotlin"
kotlinc generated/uniffi/s1_uniffi_ffi/s1_uniffi_ffi.kt kotlin/Main.kt \
  -cp "$cp" -d "$root/target/kotlin/check.jar"
java -cp "$root/target/kotlin/check.jar:$cp" -Djna.library.path="$root/target/release" MainKt
