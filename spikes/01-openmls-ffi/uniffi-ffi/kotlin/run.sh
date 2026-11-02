#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kotlin-привязка uniffi на JVM хоста (macOS или Linux): собрать библиотеку, сгенерировать
# привязку, скомпилировать её с Main.kt и выполнить. Нужны java и kotlinc: из PATH, из $KOTLINC или
# из ~/.local/share/kotlinc-*/kotlinc/bin (zip-архив компилятора с релизов Kotlin).
# JNA — единственная runtime-зависимость привязки; jar закреплённой версии скачивается в
# target/kotlin и проверяется по SHA-1 с Maven Central (задать JNA_JAR, чтобы взять свой).

set -euo pipefail
cd "$(dirname "$0")/.."
root=$(cd .. && pwd)
out="$root/target/kotlin"
mkdir -p "$out"

jna_version=5.14.0
jna_sha1=67bf3eaea4f0718cb376a181a629e5f88fa1c9dd
jna_jar=${JNA_JAR:-$out/jna-$jna_version.jar}
if [ ! -f "$jna_jar" ]; then
  curl -fsSL -o "$jna_jar" \
    "https://repo1.maven.org/maven2/net/java/dev/jna/jna/$jna_version/jna-$jna_version.jar"
fi
echo "$jna_sha1  $jna_jar" | shasum -a 1 -c - >/dev/null

case "$(uname -s)" in
  Darwin) lib="$root/target/release/libs1_uniffi_ffi.dylib" ;;
  *) lib="$root/target/release/libs1_uniffi_ffi.so" ;;
esac

cargo build --release -p s1-uniffi-ffi
cargo run --release -q -p s1-uniffi-ffi --bin uniffi-bindgen -- \
  generate --library "$lib" --language kotlin --out-dir generated --no-format

kotlinc=${KOTLINC:-$(command -v kotlinc || ls -d "$HOME"/.local/share/kotlinc-*/kotlinc/bin/kotlinc 2>/dev/null | tail -1)}
[ -x "$kotlinc" ] || { echo "kotlinc не найден: задай KOTLINC или поставь компилятор Kotlin"; exit 1; }
"$kotlinc" generated/uniffi/s1_uniffi_ffi/s1_uniffi_ffi.kt kotlin/Main.kt \
  -cp "$jna_jar" -include-runtime -d "$out/check.jar" 2> >(grep -v '^warning:' >&2 || true)
java --enable-native-access=ALL-UNNAMED -cp "$out/check.jar:$jna_jar" -Djna.library.path="$root/target/release" MainKt
