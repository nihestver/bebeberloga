# Процесс разработки

Как устроена работа над Bebeberloga: VSCodium + Claude Code на macOS, тест-сервер по SSH, GitHub Actions. Claude Code делает большую часть работы по готовым промптам; проверки (форматирование, clean-room-фильтр, линтеры, тесты, деплой) выполняются автоматически.

Конфигурация описана здесь словами; сами файлы — источник правды, их не копируем в документацию, чтобы не расходились. Проверено по документации Claude Code на 2026-11-02: [VS Code и форки](https://code.claude.com/docs/en/vs-code), [skills](https://code.claude.com/docs/en/skills), [subagents](https://code.claude.com/docs/en/sub-agents), [hooks](https://code.claude.com/docs/en/hooks-guide), [permissions](https://code.claude.com/docs/en/permissions).

## Быстрый старт (что делать сейчас)

1. **Закоммитить документацию.** В VSCodium открой панель Claude Code в корне репозитория и выполни `/pr docs: спецификация экранов, потоки, права, промпты`. Claude Code создаст ветку, прогонит проверки, закоммитит с DCO и откроет PR; `git push` он спросит — подтверди. Смёрджи PR на GitHub (squash).
2. **Проверить окружение** — раздел «Проверка настройки» ниже (5 минут).
3. **Запустить первые промпты фазы 0** — по дорожкам из [`docs/prompts/README.md`](../prompts/README.md#порядок-запуска): начни с `/prompt B01` (протокол) и параллельно в отдельном worktree `/prompt S1` (OpenMLS). `/next` всегда подскажет, что можно запускать.
4. **Тест-сервер** — шаг «Тест-сервер» ниже; нужен к промпту B17 (часть 1).
5. **Вопросы к спецификации** копятся в `docs/spec/OPEN-QUESTIONS.md`; раз в несколько дней отвечай на них в чате контура A (проект Claude «bebeberloga») и переноси ответы в `docs/spec/`.

## Принципы

1. **Одна команда на действие.** Всё, что запускает агент, — рецепты `just` (`just test`, `just lint`, `just deploy-test`). CI и задачи VSCodium вызывают те же рецепты.
2. **Проверка за агентом автоматическая.** Форматирование и clean-room-фильтр — hooks Claude Code; линтеры, тесты, лицензии, ссылки — CI. `CLAUDE.md` советует, hooks и CI гарантируют.
3. **Один промпт — одна сессия — одна ветка — один PR.** Между промптами `/clear`. Исследование и ревью — субагентами.
4. **Тест-сервер — копия прода**: тот же Docker Compose, что получат администраторы; деплой — из CI после merge в `main`.
5. **Секреты не живут в репозитории**: `.env` — в `.gitignore` и GitHub Secrets; Claude Code их не читает (deny-правила).
6. **Clean room**: Claude Code — контур B. Он не открывает сторонние продукты и не читает `docs/PLAN.md`; всё, что ему нужно, — в `docs/spec/` (включая `ARCHITECTURE.md`).

## Инструменты на macOS

```bash
brew install git gh jq just lefthook mise colima docker docker-compose hurl buf \
             protobuf reuse lychee
brew install --cask vscodium
brew install --cask bruno            # ручная отладка API; коллекция хранится в git
mise install                         # версии Go, Rust, Node, pnpm, golangci-lint v2 из mise.toml
lefthook install                     # git-хуки: clean room, форматирование, Conventional Commits, DCO
colima start --cpu 4 --memory 8      # Docker без Docker Desktop
```

Добавь `eval "$(mise activate zsh)"` в `~/.zshrc`, чтобы версии из `mise.toml` подхватывались в терминале VSCodium. Claude Code CLI нужен для `claude` в терминале и для GitHub Action (`claude setup-token`); установка — по [официальной инструкции](https://code.claude.com/docs/en/setup).

## VSCodium

VSCodium берёт расширения из [Open VSX](https://open-vsx.org); все рекомендованные там есть.

- **Расширения** — `.vscode/extensions.json`. При открытии папки VSCodium предложит установить рекомендованные; или `Cmd+Shift+P` → «Extensions: Show Recommended Extensions». Главное — **Claude Code** (`anthropic.claude-code`, [Open VSX](https://open-vsx.org/extension/Anthropic/claude-code)); остальные — Go, rust-analyzer, CodeLLDB, ESLint, Prettier, Vitest, Playwright, Buf, YAML, TOML, markdownlint, EditorConfig, just, mise.
- **Настройки проекта** — `.vscode/settings.json`: форматирование при сохранении по языкам, clippy в rust-analyzer, golangci-lint, markdownlint без правил, мешающих русским таблицам. `docs/PLAN.md` исключён из поиска — так его текст не попадёт в Claude Code даже через выделение в редакторе.
- **Задачи** — `.vscode/tasks.json`: `Cmd+Shift+P` → «Tasks: Run Task» → `just check`, `just test`, `dev: …`, `тест-сервер: …`. `Cmd+Shift+B` — `just check`.
- **Claude Code в VSCodium**: значок Claude в панели действий или `Cmd+Esc`. Панель показывает diff каждой правки, план до реализации, историю сессий. Если удобнее терминал — `claude` во встроенном терминале; настройки (`.claude/`) общие.
- **Режимы**: начинай каждый промпт в **plan mode** (`Shift+Tab`); скилл `/prompt` и так остановится после плана. Режим по умолчанию задаётся в пользовательских настройках расширения (`claudeCode.initialPermissionMode`), не в проекте.
- **Параллельные дорожки**: `git worktree add ../bb-s1 -b spike/S1-openmls` → `File → New Window` → открыть `../bb-s1` → отдельная сессия Claude Code. После merge: `git worktree remove ../bb-s1`.

## Claude Code: что настроено

| Файл | Что делает |
|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) | Context pack контура B: источники правды, clean room, правила интерфейса и кода, инварианты E2EE, порядок работы |
| [`.claude/settings.json`](../../.claude/settings.json) | `allow` — рутинные команды без подтверждений (`just`, `go`, `cargo`, `pnpm`, `buf`, `git` без push, `gh pr create/view/list`); `ask` — всё, что уходит наружу (`ssh`, `git push`, `gh pr merge`, `docker compose down`); `deny` — секреты, сайты стороннего продукта, `docs/PLAN.md` (в том числе через `git show/log/diff`); hooks ниже |
| [`.claude/hooks/cleanroom-guard.sh`](../../.claude/hooks/cleanroom-guard.sh) | Перед каждой записью файла блокирует слова из запретного списка: уровень 1 — во всём репозитории (кроме самого списка, `docs/cleanroom/` и плана), уровень 2 — в коде, `spikes/`, `tests/` и `docs/protocol/`, кроме `clients/*/src/locales/` (ADR-0014). Тот же скрипт — в lefthook, `just cleanroom` и CI |
| [`.claude/hooks/format.sh`](../../.claude/hooks/format.sh) | После каждой записи форматирует файл (gofmt, rustfmt, buf, prettier) |
| [`.claude/agents/`](../../.claude/agents) | `cleanroom-reviewer` — независимое ревью на заимствования и соответствие спецификации; `security-reviewer` — инварианты E2EE; `spec-analyst` — контур A для правок `docs/spec/` без `CLAUDE.md` контура B |
| [`.claude/skills/`](../../.claude/skills) | Команды ниже |

### Команды (скиллы)

| Команда | Что делает |
|---|---|
| `/next` | Таблица прогресса по промптам и 1–3 промпта, которые можно запускать сейчас |
| `/prompt B01` | Выполнить готовый промпт: проверка зависимостей → ветка → план (стоп) → реализация с тестами → STATUS.md → ревью субагентами |
| `/pr [описание]` | Коммиты по Conventional Commits с DCO, `just lint test`, push (с подтверждением), PR по шаблону |
| `/review-cleanroom <каталог>` | Ревью модуля субагентом `cleanroom-reviewer` |
| `/deploy-test` | Выкатить `main` на тест-сервер и прогнать smoke-тесты |
| `/module` | Старое имя `/prompt` |

### Проверка настройки

1. Открой папку в VSCodium, запусти Claude Code; `/hooks` — три hook-а (PreToolUse, PostToolUse, SessionStart); `/agents` — три субагента; `/` — скиллы `next`, `prompt`, `pr`, `review-cleanroom`, `deploy-test`.
2. Попроси: «создай файл `server/internal/tmp.go` с типом `Guild`» — hook заблокирует запись и сошлётся на глоссарий.
3. Попроси: «прочитай docs/PLAN.md» — получишь отказ по правилу deny. Это ограждение, а не изоляция: скрипт или `grep -r` по всему репозиторию план всё равно увидит. Полная изоляция — держать план вне репозитория (см. «Контур A»).
4. `/next` — таблица промптов, первым предложит B01 и спайки.
5. В терминале: `just check` — все рецепты либо проходят, либо пишут «skip: … ещё нет».

## Репозиторий и ветки

- Conventional Commits (`feat(server): …`, `docs(spec): …`, `spike(S1): …`), подпись DCO (`git commit -s`) — проверяет lefthook.
- Ветки: `feat/<промпт>-<что>`, `fix/…`, `docs/…`, `spike/<номер>-<что>`. Squash-merge в `main`, прямые push в `main` запрещены защитой ветки.
- Каждый модуль ведёт `STATUS.md` (сделано / сломано / дальше); криптография и медиа — ещё `SECURITY-CHANGELOG.md`.

## Локальная среда

`deploy/compose/docker-compose.yml` (появится в B17 часть 1) — тот же файл, что у администраторов: server, postgres:16, valkey:8, nats с JetStream, minio, livekit, coturn, caddy. `compose.dev.yml` открывает порты наружу и выключает `server` — его запускаешь через `just dev-server` с hot reload.

Цикл: `just dev-up` → `just dev-server` → `just dev-web` → `just dev-desktop` (Electron подключается к Vite). В VSCodium — задачи «dev: …». Переменные — в `.env.example` (коммитится) и `.env` (нет).

## Тест-сервер

DNS в Cloudflare: `test.bebeberloga.org` и `turn.test.bebeberloga.org` → `132.243.195.177`, режим DNS only (UDP-медиа и TLS от Caddy не проходят через прокси Cloudflare).

На сервере (Debian/Ubuntu, от root):

```bash
apt update && apt install -y docker.io docker-compose-v2 ufw fail2ban
systemctl enable --now docker
ufw allow 22,80,443/tcp && ufw allow 7881/tcp && ufw allow 3478/udp && ufw allow 50000:60000/udp && ufw enable
useradd -m -s /bin/bash deploy && usermod -aG docker deploy
mkdir -p /home/deploy/bebeberloga && chown deploy:deploy /home/deploy/bebeberloga
```

Порты: 7881/tcp и 50000–60000/udp — LiveKit, 3478/udp — coturn (уточняются в B7).

На Mac — ключ `ssh-keygen -t ed25519 -f ~/.ssh/bebeberloga_test`, публичную часть в `~deploy/.ssh/authorized_keys`, и в `~/.ssh/config`:

```
Host bb-test
  HostName test.bebeberloga.org
  User deploy
  IdentityFile ~/.ssh/bebeberloga_test
  IdentitiesOnly yes
```

Для CI — отдельный ключ: `ssh-keygen -t ed25519 -f ~/.ssh/bebeberloga_ci -C ci` → публичная часть на сервер, приватная — в GitHub Secret `TEST_SSH_KEY`, `ssh-keyscan test.bebeberloga.org` — в `TEST_KNOWN_HOSTS`, `test.bebeberloga.org` — в `TEST_SSH_HOST`; secrets кладутся в environment `test` репозитория. Адрес для smoke-тестов — переменная (не секрет) `TEST_BASE_URL` того же environment; без неё используется `https://test.bebeberloga.org`.

Claude Code выполняет на сервере только `just deploy-test`, `just smoke-test`, `just test-logs` (через `Bash(just *)`); любой другой `ssh` спросит подтверждение.

## CI/CD (GitHub Actions)

- [`ci.yml`](../../.github/workflows/ci.yml) — на каждый PR и push в `main`: `cleanroom` (фильтр + `reuse lint`), `docs` (внутренние ссылки в markdown), `go`, `rust` (три ОС), `web`, `proto` — по затронутым каталогам.
- [`deploy-test.yml`](../../.github/workflows/deploy-test.yml) — после зелёного CI на `main`: образ сервера в GHCR → выкатка на тест-сервер → smoke-тесты. Заработает после B17 часть 1 (`server/Dockerfile`).
- `release.yml` — на тег `v*` (B17 часть 2).
- Claude в PR (по желанию): `/install-github-app` в Claude Code, токен подписки — секрет `CLAUDE_CODE_OAUTH_TOKEN`; ограничь `--max-turns 15` и `timeout-minutes: 20`.
- Защита `main` (Settings → Branches): обязательный PR, одна обязательная проверка `ci-ok` (она ждёт все остальные jobs и считает пропущенные по фильтру путей успешными), squash-merge, линейная история.

## Тестирование API

| Инструмент | Для чего | Где |
|---|---|---|
| hurl | Автотесты REST: smoke после деплоя, сценарии «регистрация → вход → сервер → приглашение» | `tools/api/smoke/`, `tools/api/scenarios/`; `just smoke-test` |
| Bruno | Ручная отладка; коллекция из OpenAPI | `tools/api/bruno/` |
| websocat | Ручная отладка gateway в JSON-режиме | `brew install websocat` |

`docs/protocol/openapi.yaml` — контракт REST: пишется первым (B1), из него генерируются Go-обработчики и TS-клиент (`just gen`). `just openapi` проверяет файл линтером; несовместимые изменения видны в diff PR.

## Ежедневный цикл

1. `/next` → выбрать промпт. Для параллельной дорожки — новый worktree и окно VSCodium.
2. `/prompt B04` → план → одобрить или поправить → реализация (агент сам гоняет `just lint`, `just test`; hooks форматируют и фильтруют).
3. Ревью субагентами запускается в конце `/prompt`; находки — исправить.
4. `/pr` → CI → просмотр diff на GitHub → squash-merge.
5. После merge `deploy-test.yml` выкатывает `main`; проверка руками в Bruno или клиенте.
6. `/clear`, следующий промпт.

Правила, которые экономят время:
- поправил агента дважды по одному поводу — `/clear` и новый запуск с уточнением, а не третья попытка в той же сессии;
- ревью — всегда субагентом или другой сессией, не той, что писала код;
- длинная задача — состояние в `STATUS.md`, а не в памяти сессии;
- спецификация молчит — вопрос в `OPEN-QUESTIONS.md`, не догадка.

## Контур A (спецификация)

Спецификацию правит контур A — в чате проекта Claude «bebeberloga» или субагентом `spec-analyst`. Наблюдение за сторонними продуктами — только в контуре A, с записью в `docs/cleanroom/LOG.md`. Claude Code (контур B) в `docs/spec/` пишет только вопросы в `OPEN-QUESTIONS.md`, в `docs/prompts/README.md` — статусы промптов.

Рабочий план `docs/PLAN.md` закрыт для Claude Code правилами deny (чтение, `git show/log/diff/blame/grep` по нему). Это ограждение, а не изоляция: процесс, который читает файлы сам (скрипт, `grep -r`), план увидит. Для полной изоляции план можно хранить вне репозитория — в проекте Claude «bebeberloga»; тогда в репозитории остаются только выжимки `docs/spec/ARCHITECTURE.md` и `FEATURES.md`.

## Чего не делать

- Не запускать агента с `--dangerously-skip-permissions` и не убирать `ssh` и `git push` из `ask`.
- Не держать секреты в репозитории и не разрешать чтение `.env`.
- Не открывать в сессиях Claude Code сторонние продукты, их сайты и документацию API.
- Не давать Claude Code читать `docs/PLAN.md` и не вставлять из него текст в промпты.
