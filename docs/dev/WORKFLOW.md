# Процесс разработки и CI/CD

Пошаговая настройка окружения, в котором Claude Code делает большую часть работы, а проверки (линтеры, тесты, clean-room-фильтр, деплой на тест-сервер) выполняются автоматически. Среда: macOS + VS Code с расширением Claude Code, тест-сервер по SSH, подписка Claude Max.

Проверено по документации Claude Code на 2026-11-02: [hooks](https://code.claude.com/docs/en/hooks-guide), [permissions](https://code.claude.com/docs/en/permissions), [subagents](https://code.claude.com/docs/en/sub-agents), [skills](https://code.claude.com/docs/en/skills), [GitHub Actions](https://code.claude.com/docs/en/github-actions), [best practices](https://code.claude.com/docs/en/best-practices).

## Принципы

1. **Одна команда на действие.** Всё, что агент должен уметь запускать, — рецепты `just`: `just test`, `just lint`, `just deploy-test`. Агент не угадывает флаги, CI вызывает те же рецепты.
2. **Проверка за агентом автоматическая.** Форматирование и clean-room-фильтр — в hooks Claude Code; линтеры, тесты, лицензии — в CI. CLAUDE.md только советует, hooks и CI гарантируют.
3. **Контекст сессии — ресурс.** Одна задача (один промпт B) = одна сессия; `/clear` между задачами; исследование и ревью — субагентами, чтобы не засорять основной контекст.
4. **Тест-сервер — копия прода.** Тот же Docker Compose, что получат администраторы инстансов; деплой на него — из CI после merge в `main`.
5. **Секреты не живут в репозитории.** `.env` файлы — только в `.gitignore` и в GitHub Secrets; Claude Code не читает их (deny-правило).

## Шаг 1. Инструменты на macOS

```bash
brew install git gh jq just lefthook mise colima docker docker-compose hurl buf \
             golangci-lint protobuf
brew install --cask bruno            # FOSS-аналог Postman с коллекциями в git; Postman тоже подойдёт
```

- **mise** — версии Go, Rust, Node закрепляются в `mise.toml` в корне, чтобы у агента, у тебя и в CI были одинаковые версии.
- **colima** — FOSS-рантайм Docker на macOS (альтернатива Docker Desktop). `colima start --cpu 4 --memory 8`.
- **just** — единая точка входа для команд. **lefthook** — быстрые git-хуки (pre-commit, commit-msg).
- **hurl** — HTTP-тесты в текстовых файлах: их одинаково запускают агент, ты и CI.
- **buf** — линт, форматирование и проверка совместимости Protobuf.

Расширения VS Code: Claude Code (уже есть), Go, rust-analyzer, ESLint, Prettier, Even Better TOML, Proto (Buf).

`mise.toml`:

```toml
[tools]
go = "1.23"
rust = "stable"
node = "22"
pnpm = "9"
```

После `mise install` в корне репозитория версии подхватываются автоматически (добавь `eval "$(mise activate zsh)"` в `~/.zshrc`).

## Шаг 2. Репозиторий

```bash
cd ~/dev/bebeberloga
git init -b main
gh repo create bebeberloga/bebeberloga --public --source=. --remote=origin   # или личный аккаунт
```

Файлы, которые нужны в первом коммите:

| Файл | Зачем |
|---|---|
| `.gitignore` | `node_modules/`, `target/`, `dist/`, `.env*`, `*.pem`, `.claude/settings.local.json` |
| `.editorconfig` | единые отступы и переводы строк |
| `LICENSE`, `clients/LICENSE-EXCEPTION`, `LICENSES/` | по `LICENSING.md` |
| `mise.toml`, `justfile`, `lefthook.yml` | инструменты, команды, git-хуки |
| `.github/CODEOWNERS`, `.github/pull_request_template.md` | владелец `crypto-core/` и `server/internal/mls/` — ты; шаблон PR с чеклистом clean room |
| `CLAUDE.md`, `.claude/` | уже есть / шаг 3 |

Соглашения: Conventional Commits, подпись DCO (`git commit -s`), squash-merge в `main`, ветки `feat/<модуль>-<что>`, `fix/…`, `spike/<номер>`. Защита `main`: обязательные проверки CI, запрет прямых push.

`lefthook.yml` (быстрые проверки до коммита; полные — в CI):

```yaml
pre-commit:
  parallel: true
  commands:
    go-fmt:
      glob: "*.go"
      run: gofmt -l {staged_files} | tee /dev/stderr | test -z "$(cat)"
    rust-fmt:
      glob: "*.rs"
      run: rustfmt --check {staged_files}
    prettier:
      glob: "*.{ts,tsx,css,json,md,yml,yaml}"
      run: pnpm exec prettier --check {staged_files}
    cleanroom:
      run: .claude/hooks/cleanroom-guard.sh --files {staged_files}
commit-msg:
  commands:
    conventional:
      run: grep -Eq '^(feat|fix|docs|chore|refactor|test|perf|build|ci)(\(.+\))?!?: ' {1}
    dco:
      run: grep -q '^Signed-off-by: ' {1}
```

`justfile` (каркас; рецепты появляются вместе с модулями):

```just
set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

# --- проверки ---
check: lint test
lint: lint-go lint-rust lint-web lint-proto lint-licenses cleanroom
test: test-go test-rust test-web

lint-go:        cd server && golangci-lint run ./...
lint-rust:      cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check
lint-web:       cd clients/web && pnpm lint && pnpm typecheck
lint-proto:     buf lint && buf breaking --against '.git#branch=main'
lint-licenses:  cargo deny check && (cd server && go-licenses check ./...) && reuse lint
cleanroom:      .claude/hooks/cleanroom-guard.sh --all

test-go:        cd server && go test -race ./...
test-rust:      cargo test --workspace
test-web:       cd clients/web && pnpm test

# --- локальная среда ---
dev-up:         docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/compose.dev.yml up -d
dev-down:       docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/compose.dev.yml down
dev-server:     cd server && air            # hot reload Go-сервера против инфраструктуры из compose
dev-web:        cd clients/web && pnpm dev
dev-desktop:    cd clients/desktop && pnpm dev

# --- кодогенерация ---
gen:            buf generate && (cd server && sqlc generate) && just openapi
openapi:        cd server && go run ./cmd/openapi > ../docs/protocol/openapi.yaml

# --- тест-сервер ---
deploy-test:    ssh bb-test 'cd ~/bebeberloga && docker compose pull && docker compose up -d --remove-orphans && docker compose ps'
smoke-test:     hurl --test --variable base_url=https://test.bebeberloga.org tools/api/smoke/*.hurl
test-logs svc="server":  ssh bb-test "cd ~/bebeberloga && docker compose logs --tail=200 {{svc}}"
```

## Шаг 3. Claude Code: настройка проекта

Все файлы ниже коммитятся в репозиторий — они часть процесса, а не личные настройки. Личные дополнения (например, разрешения, которые ты одобрил «навсегда») Claude Code пишет в `.claude/settings.local.json`, он в `.gitignore`.

### 3.1 Разрешения и hooks — `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(just *)",
      "Bash(go *)", "Bash(cargo *)", "Bash(pnpm *)", "Bash(npx *)", "Bash(buf *)", "Bash(hurl *)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git add *)",
      "Bash(git commit *)", "Bash(git switch *)", "Bash(git worktree *)",
      "Bash(docker compose *)",
      "Bash(gh pr view *)", "Bash(gh pr create *)", "Bash(gh issue *)", "Bash(gh run *)",
      "WebFetch(domain:docs.rs)", "WebFetch(domain:pkg.go.dev)", "WebFetch(domain:book.openmls.tech)",
      "WebFetch(domain:docs.livekit.io)", "WebFetch(domain:www.rfc-editor.org)",
      "WebFetch(domain:learn.microsoft.com)", "WebFetch(domain:developer.apple.com)",
      "WebFetch(domain:docs.pipewire.org)"
    ],
    "ask": [
      "Bash(ssh *)", "Bash(git push *)", "Bash(gh pr merge *)", "Bash(docker compose down *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Read(./.env)", "Read(./.env.*)", "Read(./deploy/**/.env*)", "Read(./**/*.pem)", "Read(./**/*.key)",
      "WebFetch(domain:discord.com)", "WebFetch(domain:support.discord.com)", "WebFetch(domain:discord.dev)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/cleanroom-guard.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/format.sh" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [{ "type": "command", "command": "echo 'После сжатия контекста: перечитай CLAUDE.md и STATUS.md текущего модуля; список изменённых файлов — git status.'" }]
      }
    ]
  }
}
```

Как это работает: `allow` убирает подтверждения для безопасных команд, `ask` оставляет подтверждение для всего, что уходит наружу (SSH, push, merge), `deny` закрывает секреты и сайты оригинала. Hook `PreToolUse` блокирует запись файла с запрещёнными словами до того, как она произойдёт; `PostToolUse` форматирует каждый изменённый файл.

Режим разрешений для сессий: в VS Code оставь режим по умолчанию (auto — классификатор пропускает рутину, спрашивает про рискованное) и переключайся в **plan mode** (`Shift+Tab`) на старте каждого промпта B.

### 3.2 Clean-room-фильтр — `.claude/hooks/cleanroom-guard.sh`

```bash
#!/usr/bin/env bash
# Блокирует запись файлов с запрещёнными словами (docs/spec/GLOSSARY.md) в каталогах кода.
# Режимы: без аргументов — hook PreToolUse (путь из stdin JSON); --files <...> — lefthook; --all — CI.
set -euo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
PATTERN='discord|\bguild\b|snowflake|\bnitro\b|\bclyde\b|wumpus|\bnelly\b|go live|\bdave\b|libdave|krisp'
CODE_DIRS='^(server|crypto-core|media-engine|clients|proto|sdk|design|deploy|tools)/'

check_content() {  # $1 = путь (для сообщения), stdin = содержимое
  if grep -Eiq "$PATTERN" ; then
    echo "clean-room: в $1 есть слово из запретного списка (docs/spec/GLOSSARY.md). Переименуй по глоссарию." >&2
    return 1
  fi
}

case "${1:-}" in
  --all)
    rc=0
    while IFS= read -r f; do check_content "$f" < "$ROOT/$f" || rc=2; done \
      < <(cd "$ROOT" && git ls-files | grep -E "$CODE_DIRS" || true)
    exit $rc ;;
  --files)
    shift; rc=0
    for f in "$@"; do
      rel="${f#"$ROOT"/}"; [[ "$rel" =~ $CODE_DIRS ]] || continue
      check_content "$rel" < "$f" || rc=2
    done
    exit $rc ;;
  *)
    INPUT=$(cat)
    FILE=$(jq -r '.tool_input.file_path // empty' <<<"$INPUT")
    [[ -z "$FILE" ]] && exit 0
    REL="${FILE#"$ROOT"/}"
    [[ "$REL" =~ $CODE_DIRS ]] || exit 0
    # Для Write содержимое целиком, для Edit — только новая строка.
    CONTENT=$(jq -r '.tool_input.content // .tool_input.new_string // empty' <<<"$INPUT")
    check_content "$REL" <<<"$CONTENT" || exit 2
    exit 0 ;;
esac
```

### 3.3 Форматирование — `.claude/hooks/format.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
FILE=$(jq -r '.tool_input.file_path // empty')
[[ -f "$FILE" ]] || exit 0
case "$FILE" in
  *.go)                       gofmt -w "$FILE" ;;
  *.rs)                       rustfmt --edition 2021 "$FILE" ;;
  *.ts|*.tsx|*.css|*.json|*.md|*.yml|*.yaml) pnpm exec prettier --write "$FILE" >/dev/null 2>&1 || true ;;
  *.proto)                    buf format -w "$FILE" ;;
esac
```

`chmod +x .claude/hooks/*.sh` — hooks должны быть исполняемыми.

### 3.4 Субагенты — `.claude/agents/`

`cleanroom-reviewer.md` — независимое ревью по чеклисту (контекст чистый, кода он не писал):

```markdown
---
name: cleanroom-reviewer
description: Проверяет модуль на заимствования и соответствие спецификации по docs/cleanroom/REVIEW-CHECKLIST.md. Запускать перед тем, как считать модуль готовым.
tools: Read, Grep, Glob, Bash(git diff *), Bash(git log *)
model: opus
---
Ты независимый ревьюер, не участвовавший в написании кода. Прочитай docs/cleanroom/REVIEW-CHECKLIST.md и docs/spec/GLOSSARY.md, затем проверь diff текущей ветки относительно main ($ARGUMENTS — путь модуля, если указан).
Для каждого пункта чеклиста выдай pass или нарушение с файлом и строкой. Отмечай только то, что влияет на clean room, соответствие спецификации или инварианты E2EE; стилистику не комментируй. Исправлений не предлагай.
```

`security-reviewer.md` — для `crypto-core/`, `server/internal/mls/`, `media-engine/`:

```markdown
---
name: security-reviewer
description: Ревью безопасности изменений в crypto-core, MLS Delivery Service и media-engine. Запускать на каждый PR в эти каталоги.
tools: Read, Grep, Glob, Bash(git diff *), Bash(cargo *), Bash(go test *)
model: opus
---
Ты инженер по безопасности. Проверь diff против инвариантов E2EE из CLAUDE.md и docs/protocol/CRYPTO.md: ключи никогда не покидают клиент; сервер видит только шифртекст; epoch/generation защищают от повторов; ключи в памяти обнуляются (zeroize); нет логирования секретов; парсеры конвертов защищены от некорректного ввода. Проверь, что SECURITY-CHANGELOG.md модуля обновлён. Сообщай конкретные строки и сценарий эксплуатации.
```

`spec-analyst.md` — контур A (не видит `CLAUDE.md` контура B и пишет только в `docs/spec/`):

```markdown
---
name: spec-analyst
description: Контур A clean room — пишет и уточняет функциональную спецификацию в docs/spec/ своими словами. Не пишет код.
tools: Read, Write, Edit, Glob, Grep
omitClaudeMd: true
model: opus
---
Ты аналитик контура A. Твой выход — файлы в docs/spec/ по docs/cleanroom/POLICY.md: наблюдаемое поведение функций, потоки, экраны, права — своими словами, без текстов интерфейса, названий и визуальных деталей сторонних продуктов. В docs/spec/ нельзя упоминать названия сторонних продуктов. Задача: $ARGUMENTS.
```

### 3.5 Скиллы (slash-команды) — `.claude/skills/<имя>/SKILL.md`

`/module <номер> <каталог>` — запуск промпта B по шаблону:

```markdown
---
name: module
description: Выполнить промпт контура B из docs/prompts/README.md по шаблону docs/prompts/TEMPLATE-B.md
disable-model-invocation: true
argument-hint: "<B-номер> <каталог модуля>"
---
Выполни промпт $0 из таблицы docs/prompts/README.md для модуля $1.
1. Прочитай строку промпта $0 (вход, выход), docs/prompts/TEMPLATE-B.md, ADR и файлы спецификации, указанные во «Входе», и $1/STATUS.md, если он есть.
2. Составь план до 10 пунктов и список открытых вопросов. Остановись и покажи их — до кода.
3. После одобрения реализуй, запуская `just test` и `just lint` по ходу. Открытые вопросы к спецификации записывай в docs/spec/OPEN-QUESTIONS.md.
4. В конце обнови $1/STATUS.md, docs/protocol/ при изменении контракта, и запусти субагент cleanroom-reviewer на $1.
```

`/review-cleanroom <каталог>`:

```markdown
---
name: review-cleanroom
description: Независимое clean-room ревью модуля субагентом
disable-model-invocation: true
---
Запусти субагент cleanroom-reviewer для $ARGUMENTS и приведи его находки списком. Ничего не исправляй до моего решения.
```

`/deploy-test`:

```markdown
---
name: deploy-test
description: Выкатить текущий main на тест-сервер и прогнать smoke-тесты
disable-model-invocation: true
allowed-tools: Bash(just deploy-test), Bash(just smoke-test), Bash(just test-logs *)
---
Выполни `just deploy-test`, затем `just smoke-test`. Если smoke-тесты падают — покажи `just test-logs server` и предложи причину, но ничего не меняй на сервере.
```

### 3.6 CLAUDE.md по каталогам

Корневой `CLAUDE.md` уже есть. Когда появятся модули, добавь короткие `server/CLAUDE.md`, `crypto-core/CLAUDE.md`, `clients/web/CLAUDE.md` — только то, что не выводится из кода: команды модуля, инварианты, запреты. Проверка: `/context` показывает, что загружено; `/doctor` предлагает, что сократить. Если Claude игнорирует правило — файл слишком длинный, а не правило слабое.

### 3.7 Проверка настройки

1. Открой папку в VS Code, запусти Claude Code, выполни `/hooks` — должны быть видны три hook-а.
2. Попроси: «создай файл server/internal/tmp.go с комментарием про guild» — hook должен заблокировать запись и объяснить почему.
3. Попроси: «добавь в README строку с лишними пробелами в конце» — после записи форматирование сработает автоматически.
4. `/agents` — три субагента в списке.

## Шаг 4. Локальная среда

`deploy/compose/docker-compose.yml` — тот же файл, что получат администраторы инстансов: `server`, `postgres:16`, `valkey:8`, `nats:2 -js`, `minio` (или `garage`), `livekit/livekit-server`, `coturn`, `caddy`. `compose.dev.yml` переопределяет: порты наружу, `server` выключен (его запускаешь через `just dev-server` с hot reload `air`), MinIO-консоль, `LIVEKIT_KEYS=devkey: secret`.

Цикл: `just dev-up` → `just dev-server` в одном терминале → `just dev-web` в другом → Electron-оболочка `just dev-desktop` подключается к локальному Vite. Переменные — в `.env.example` (коммитится) и `.env` (нет).

Для стрима и голоса локально нужен TURN только при тестировании через интернет; в локальной сети LiveKit работает напрямую.

## Шаг 5. Тест-сервер по SSH

На сервере (Debian/Ubuntu, работа от root):

```bash
apt update && apt install -y docker.io docker-compose-v2 ufw fail2ban
systemctl enable --now docker
ufw allow 22,80,443/tcp && ufw allow 7881/tcp && ufw allow 3478/udp && ufw allow 50000:60000/udp && ufw enable
useradd -m -s /bin/bash deploy && usermod -aG docker deploy
mkdir -p /home/deploy/bebeberloga && chown deploy:deploy /home/deploy/bebeberloga
```

Порты: 7881/tcp и 50000–60000/udp — LiveKit, 3478/udp — coturn; точный набор уточняется в B7. TLS выдаёт Caddy автоматически. DNS уже настроен в Cloudflare: `test.bebeberloga.org` и `turn.test.bebeberloga.org` → `132.243.195.177`, обе записи DNS only (серая тучка): прокси Cloudflare не пропускает UDP-медиа LiveKit/TURN, а сертификаты выдаёт сам Caddy. Корень `bebeberloga.org` и `www` свободны под лендинг (там прокси уместен).

На Mac, `~/.ssh/config`:

```
Host bb-test
  HostName test.bebeberloga.org
  User deploy
  IdentityFile ~/.ssh/bebeberloga_test
  IdentitiesOnly yes
```

Деплой-пользователь `deploy` получает в `~/bebeberloga/`: `docker-compose.yml`, `.env` (с секретами, вручную один раз), `Caddyfile`. Образ сервера приходит из GHCR (его собирает CI, шаг 6); `just deploy-test` делает `pull` + `up -d`. Для разового ручного деплоя без CI: `ssh bb-test 'cd ~/bebeberloga && git pull && docker compose up -d --build'`.

Для CI создаётся отдельный ключ: `ssh-keygen -t ed25519 -f ~/.ssh/bebeberloga_ci -C ci` → публичная часть в `~deploy/.ssh/authorized_keys` на сервере, приватная — в GitHub Secret `TEST_SSH_KEY`, вывод `ssh-keyscan <ip>` — в `TEST_KNOWN_HOSTS`.

Доступ агента: `ssh` стоит в `ask`, поэтому Claude Code спрашивает перед каждой SSH-командой, кроме тех, что внутри `just deploy-test`, `just smoke-test`, `just test-logs` (они в `allow` через `Bash(just *)`). Этого достаточно для цикла «выкатил — проверил — посмотрел логи»; произвольные команды на сервере агент не выполняет без твоего подтверждения.

## Шаг 6. CI/CD в GitHub Actions

Публичный репозиторий — Actions бесплатны. Если захочешь полностью FOSS-пайплайн, те же `just`-рецепты переносятся в Woodpecker CI на тест-сервере; пока это лишняя сущность.

### 6.1 `ci.yml` — на каждый PR и push в `main`

Задания запускаются только для затронутых каталогов (`dorny/paths-filter`), чтобы правка в `crypto-core/` не гоняла тесты Electron:

| Job | Что делает | Где |
|---|---|---|
| `go` | `just lint-go test-go` с сервисами postgres/valkey/nats/minio (`services:`) | ubuntu |
| `rust` | `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `cargo deny` | ubuntu, macos, windows (crypto-core и media-engine должны собираться на трёх ОС) |
| `web` | `pnpm lint typecheck test` | ubuntu |
| `proto` | `buf lint`, `buf breaking --against main` | ubuntu |
| `cleanroom` | `.claude/hooks/cleanroom-guard.sh --all`, `reuse lint` | ubuntu |
| `docs` | markdownlint, проверка ссылок | ubuntu |

Каркас:

```yaml
name: ci
on:
  pull_request:
  push: { branches: [main] }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs: { go: ${{ steps.f.outputs.go }}, rust: ${{ steps.f.outputs.rust }}, web: ${{ steps.f.outputs.web }}, proto: ${{ steps.f.outputs.proto }} }
    steps:
      - uses: actions/checkout@v4
      - id: f
        uses: dorny/paths-filter@v3
        with:
          filters: |
            go: ['server/**', 'proto/**']
            rust: ['crypto-core/**', 'media-engine/**', 'Cargo.*']
            web: ['clients/**', 'design/**', 'proto/**']
            proto: ['proto/**']
  cleanroom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: .claude/hooks/cleanroom-guard.sh --all
      - uses: fsfe/reuse-action@v5
  go:
    needs: changes
    if: needs.changes.outputs.go == 'true'
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: test }, ports: ['5432:5432'] }
      valkey:   { image: valkey/valkey:8, ports: ['6379:6379'] }
      nats:     { image: nats:2, ports: ['4222:4222'], options: --js }
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2
      - run: just lint-go test-go
  rust:
    needs: changes
    if: needs.changes.outputs.rust == 'true'
    strategy: { matrix: { os: [ubuntu-latest, macos-latest, windows-latest] } }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
  web:
    needs: changes
    if: needs.changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2
      - run: cd clients/web && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test
```

### 6.2 `deploy-test.yml` — после merge в `main`

Собирает образ сервера, кладёт в GHCR, выкатывает на тест-сервер и гоняет smoke-тесты:

```yaml
name: deploy-test
on:
  workflow_run: { workflows: [ci], branches: [main], types: [completed] }
jobs:
  build-and-deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    environment: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: server/Dockerfile
          push: true
          tags: ghcr.io/${{ github.repository }}/server:main,ghcr.io/${{ github.repository }}/server:${{ github.sha }}
      - name: deploy
        env: { KEY: ${{ secrets.TEST_SSH_KEY }}, KNOWN: ${{ secrets.TEST_KNOWN_HOSTS }}, HOST: ${{ secrets.TEST_SSH_HOST }} }
        run: |
          install -m 600 /dev/null key && printf '%s' "$KEY" > key
          printf '%s' "$KNOWN" > known_hosts
          ssh -i key -o UserKnownHostsFile=known_hosts deploy@"$HOST" \
            'cd ~/bebeberloga && docker compose pull && docker compose up -d --remove-orphans'
      - name: smoke
        run: |
          curl -sSL https://github.com/Orange-OpenSource/hurl/releases/latest/download/hurl-x86_64-unknown-linux-gnu.tar.gz | tar xz --strip-components=2 -C /usr/local/bin --wildcards '*/bin/hurl'
          hurl --test --retry 10 --variable base_url=https://test.bebeberloga.org tools/api/smoke/*.hurl
```

### 6.3 `release.yml` — на тег `v*`

`goreleaser` для сервера (бинарники, deb, образ), `cargo-dist` для crypto-core/media-engine, `electron-builder` в матрице трёх ОС для desktop (появится в фазе 3), SBOM (CycloneDX) и подпись `cosign`. Добавляется, когда есть что релизить — не раньше фазы 1.

### 6.4 `claude.yml` — Claude в PR

Claude Code GitHub Action работает с подпиской Max через OAuth-токен: локально `claude setup-token`, результат — в секрет `CLAUDE_CODE_OAUTH_TOKEN`. Быстрый путь: в Claude Code выполнить `/install-github-app`, выбрать токен подписки и workflow-файлы — он сам создаст PR. Два применения:

- `@claude` в комментариях к issue и PR — починить, объяснить, доделать;
- автоматическое ревью каждого PR (пример `claude-code-review.yml` из установщика).

Ограничь расход: `claude_args: "--max-turns 15"`, `concurrency` на PR, `timeout-minutes: 20`. На pull request из форков секреты недоступны — ревью работает только для веток в репозитории.

### 6.5 Защита ветки

Settings → Branches → `main`: require PR, required checks `cleanroom`, `go`, `rust`, `web`; squash merge; linear history. DCO проверяется lefthook-ом локально и, если хочешь, приложением DCO на GitHub.

## Шаг 7. Тестирование API

| Инструмент | Для чего | Где лежит |
|---|---|---|
| **hurl** | Автотесты REST: smoke после деплоя, сценарии «регистрация → логин → создать сообщество → инвайт» | `tools/api/smoke/*.hurl`, `tools/api/scenarios/*.hurl`; их запускает агент (`just smoke-test`) и CI |
| **Bruno** (или Postman) | Ручная наглядная отладка; коллекция импортируется из OpenAPI | `tools/api/bruno/` — коллекция в git; Postman — импорт `docs/protocol/openapi.yaml` |
| **websocat** | Ручная отладка gateway в JSON-режиме | `brew install websocat` |
| **buf curl** | Запросы к Connect-RPC по Protobuf-схемам | — |

OpenAPI генерируется из кода (`just openapi`) и коммитится в `docs/protocol/openapi.yaml` — PR с несовместимым изменением виден в diff. Postman подходит для ручной работы; для агента важны именно hurl-файлы — он их пишет, запускает и читает результат сам.

Пример `tools/api/smoke/health.hurl`:

```
GET {{base_url}}/api/v1/health
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"
jsonpath "$.version" exists
```

## Шаг 8. Порядок работ в фазе 0

| Неделя | Что | Как |
|---|---|---|
| 1 | Шаги 1–4; первый коммит; контур A: A5 (глоссарий — уже есть черновик), A1, A2, A4, A3 | Каждый промпт A — отдельная сессия с субагентом `spec-analyst` или отдельный чат; результат — PR в `docs/spec/`; запись в `cleanroom/LOG.md` |
| 2 | Шаги 5–6: тест-сервер, CI, `claude.yml`; промпты B1 (proto, gateway, REST) и B2 (`CRYPTO.md`) | B1 и B2 — plan mode, результат — контракты, без реализации |
| 3–4 | Спайки 1, 2, 4 (OpenMLS FFI, LiveKit E2EE, MLS Delivery Service) | Каждый спайк — каталог `spikes/NN-<имя>/` с `REPORT.md`; результат спайка фиксируется в ADR |
| 5–6 | Спайки 3, 5, 6 (Electron-захват, звук приложения на трёх ОС, E2EE-стрим 1080p60) | Спайки 5–6 требуют реального железа: Mac — у тебя, Windows с NVIDIA/AMD/Intel — найти или арендовать; Linux — тест-сервер с GPU не нужен, достаточно ноутбука с PipeWire |
| 7–8 | B8 (дизайн-система из `BRAND.md`), `Dockerfile` сервера, `deploy/compose/`, первый `deploy-test` с заглушкой `/health` | Ворота фазы 0: спецификация принята, шесть спайков с отчётами, CI зелёный, деплой на тест-сервер работает |

## Шаг 9. Ежедневный цикл

1. Issue на GitHub (или строка в `docs/prompts/README.md`) → ветка `feat/<модуль>-<что>`.
2. В VS Code: новая сессия Claude Code, `/rename <модуль>`, `Shift+Tab` → plan mode, `/module B5 server/internal/mls`.
3. План одобрен → реализация; агент сам гоняет `just test`, `just lint`; hooks форматируют и фильтруют.
4. `/review-cleanroom server/internal/mls` → исправления → `git commit -s` (агент), `git push` (подтверждаешь).
5. `gh pr create` → CI → ревью Claude в PR + твой просмотр diff → squash merge.
6. `deploy-test.yml` выкатывает на тест-сервер, smoke-тесты зелёные → проверяешь руками в Bruno/клиенте.
7. `/clear`, следующий промпт. Два модуля параллельно — в git worktree (`git worktree add ../bb-crypto feat/crypto-core`), по сессии Claude Code на каждый.

Правила, которые экономят больше всего времени:

- Задача с одним промптом — один модуль с проверяемым выходом. «Сделай сервер» не работает; «пакет `mls` по `CRYPTO.md` с тестами T1–T9» работает.
- Если поправил агента дважды по одному поводу — `/clear` и новый промпт с учётом ошибки; продолжать в той же сессии дороже.
- Ревью — всегда субагентом или второй сессией, не той, что писала код.
- Длинная задача — состояние в `STATUS.md` модуля, а не в памяти сессии.

## Чего не делать

- Не давать агенту `--dangerously-skip-permissions` и не убирать `ssh` из `ask`: тест-сервер — единственная внешняя система, и ошибка там стоит времени.
- Не держать секреты в репозитории и не разрешать `Read(.env)` — deny-правило для этого.
- Не писать в `docs/spec/` из сессии контура B: вопросы — в `OPEN-QUESTIONS.md`, ответы — отдельной аналитической сессией.
- Не раздувать `CLAUDE.md`: всё, что агент может вывести из кода, — лишнее; всё, что должно происходить всегда, — в hooks, а не в тексте.
