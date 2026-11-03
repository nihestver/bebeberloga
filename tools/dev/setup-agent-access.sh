#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
#
# Однократная настройка доступа Claude Code к стенду агента на тест-сервере (macOS).
# Создаёт отдельный ключ агента, ssh-алиас bb-claude, кладёт ключ на сервер через уже
# работающий личный ключ, создаёт docker context и проверяет сервер. Повторный запуск безопасен.
#
#   tools/dev/setup-agent-access.sh [хост] [пользователь]
#   BOOTSTRAP_KEY=~/.ssh/другой_ключ tools/dev/setup-agent-access.sh
set -euo pipefail

HOST="${1:-test.bebeberloga.org}"
REMOTE_USER="${2:-claude}"
ALIAS="bb-claude"
KEY="$HOME/.ssh/bebeberloga_claude"
BOOTSTRAP_KEY="${BOOTSTRAP_KEY:-$HOME/.ssh/id_ed25519}"
CONFIG="$HOME/.ssh/config"
BEGIN="# >>> bebeberloga: стенд агента (tools/dev/setup-agent-access.sh) >>>"
END="# <<< bebeberloga: стенд агента <<<"

say() { printf '\n==> %s\n' "$*"; }

mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
touch "$CONFIG" && chmod 600 "$CONFIG"

say "1/5 Ключ агента: $KEY"
if [ -f "$KEY" ]; then
  echo "уже есть"
else
  echo "Задай пароль ключа (macOS запомнит его в связке ключей) или оставь пустым."
  ssh-keygen -t ed25519 -a 100 -f "$KEY" -C "claude-code@bebeberloga $(hostname -s)"
fi
if [ "$(uname -s)" = Darwin ]; then
  /usr/bin/ssh-add --apple-use-keychain "$KEY" || echo "предупреждение: ssh-add не сработал"
fi

say "2/5 Алиас $ALIAS в $CONFIG"
BLOCK="$BEGIN
Host $ALIAS
  HostName $HOST
  User $REMOTE_USER
  IdentityFile $KEY
  IdentitiesOnly yes
  IgnoreUnknown UseKeychain
  UseKeychain yes
  AddKeysToAgent yes
  StrictHostKeyChecking accept-new
  ServerAliveInterval 30
  ControlMaster auto
  ControlPath ~/.ssh/cm-%C
  ControlPersist 10m
$END"
[ -f "$CONFIG.bak.bebeberloga" ] || cp "$CONFIG" "$CONFIG.bak.bebeberloga"
TMP="$(mktemp)"
# старый блок убираем, новый ставим в начало файла (в ssh_config побеждает первое значение)
awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$CONFIG" | sed '/./,$!d' > "$TMP.rest"
{ printf '%s\n\n' "$BLOCK"; cat "$TMP.rest"; } > "$TMP"
cat "$TMP" > "$CONFIG"
rm -f "$TMP" "$TMP.rest"
echo "ok (резервная копия: $CONFIG.bak.bebeberloga)"

say "3/5 Ключ агента на сервере ($REMOTE_USER@$HOST)"
if ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" true 2>/dev/null; then
  echo "уже работает"
else
  if [ ! -f "$BOOTSTRAP_KEY" ]; then
    echo "Нет $BOOTSTRAP_KEY. Добавь на сервере в ~$REMOTE_USER/.ssh/authorized_keys строку:"
    cat "$KEY.pub"
    exit 1
  fi
  PUB="$(cat "$KEY.pub")"
  ssh -i "$BOOTSTRAP_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
      -o ControlMaster=no -o ControlPath=none "$REMOTE_USER@$HOST" \
      "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '$PUB' ~/.ssh/authorized_keys || echo '$PUB' >> ~/.ssh/authorized_keys"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" true
  echo "ok"
fi
echo "Отпечаток ключа сервера — сверь с 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub' на сервере:"
ssh-keygen -F "$HOST" -l 2>/dev/null | grep -v '^#' || true

say "4/5 docker context $ALIAS"
if command -v docker >/dev/null 2>&1; then
  if docker context inspect "$ALIAS" >/dev/null 2>&1; then
    echo "уже есть"
  else
    docker context create "$ALIAS" --description "Bebeberloga: стенд агента" --docker "host=ssh://$ALIAS"
  fi
else
  echo "skip: docker CLI не установлен"
fi

say "5/5 Проверка сервера"
ssh "$ALIAS" 'printf "host: %s, cpu: %s\n" "$(hostname)" "$(nproc)"
docker info >/dev/null 2>&1 && echo "docker: ok" || echo "docker: нет доступа (claude не в группе docker?)"
test -x ~/.local/bin/mise && echo "mise: ok" || echo "mise: не установлен"
command -v rsync >/dev/null && echo "rsync: ok" || echo "rsync: не установлен"
test -d ~/src && echo "~/src: ok" || echo "~/src: нет"'

say "Готово. Дальше: just remote-setup && just remote-check"
echo "Агенту личный ключ ($BOOTSTRAP_KEY) больше не нужен — его строку можно убрать из ~$REMOTE_USER/.ssh/authorized_keys на сервере."
