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

1. **Одна команда на действие.** Всё, что запускает агент, — рецепты `just` (`just test`, `just lint`, `just remote-up`). CI и задачи VSCodium вызывают те же рецепты.
2. **Проверка за агентом автоматическая.** Форматирование и clean-room-фильтр — hooks Claude Code; линтеры, тесты, лицензии, ссылки — CI. `CLAUDE.md` советует, hooks и CI гарантируют.
3. **Один промпт — одна сессия — одна ветка — один PR.** Между промптами `/clear`. Исследование и ревью — субагентами.
4. **Тест-сервер — копия прода**: тот же Docker Compose, что получат администраторы; деплой — из CI после merge в `main`.
5. **Секреты не живут в репозитории**: `.env` — в `.gitignore` и GitHub Secrets; Claude Code их не читает (deny-правила).
6. **Clean room**: Claude Code — контур B. Он не открывает сторонние продукты и не читает `docs/PLAN.md`; всё, что ему нужно, — в `docs/spec/` (включая `ARCHITECTURE.md`).

## Инструменты на macOS

```bash
brew install git gh jq just lefthook mise hurl buf \
             protobuf reuse lychee shellcheck
brew install --cask vscodium
brew install --cask bruno            # ручная отладка API; коллекция хранится в git
mise install                         # версии Go, Rust, Node, pnpm, golangci-lint v2 из mise.toml
lefthook install                     # git-хуки: clean room, форматирование, Conventional Commits, DCO
```

Docker на Mac — любой из двух вариантов:

- **Docker Desktop** (`brew install --cask docker-desktop`) — проверено: 4.99.0 (Docker Engine 29.9.3), 2026-11-11; локально проходят интеграционные тесты на testcontainers и `just compose-smoke`.
- **colima** — свободная альтернатива, в проекте не проверялась:

  ```bash
  brew install colima docker docker-compose
  colima start --cpu 4 --memory 8
  ```

Серверная часть проверяется на тест-сервере (`just remote …`) и в CI: там обычный Docker на Linux.

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
| [`.claude/settings.json`](../../.claude/settings.json) | `allow` — рутинные команды без подтверждений (`just`, `go`, `cargo`, `pnpm`, `buf`, `git` без push, `gh pr create/view/list`); `ask` — всё, что уходит наружу (`ssh`, `git push`, `docker compose down`); `deny` — merge PR (`gh pr merge`, `gh api` с `merge`), `git push` в `main`, секреты, сайты стороннего продукта, `docs/PLAN.md` (в том числе через `git show/log/diff`); hooks ниже |
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
| `/module` | Старое имя `/prompt` |

### Проверка настройки

1. Открой папку в VSCodium, запусти Claude Code; `/hooks` — три hook-а (PreToolUse, PostToolUse, SessionStart); `/agents` — три субагента; `/` — скиллы `next`, `prompt`, `pr`, `review-cleanroom`.
2. Попроси: «создай файл `server/internal/tmp.go` с типом `Guild`» — hook заблокирует запись и сошлётся на глоссарий.
3. Попроси: «прочитай docs/PLAN.md» — получишь отказ по правилу deny. Это ограждение, а не изоляция: скрипт или `grep -r` по всему репозиторию план всё равно увидит. Полная изоляция — держать план вне репозитория (см. «Контур A»).
4. `/next` — таблица промптов, первым предложит B01 и спайки.
5. В терминале: `just check` — все рецепты либо проходят, либо пишут «skip: … ещё нет».

## Репозиторий и ветки

- Conventional Commits (`feat(server): …`, `docs(spec): …`, `spike(S1): …`), подпись DCO (`git commit -s`) — проверяет lefthook.
- Ветки: `feat/<промпт>-<что>`, `fix/…`, `docs/…`, `spike/<номер>-<что>`. Squash-merge в `main`, прямые push в `main` запрещены защитой ветки.
- После merge GitHub удаляет ветку PR. Новая задача — новая ветка от свежего `main`: push во влитую ветку создаёт её на GitHub заново. Локальные ветки GitHub не трогает; один раз `git config fetch.prune true`, дальше `git fetch` сам убирает ссылки на удалённые ветки.
- Каждый модуль ведёт `STATUS.md` (сделано / сломано / дальше); криптография и медиа — ещё `SECURITY-CHANGELOG.md`.

## Локальная среда

`deploy/compose/docker-compose.yml` — тот же файл, что у администраторов: server, postgres, valkey, nats с JetStream, caddy. S3-хранилище (Garage, [ADR-0022](../adr/0022-s3-storage-garage.md)) добавит B06, livekit и coturn — B07. `compose.dev.yml` открывает порты хранилищ на `127.0.0.1` и выключает `server` и `caddy`: сервер запускаешь через `just dev-server` с hot reload. Подробности — [`deploy/README.md`](../../deploy/README.md).

Цикл: `just dev-up` → `just dev-server` → `just dev-web` → `just dev-desktop` (Electron подключается к Vite). В VSCodium — задачи «dev: …». Переменные — в `deploy/compose/.env.example` (коммитится) и `deploy/compose/.env` (нет); `.env` со случайными паролями создаёт `deploy/compose/init-env.sh` при первом `just dev-up`.

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

Первая настройка самого стенда (файлы Compose, `.env`, видимость образа в GHCR) — [`deploy/README.md`](../../deploy/README.md#тест-сервер-первая-настройка).

Тест-стенд выкатывают CI и владелец — из терминала, командой `just deploy-test`; Claude Code его не выкатывает (`CLAUDE.md`), отдельного скилла для выкатки нет. На тест-стенде агенту доступны только `just smoke-test` и `just test-logs` (через `Bash(just *)`); любой другой `ssh` спросит подтверждение. Для проверок до merge у агента свой стенд на том же сервере — следующий раздел.

## Стенд агента

Claude Code проверяет серверный код и инфраструктуру (Postgres, Compose, coturn, LiveKit) на железе тест-сервера, не дожидаясь CI. Для этого на сервере — отдельный пользователь `claude` (группа `docker`, без sudo) и отдельный Compose-проект `bb-agent` в `~claude/src/bebeberloga`. Тест-стенд (`deploy`, `bb-test`) агент не трогает: его обновляет только CI.

Группа `docker` даёт права root на хосте, поэтому стенд агента живёт только на тест-сервере и никогда — на проде.

На сервере (от root), после блока из раздела «Тест-сервер»:

```bash
apt install -y rsync git curl build-essential pkg-config
usermod -aG docker claude
gpasswd -d claude sudo 2>/dev/null || true
install -d -o claude -g claude /home/claude/src
printf 'Match User claude\n  PasswordAuthentication no\n  KbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/20-claude.conf
sshd -t && systemctl reload ssh
su - claude -c 'curl -fsSL https://mise.run | sh && ~/.local/bin/mise use -g just@latest'
ufw allow 18080/tcp && ufw allow 17881/tcp && ufw allow 13478/udp && ufw allow 40000:40999/udp
```

На Mac — один раз `tools/dev/setup-agent-access.sh`: отдельный ключ `~/.ssh/bebeberloga_claude` (пароль хранит связка ключей macOS), алиас `bb-claude` в `~/.ssh/config`, ключ на сервере (через уже работающий личный ключ), docker context `bb-claude`, проверка сервера. Затем `just remote-setup` (Go, Rust, Node из `mise.toml` на сервере) и `just remote-check`.

| Рецепт | Что делает |
|---|---|
| `just remote-sync` | Копирует рабочее дерево на сервер (rsync); без `.git`, секретов, сборок и `docs/PLAN.md` — список в `tools/dev/remote-sync.exclude` |
| `just remote <рецепт>` | Синхронизирует и запускает рецепт `just` на сервере: `just remote test-go`, `just remote test-rust` |
| `just remote-up` / `remote-ps` / `remote-logs [svc]` / `remote-down` | Стенд `bb-agent`: `docker-compose.yml` + `compose.agent.yml`; образ сервера собирается на сервере из копии дерева |
| `just remote-check` | Процессор, память, диск, версии Docker, Compose и buildx, mise на сервере |
| `just compose-smoke` | Там, где запущен: собрать образ, поднять стек проектом `bb-smoke` (`127.0.0.1:18089`), прогнать smoke-тесты, убрать стек. Этот же рецепт — job `deploy` в CI |

Порты стендов не пересекаются (уточняются в B7):

| Что | Тест-стенд `bb-test` | Стенд агента `bb-agent` |
|---|---|---|
| HTTP API | 80, 443/tcp (Caddy, TLS) | 18080/tcp |
| LiveKit | 7881/tcp, 50000–60000/udp | 17881/tcp, 40000–40999/udp |
| coturn | 3478/udp | 13478/udp |

Postgres, Valkey и NATS наружу не публикуются ни в одном стенде. Секреты стенда агента — в `deploy/compose/.env` на сервере: файл создаёт `init-env.sh` при первом `just remote-up`, `rsync` его не перезаписывает и не удаляет. У контейнеров стенда агента жёсткие лимиты памяти (`compose.agent.yml`, в сумме 608 МБ), у тест-стенда — `BB_MEM_*` в его `.env` (столько же). Лимит — потолок для сервиса, а не резерв: сборка образа и `just remote compose-smoke` в него не входят, поэтому на сервере с 2 ГБ нужен swap-файл ([`deploy/README.md`](../../deploy/README.md#тест-сервер-первая-настройка)).

Рецепты `just remote*` проходят без подтверждения через `Bash(just *)`; произвольный `ssh` по-прежнему спрашивает.

## CI/CD (GitHub Actions)

- [`ci.yml`](../../.github/workflows/ci.yml) — на каждый PR, push в `main` и вручную (`workflow_dispatch`): `cleanroom` (фильтр, `reuse lint`, реестр ассетов `ATTRIBUTION.md`, shellcheck), `docs` (внутренние ссылки в markdown), `go`, `rust` (три ОС), `web`, `proto`, `deploy` (образ сервера и Compose-стек: сборка, запуск, smoke-тесты) — по затронутым каталогам. Новый push в ветку PR отменяет её прошлый прогон; прогоны `main` не отменяются, чтобы `deploy-test.yml` получил результат каждого коммита.
- [`deploy-test.yml`](../../.github/workflows/deploy-test.yml) — после зелёного CI от push в `main` этого репозитория: образ сервера (amd64, arm64) в GHCR → выкатка на тест-сервер того коммита, который проверил CI, → smoke-тесты и сверка версии. Выкатывается только текущая вершина `main`; без секретов environment `test` прогон пропускается.
- [`dependabot.yml`](../../.github/dependabot.yml) — раз в неделю одна сводная PR на экосистему с сообщением `ci(deps): …` / `chore(deps): …`. Сейчас GitHub Actions, образы в `deploy/compose/` (версии закреплены, мажорные обновления PostgreSQL и Valkey отключены), Go-модуль `server/` и npm в `clients/web/`; блок `cargo` раскомментируется вместе с B3. Уведомления об уязвимостях (Dependabot alerts) включены в настройках репозитория: Security → Dependabot. В Dependabot-коммитах нет `Signed-off-by`: DCO проверяет только локальный lefthook.
- `release.yml` — на тег `v*` (B17 часть 2). Практики, которые туда закладываются: один источник версии; черновик GitHub Release с `SHA256SUMS`, SBOM и подписями cosign, который человек проверяет и публикует сам; секреты подписи — в environment `release`, доступном только тегам `v*`; без секретов сборка проходит неподписанной с предупреждением, чтобы собирались и форки.
- Claude в PR (по желанию): `/install-github-app` в Claude Code, токен подписки — секрет `CLAUDE_CODE_OAUTH_TOKEN`; ограничь `--max-turns 15` и `timeout-minutes: 20`.
- [`codeql.yml`](../../.github/workflows/codeql.yml) — статический анализ кода CodeQL (Go-сервер, TS-клиент, сами workflow) на каждый PR, push в `main` и раз в неделю. Отложен до B04: пока нет `server/internal/identity`, прогон состоит из одной проверки `gate` и ничего не анализирует; PR, который добавит этот каталог, включит анализ сам. В обязательные проверки не входит и merge не блокирует; находки — Security → Code scanning. `spikes/` и сгенерированный код исключены.
- Сторонние actions в workflow закреплены полным SHA коммита с версией в комментарии (`uses: owner/action@<40 символов> # v1.2.3`): тег action можно переставить на другой код, SHA — нет. Новый `uses:` добавляется так же. Dependabot (`github-actions`) обновляет SHA и комментарий одной сводной PR.
- Защита `main` и тегов `v*` — rulesets (Settings → Rules → Rulesets), раздел ниже.

### Защита `main` и релизных тегов

Настройки живут в GitHub; здесь — что они гарантируют.

| Ruleset | Цель | Правила | Обход |
|---|---|---|---|
| `main: история и CI` | `main` | Запрет удаления и force push, линейная история, обязательная проверка `ci-ok` (она ждёт все остальные jobs и считает пропущенные по фильтру путей успешными) | Нет ни у кого |
| `main: approve владельца` | `main` | Только через PR; один approve от владельца кода (`CODEOWNERS`); новые коммиты сбрасывают approve; approve последнего push; все обсуждения закрыты | Repository admin, только для PR |
| `теги v*: создание` | теги `v*` | Создаёт тег только тот, у кого есть обход | Repository admin |
| `теги v*: неизменяемость` | теги `v*` | Запрет переноса и удаления | Нет ни у кого |

- Автор не может одобрить собственный PR, поэтому владелец вливает свои PR через обход. Красный `ci-ok` обход не снимает. PR остальных авторов, включая Dependabot, ждут approve владельца.
- Способ слияния один — squash (Settings → General).
- Аварийный случай (GitHub Actions недоступен, а влить нужно): владелец на время переводит ruleset в Disabled и возвращает Active.
- Claude Code действует от имени владельца — и локально (его ключи), и в облачных сессиях (приложение Claude работает под его учётной записью). GitHub не отличает его от админа, и обход доступен и ему. Поэтому merge и push в `main` запрещены агенту в `.claude/settings.json`. Это ограждение, а не изоляция: правило ловит обычную форму команды. Менять rulesets облачная сессия не может: у приложения нет права администрирования.

### Настройки репозитория вне файлов

Эти настройки живут в GitHub, а не в репозитории. Таблица нужна, чтобы их можно было сверить или восстановить; состояние на 13.11.2026.

| Где | Настройка | Зачем |
|---|---|---|
| Settings → General | Разрешён только squash-merge; Automatically delete head branches | Линейная история; влитые ветки не копятся |
| Settings → Rules → Rulesets | Четыре ruleset-а из раздела выше; классического правила защиты ветки нет | Защита `main` и тегов `v*` |
| Settings → Actions → General | Require actions to be pinned to a full-length commit SHA | `uses:` по тегу не запускается |
| Settings → Actions → General | Fork pull request workflows: Require approval for all external contributors | Workflow из чужого форка ждёт кнопки владельца |
| Settings → Actions → General | Workflow permissions: read; «Allow GitHub Actions to create and approve pull requests» выключено | Токен workflow не пишет в репозиторий и не одобряет PR |
| Settings → Environments → `test` | Deployment branches: только `main`; секреты выкатки — на уровне environment | Секреты стенда недоступны другим веткам |
| Settings → Advanced Security | Private vulnerability reporting, Dependency graph, Dependabot alerts, Malware alerts, Secret scanning с push protection — включены | Уведомления об уязвимых и вредоносных зависимостях, секреты не попадают в push |
| Settings → Advanced Security → Dependabot rules | Правило «spikes: одноразовый код, зависимости не обновляются»: бессрочно закрывает уведомления по пяти файлам зависимостей в `spikes/`. К уведомлениям, открытым до создания правила, GitHub его не применил — 79 штук закрыты вручную 13.11.2026 с причиной «Risk is tolerable» | Спайки не обновляются; их уведомления не заслоняют настоящие |
| Settings → Advanced Security | Dependabot security updates — включены; Grouped security updates — выключены | Исправление уязвимости, в том числе в косвенной зависимости, приходит готовой PR. Если по `spikes/` появится открытое уведомление, Dependabot откроет PR и на него: уведомление закрыть, PR закрыть |

Code scanning (CodeQL) задан файлом [`codeql.yml`](../../.github/workflows/codeql.yml), а не настройкой.

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

- Не запускать агента с `--dangerously-skip-permissions`, не убирать `ssh` и `git push` из `ask`, а merge PR и push в `main` — из `deny`.
- Не держать секреты в репозитории и не разрешать чтение `.env`.
- Не открывать в сессиях Claude Code сторонние продукты, их сайты и документацию API.
- Не давать Claude Code читать `docs/PLAN.md` и не вставлять из него текст в промпты.
