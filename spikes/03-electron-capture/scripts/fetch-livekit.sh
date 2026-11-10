#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Кладёт livekit-server в bin/ (каталог не под git). Docker не нужен.
#   Linux — архив релиза с GitHub, сверка SHA-256 по checksums.txt того же релиза.
#   macOS — релизных сборок под macOS у LiveKit нет: берётся бутылка Homebrew (brew fetch проверяет
#           её SHA-256 по формуле) и распаковывается в bin/, без установки в систему.
set -euo pipefail

VERSION="${LIVEKIT_VERSION:-1.13.11}"
cd "$(dirname "$0")/.."
mkdir -p bin
if [ -x bin/livekit-server ] && bin/livekit-server --version 2>/dev/null | grep -q "$VERSION"; then
  echo "bin/livekit-server $VERSION уже на месте"; exit 0
fi
tmp="$(mktemp -d)"; trap 'rm -r "$tmp"' EXIT

case "$(uname -s)" in
  Linux)
    case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "неизвестная архитектура"; exit 1 ;; esac
    base="https://github.com/livekit/livekit/releases/download/v$VERSION"
    file="livekit_${VERSION}_linux_${arch}.tar.gz"
    curl -fsSL -o "$tmp/$file" "$base/$file"
    curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
    (cd "$tmp" && grep " $file\$" checksums.txt | sha256sum -c -)
    tar -xzf "$tmp/$file" -C "$tmp"
    ;;
  Darwin)
    command -v brew >/dev/null || { echo "нужен Homebrew (или собери сам: go install github.com/livekit/livekit-server/cmd/server@v$VERSION)"; exit 1; }
    brew fetch --quiet livekit
    bottle="$(brew --cache livekit)"
    tar -xzf "$bottle" -C "$tmp"
    cp "$tmp"/livekit/*/bin/livekit-server "$tmp/livekit-server"
    ;;
  *) echo "ОС не поддержана скриптом"; exit 1 ;;
esac
install -m 0755 "$tmp/livekit-server" bin/livekit-server
bin/livekit-server --version
