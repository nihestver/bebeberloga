# Единая точка входа для команд: их одинаково запускают разработчик, Claude Code и CI.
# Рецепты для модулей, которых ещё нет, помечены как заглушки и появятся вместе с модулями.

set shell := ["bash", "-euo", "pipefail", "-c"]

default: check

# --- проверки ---------------------------------------------------------------

check: lint test

lint: cleanroom openapi lint-sh lint-go lint-rust lint-web lint-proto lint-deploy

test: test-go test-rust test-web test-deploy

# clean-room фильтр (запретный список), лицензионные заголовки REUSE и реестр ассетов по всему репозиторию
cleanroom: attribution
    .claude/hooks/cleanroom-guard.sh --all
    @if command -v reuse >/dev/null; then reuse lint -q && echo "reuse: ok"; else echo "skip: reuse не установлен (brew install reuse); в CI проверяется"; fi

# каждый файл-ассет (изображение, иконка, шрифт, звук) — строка в ATTRIBUTION.md с автором, источником и лицензией
attribution:
    tools/check-attribution.sh

lint-sh:
    @if command -v shellcheck >/dev/null; then git ls-files -z '*.sh' | xargs -0 shellcheck -S warning && echo "shellcheck: ok"; else echo "skip: shellcheck не установлен (brew install shellcheck); в CI проверяется"; fi

lint-go:
    @if [ -f server/go.mod ]; then cd server && golangci-lint run ./...; else echo "skip: server/go.mod ещё нет"; fi

lint-rust:
    @if [ -f Cargo.toml ]; then cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings; else echo "skip: Cargo.toml ещё нет"; fi

lint-web:
    @if [ -f clients/web/package.json ]; then cd clients/web && pnpm lint && pnpm typecheck; else echo "skip: clients/web/package.json ещё нет (B09); до него в clients/web только сгенерированные типы"; fi

# buf breaking сравнивает с main только когда там уже есть .proto (иначе buf падает на пустом модуле)
lint-proto:
    @if [ -d proto ]; then buf lint && buf format -d --exit-code && if git ls-tree -r --name-only main -- proto | grep -q '\.proto$'; then buf breaking --against '.git#branch=main'; else echo "skip: в main ещё нет proto/, buf breaking пропущен"; fi; else echo "skip: proto/ ещё нет"; fi

# Без запуска: схема, подстановка переменных и слияние оверлеев; пароли хранилищ обязаны быть без умолчаний.
# Compose-файлы собираются во всех вариантах (основной, dev, стенд агента)
lint-deploy:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! docker compose version >/dev/null 2>&1; then echo "skip: docker compose не установлен; в CI проверяется"; exit 0; fi
    export POSTGRES_PASSWORD=lint VALKEY_PASSWORD=lint NATS_PASSWORD=lint BB_DOMAIN=lint.invalid
    base="docker compose --env-file /dev/null -f deploy/compose/docker-compose.yml"
    $base config -q
    $base -f deploy/compose/compose.dev.yml config -q
    $base -f deploy/compose/compose.agent.yml config -q
    for var in POSTGRES_PASSWORD VALKEY_PASSWORD NATS_PASSWORD BB_DOMAIN; do
      if env -u "$var" $base config -q 2>/dev/null; then echo "compose: без $var конфигурация не должна собираться"; exit 1; fi
    done
    echo "compose: ok"

lint-licenses:
    reuse lint
    @if [ -f Cargo.toml ]; then cargo deny check; fi
    # собственный модуль под корневым LICENSE (AGPL), go-licenses ищет файл только до server/go.mod — исключаем
    # список разрешённых лицензий — LICENSING.md (GPL/LGPL только через ADR, сюда не входят)
    @if [ -f server/go.mod ]; then cd server && go-licenses check --ignore github.com/nihestver/bebeberloga/server --allowed_licenses=MIT,BSD-2-Clause,BSD-3-Clause,Apache-2.0,ISC,MPL-2.0,Zlib,Unlicense,CC0-1.0,Unicode-3.0,OFL-1.1 ./...; fi

test-go:
    @if [ -f server/go.mod ]; then cd server && go test -race ./...; else echo "skip: server/go.mod ещё нет"; fi

# сервер собирается под обе платформы образа (linux/amd64 и linux/arm64) — без Docker, для job go в CI
build-cross:
    @if [ -f server/go.mod ]; then cd server && for arch in amd64 arm64; do CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -o /dev/null ./cmd/bebeberloga-server && echo "linux/$arch: ok"; done; else echo "skip: server/go.mod ещё нет"; fi

test-rust:
    @if [ -f Cargo.toml ]; then cargo test --workspace; else echo "skip: Cargo.toml ещё нет"; fi

test-web:
    @if [ -f clients/web/package.json ]; then cd clients/web && pnpm test; else echo "skip: clients/web/package.json ещё нет (B09)"; fi

# init-env.sh: пароли вписаны и случайны, файл закрыт от чужих, существующий .env не перезаписывается,
# а docker-compose.yml собирается с одним лишь созданным .env (в .env.example есть все обязательные переменные)
test-deploy:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    fail() { echo "init-env: $*"; exit 1; }
    cp deploy/compose/init-env.sh deploy/compose/.env.example "$tmp/"
    "$tmp/init-env.sh" >/dev/null
    [ "$(grep -cE '^[A-Z_]+_PASSWORD=[0-9a-f]{48}$' "$tmp/.env")" = 3 ] || fail "ожидались три пароля по 48 шестнадцатеричных символов"
    [ "$(grep -E '_PASSWORD=' "$tmp/.env" | grep -v '^#' | cut -d= -f2 | sort -u | wc -l | tr -d ' ')" = 3 ] || fail "пароли должны различаться"
    [ "$(ls -l "$tmp/.env" | cut -c1-10)" = "-rw-------" ] || fail ".env должен быть доступен только владельцу"
    before="$(cksum < "$tmp/.env")"
    if "$tmp/init-env.sh" >/dev/null 2>&1; then fail "повторный запуск должен завершиться ошибкой"; fi
    "$tmp/init-env.sh" --if-missing || fail "--if-missing при существующем .env должен завершиться успешно"
    [ "$(cksum < "$tmp/.env")" = "$before" ] || fail "существующий .env изменён"
    [ -z "$(find "$tmp" -name '.env.*' ! -name .env.example)" ] || fail "остался временный файл"
    if docker compose version >/dev/null 2>&1; then
      env -u POSTGRES_PASSWORD -u VALKEY_PASSWORD -u NATS_PASSWORD -u BB_DOMAIN \
        docker compose --env-file "$tmp/.env" -f deploy/compose/docker-compose.yml config -q \
        || fail "docker-compose.yml не собирается с .env из .env.example"
    else
      echo "skip: docker compose не установлен — сборка конфигурации с созданным .env не проверена; в CI проверяется"
    fi
    echo "init-env: ok"

# --- локальная среда --------------------------------------------------------

compose := "docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/compose.dev.yml"

# хранилища для локальной разработки; .env со случайными паролями создаётся при первом запуске
dev-up:
    deploy/compose/init-env.sh --if-missing
    {{compose}} up -d --wait

dev-down:
    {{compose}} down

dev-logs svc="":
    {{compose}} logs --tail=200 -f {{svc}}

# Go-сервер с hot reload против хранилищ из `just dev-up`: адреса и пароли — из deploy/compose/.env
dev-server:
    #!/usr/bin/env bash
    set -euo pipefail
    # без `set -a`: переменные развёртывания (BB_DOMAIN, BB_MEM_*) тоже начинаются с BB_ и серверу не передаются
    . deploy/compose/.env
    export BB_DATABASE_URL="postgres://bebeberloga:${POSTGRES_PASSWORD}@127.0.0.1:${BB_DEV_POSTGRES_PORT:-5432}/bebeberloga?sslmode=disable"
    export BB_VALKEY_URL="redis://:${VALKEY_PASSWORD}@127.0.0.1:${BB_DEV_VALKEY_PORT:-6379}/0"
    export BB_NATS_URL="nats://bebeberloga:${NATS_PASSWORD}@127.0.0.1:${BB_DEV_NATS_PORT:-4222}"
    cd server && air

dev-web:
    cd clients/web && pnpm dev

dev-desktop:
    cd clients/desktop && pnpm dev

# --- образ и стек из рабочего дерева ----------------------------------------

# версия сборки из рабочего дерева: dev-<ревизия>[-dirty]; без git (копия на стенде агента) — dev-unknown
tree_version := `rev="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"; if [ "$rev" != unknown ] && ! git diff --quiet HEAD 2>/dev/null; then rev="$rev-dirty"; fi; echo "dev-$rev"`

# образ сервера из рабочего дерева; платформа по умолчанию — своя, для проверки кросс-сборки: just image t linux/arm64
image tag="bebeberloga/server:dev" platform="":
    docker build -f server/Dockerfile {{ if platform != "" { "--platform " + platform } else { "" } }} --build-arg VERSION={{tree_version}} -t {{tag}} .

# собрать образ, поднять весь стек с оверлеем стенда агента, прогнать smoke-тесты через Caddy и убрать за собой
compose-smoke port="18089":
    #!/usr/bin/env bash
    set -euo pipefail
    deploy/compose/init-env.sh --if-missing
    export BB_AGENT_HTTP_PUBLISH=127.0.0.1:{{port}} BB_AGENT_SERVER_IMAGE=bb-smoke/server:local BB_VERSION={{tree_version}}
    c="docker compose -p bb-smoke -f deploy/compose/docker-compose.yml -f deploy/compose/compose.agent.yml"
    trap '$c down -v --remove-orphans' EXIT
    $c up -d --build --wait || { $c ps -a; $c logs --tail=50; exit 1; }
    hurl --test --retry 10 --retry-interval 3000 --variable base_url=http://127.0.0.1:{{port}} tools/api/smoke/*.hurl \
      || { $c logs --tail=50 server caddy; exit 1; }

# --- кодогенерация ----------------------------------------------------------

# buf generate → sqlc → oapi-codegen (go tool); результат коммитится, CI проверяет свежесть (gen-check)
gen:
    @if [ -d proto ]; then buf generate; fi
    @if [ -f server/sqlc.yaml ]; then cd server && sqlc generate; else echo "skip: server/sqlc.yaml ещё нет"; fi
    @if [ -f server/go.mod ] && [ -f docs/protocol/openapi.yaml ]; then cd server && go generate ./...; fi
    @if [ -f clients/web/package.json ]; then cd clients/web && pnpm run --if-present gen; fi

# сгенерированный код не отстал от контракта (ADR-0017 п. 5)
gen-check: gen
    @if git status --porcelain -- server/gen clients/web/src/gen | grep .; then echo "сгенерированный код отстал от контракта: закоммить файлы выше (just gen)"; exit 1; fi

# контракт REST — docs/protocol/openapi.yaml (пишется руками, код генерируется из него)
openapi:
    @if [ -f docs/protocol/openapi.yaml ]; then npx --yes @redocly/cli@1 lint docs/protocol/openapi.yaml; else echo "skip: docs/protocol/openapi.yaml ещё нет (B1)"; fi

# --- тест-сервер (ssh-алиас bb-test из ~/.ssh/config) ----------------------

# Compose-файл и Caddyfile берутся из git-ревизии (по умолчанию — свежий origin/main), а не из рабочего
# дерева; .env на сервере не трогается. Тот же рецепт вызывает deploy-test.yml (с ревизией коммита).
# Caddyfile смонтирован в контейнер файлом: Compose не замечает, что он изменился, и контейнер видит
# старый. Поэтому после up файл в контейнере сверяется с файлом на диске, и caddy пересоздаётся при различии.
# выкатить тест-стенд: файлы Compose из ревизии git и свежий образ сервера из GHCR
deploy-test ref="origin/main":
    @if [ {{quote(ref)}} = origin/main ]; then git fetch -q origin main; fi
    git archive {{quote(ref)}} deploy/compose/docker-compose.yml deploy/compose/Caddyfile | ssh bb-test 'tar -x -C ~/bebeberloga --strip-components=2 -f -'
    ssh bb-test 'cd ~/bebeberloga && docker compose pull && docker compose up -d --remove-orphans --wait && { [ "$(docker compose exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | cksum)" = "$(cksum < Caddyfile)" ] || docker compose up -d --no-deps --force-recreate --wait caddy; } && docker compose ps'

# smoke-тесты REST; повторы — на время, пока сервер и Caddy поднимаются после выкатки
smoke-test base_url=env_var_or_default("BB_TEST_URL", "https://test.bebeberloga.org"):
    hurl --test --retry 10 --retry-interval 3000 --variable base_url={{base_url}} tools/api/smoke/*.hurl

test-logs svc="server":
    ssh bb-test "cd ~/bebeberloga && docker compose logs --tail=200 {{svc}}"

# --- стенд агента (ssh-алиас bb-claude; настройка — tools/dev/setup-agent-access.sh) ---
# Рабочее дерево (вместе с незакоммиченными правками) копируется в ~/src/bebeberloga пользователя
# claude на тест-сервере; тесты и Compose-проект bb-agent запускаются на его железе.
# Тест-стенд bb-test (пользователь deploy) эти рецепты не трогают — он обновляется только из CI.

agent_host := "bb-claude"
agent_dir := "~/src/bebeberloga"
agent_mise := "~/.local/bin/mise"
agent_compose := "docker compose -p bb-agent -f deploy/compose/docker-compose.yml -f deploy/compose/compose.agent.yml"

# скопировать рабочее дерево на сервер: без .git, секретов, сборок и docs/PLAN.md
remote-sync:
    rsync -az --delete --exclude-from=tools/dev/remote-sync.exclude ./ {{agent_host}}:src/bebeberloga/

# установить на сервере тулчейны из mise.toml (первый раз — долго)
remote-setup: remote-sync
    ssh {{agent_host}} 'cd {{agent_dir}} && {{agent_mise}} trust -q && {{agent_mise}} install'

# железо и окружение сервера
remote-check:
    ssh {{agent_host}} 'uname -srm; echo "cpu: $(nproc)"; free -h | sed -n 2,3p; df -h ~ | tail -1; docker info >/dev/null 2>&1 && echo "docker: ok ($(docker version --format "{{{{.Server.Version}}")), compose $(docker compose version --short 2>/dev/null || echo нет), buildx $(docker buildx version 2>/dev/null | cut -d" " -f2 || echo нет)" || echo "docker: нет доступа"; {{agent_mise}} --version'

# запустить рецепт этого justfile на сервере: just remote test-go, just remote test-rust
remote recipe="test": remote-sync
    ssh {{agent_host}} 'cd {{agent_dir}} && {{agent_mise}} trust -q && {{agent_mise}} exec -- just {{recipe}}'

# Образ сервера собирается на сервере из копии дерева; .env со случайными паролями создаётся там же
# при первом запуске и на Mac не копируется. Изменённый Caddyfile применяется пересозданием caddy (см. deploy-test).
# поднять стенд агента (Compose-проект bb-agent) на сервере
remote-up: remote-sync
    ssh {{agent_host}} 'cd {{agent_dir}} && deploy/compose/init-env.sh --if-missing && export BB_VERSION={{tree_version}} && { {{agent_compose}} up -d --build --remove-orphans --wait || { {{agent_compose}} ps -a; exit 1; }; } && { [ "$({{agent_compose}} exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | cksum)" = "$(cksum < deploy/compose/Caddyfile)" ] || {{agent_compose}} up -d --no-deps --force-recreate --wait caddy; } && {{agent_compose}} ps'

remote-ps:
    ssh {{agent_host}} 'cd {{agent_dir}} && {{agent_compose}} ps'

remote-logs svc="server":
    ssh {{agent_host}} 'cd {{agent_dir}} && {{agent_compose}} logs --tail=200 {{svc}}'

# остановить стенд агента; тома с данными сохраняются
remote-down:
    ssh {{agent_host}} 'cd {{agent_dir}} && {{agent_compose}} down'

# --- сервис -----------------------------------------------------------------

# установить git-хуки lefthook
hooks:
    lefthook install

# показать, что уже есть в репозитории
tree:
    git ls-files | sed 's|/[^/]*$||' | sort -u
