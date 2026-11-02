# Единая точка входа для команд: их одинаково запускают разработчик, Claude Code и CI.
# Рецепты для модулей, которых ещё нет, помечены как заглушки и появятся вместе с модулями.

set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

# --- проверки ---------------------------------------------------------------

check: lint test

lint: cleanroom lint-go lint-rust lint-web lint-proto

test: test-go test-rust test-web

# clean-room фильтр по всем файлам в каталогах кода
cleanroom:
    .claude/hooks/cleanroom-guard.sh --all

lint-go:
    @if [ -f server/go.mod ]; then cd server && golangci-lint run ./...; else echo "skip: server/go.mod ещё нет"; fi

lint-rust:
    @if [ -f Cargo.toml ]; then cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings; else echo "skip: Cargo.toml ещё нет"; fi

lint-web:
    @if [ -d clients/web ]; then cd clients/web && pnpm lint && pnpm typecheck; else echo "skip: clients/web ещё нет"; fi

lint-proto:
    @if [ -d proto ]; then buf lint && buf breaking --against '.git#branch=main'; else echo "skip: proto/ ещё нет"; fi

lint-licenses:
    reuse lint
    @if [ -f Cargo.toml ]; then cargo deny check; fi
    @if [ -f server/go.mod ]; then cd server && go-licenses check ./...; fi

test-go:
    @if [ -f server/go.mod ]; then cd server && go test -race ./...; else echo "skip: server/go.mod ещё нет"; fi

test-rust:
    @if [ -f Cargo.toml ]; then cargo test --workspace; else echo "skip: Cargo.toml ещё нет"; fi

test-web:
    @if [ -d clients/web ]; then cd clients/web && pnpm test; else echo "skip: clients/web ещё нет"; fi

# --- локальная среда --------------------------------------------------------

compose := "docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/compose.dev.yml"

dev-up:
    {{compose}} up -d

dev-down:
    {{compose}} down

dev-logs svc="":
    {{compose}} logs --tail=200 -f {{svc}}

# Go-сервер с hot reload против инфраструктуры из compose
dev-server:
    cd server && air

dev-web:
    cd clients/web && pnpm dev

dev-desktop:
    cd clients/desktop && pnpm dev

# --- кодогенерация ----------------------------------------------------------

gen:
    @if [ -d proto ]; then buf generate; fi
    @if [ -f server/go.mod ]; then cd server && sqlc generate; fi
    just openapi

openapi:
    @if [ -d server/cmd/openapi ]; then cd server && go run ./cmd/openapi > ../docs/protocol/openapi.yaml; else echo "skip: server/cmd/openapi ещё нет"; fi

# --- тест-сервер (ssh-алиас bb-test из ~/.ssh/config) ----------------------

deploy-test:
    ssh bb-test 'cd ~/bebeberloga && docker compose pull && docker compose up -d --remove-orphans && docker compose ps'

smoke-test base_url=env_var_or_default("BB_TEST_URL", "https://test.bebeberloga.org"):
    hurl --test --variable base_url={{base_url}} tools/api/smoke/*.hurl

test-logs svc="server":
    ssh bb-test "cd ~/bebeberloga && docker compose logs --tail=200 {{svc}}"

# --- сервис -----------------------------------------------------------------

# установить git-хуки lefthook
hooks:
    lefthook install

# показать, что уже есть в репозитории
tree:
    git ls-files | sed 's|/[^/]*$||' | sort -u
