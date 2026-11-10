#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Сценарий Linux: scripts/linux-run.sh <wayland|x11> [тег]. Сначала пишет сведения об окружении
# (сеанс, PipeWire, портал, недостающие библиотеки), затем запускает спайк в режиме linux.
# S3_ELECTRON — путь к бинарнику electron, если он не в node_modules (перенос без npm).
set -uo pipefail
cd "$(dirname "$0")/.."
mode="${1:-wayland}"
tag="${2:-linux-$mode}"
electron="${S3_ELECTRON:-node_modules/electron/dist/electron}"
out="${S3_OUT:-$PWD/results/raw}"
mkdir -p "$out"
{
  echo "date: $(date -Is)"; uname -srm
  . /etc/os-release && echo "os: $PRETTY_NAME"
  echo "session: ${XDG_SESSION_TYPE:-} desktop: ${XDG_CURRENT_DESKTOP:-} wayland: ${WAYLAND_DISPLAY:-} x11: ${DISPLAY:-}"
  for c in pipewire wireplumber plasmashell gnome-shell; do command -v "$c" >/dev/null && echo "$c: $("$c" --version 2>&1 | tr '\n' ' ')"; done
  dpkg-query -W -f='${Package} ${Version}\n' 'xdg-desktop-portal*' 'pipewire*' 'libpipewire*' 2>/dev/null
  echo "pulse server: $(pactl info 2>/dev/null | grep -E 'Server Name' || echo 'pactl недоступен')"
  echo "userns: $(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo n/a)"
  echo "missing libs:"; ldd "$electron" | grep "not found" || echo "  нет"
  echo "electron: $("$electron" --version 2>&1 | tail -1)"
} > "$out/$tag-env.txt" 2>&1
cat "$out/$tag-env.txt"
args=()
if [ "$mode" = wayland ]; then args+=(--ozone-platform=wayland); else args+=(--ozone-platform=x11); export S3_OZONE=x11; fi
[ -n "${S3_NO_SANDBOX:-}" ] && args+=(--no-sandbox)
S3_MODE=linux S3_TAG="$tag" S3_OUT="$out" "$electron" . "${args[@]}" 2>&1 | grep -a --line-buffered -E "s3 |rror|portal|PipeWire|pipewire" | tee "$out/$tag.log"
