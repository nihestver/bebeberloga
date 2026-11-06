# STATUS — развёртывание (B17)

Модуль: `server/Dockerfile`, `deploy/`, `.github/workflows/`. Промпт — `docs/prompts/B17-devops.md`. Ветка `feat/B17-devops-image-compose` (часть 1). Как пользоваться — [`README.md`](README.md).

## Сделано (2026-11-06, часть 1)

- **Образ сервера** — `server/Dockerfile` и `server/Dockerfile.dockerignore`. Сборка на `golang:1.27-alpine`, итог на `gcr.io/distroless/static-debian13:nonroot`: один статический бинарник (`CGO_ENABLED=0`, `-trimpath`), пользователь 65532, `ENTRYPOINT bebeberloga-server`, `CMD serve`. Версия приходит аргументом `VERSION` в `buildinfo` (в контексте нет `.git`). Кросс-компиляция под amd64 и arm64 без эмуляции. Контекст сборки — корень репозитория, в него попадает только `server/` без тестов, документации, `.env`, ключей и `tmp/`.
- **`deploy/compose/docker-compose.yml`** — `server`, `postgres`, `valkey`, `nats` (JetStream), `caddy`.
  - Сети: `edge` (Caddy ↔ сервер, выход сервера наружу) и `backend` (`internal: true`): у хранилищ нет ни портов на хосте, ни выхода в интернет. Наружу — только 80 и 443/tcp у Caddy.
  - Пароли PostgreSQL, Valkey и NATS обязательны (`${VAR:?}`), значений по умолчанию нет; Valkey и NATS без пароля не принимают соединения.
  - `server`, `nats`, `caddy`: файловая система только для чтения, `cap_drop: ALL` (у Caddy остаётся `NET_BIND_SERVICE`); у всех сервисов `no-new-privileges`, перезапуск `unless-stopped`, ротация журнала.
  - `server` стартует после `service_healthy` хранилищ; `migrate` не вызывается (заглушка до B04).
  - Лимиты памяти — переменные `BB_MEM_*`, по умолчанию лимита нет.
- **Оверлеи.** `compose.dev.yml`: только хранилища, порты на `127.0.0.1`, `server` и `caddy` под профилем `full`. `compose.agent.yml`: образ из рабочего дерева под своим именем, Caddy по HTTP на 18080 (`ports: !override`), жёсткие лимиты памяти — в сумме 608 МБ.
- **`Caddyfile`** — адрес сайта из `BB_DOMAIN`, прокси на `server:8080` с повтором соединения до 5 с на время перезапуска сервера. HTTP/3 выключен (`servers { protocols h1 h2 }`), порт 443/udp не публикуется.
- **`.env.example` и `init-env.sh`** — `.env` со случайными паролями (48 шестнадцатеричных символов), права `0600`; существующий файл не перезаписывается. На стенде агента `.env` создаётся на сервере и на Mac не попадает.
- **CI.** Job `deploy` в `ci.yml` (в `ci-ok`): `shellcheck` для `deploy/compose/*.sh`, `just lint-deploy test-deploy`, затем `just compose-smoke` — сборка образа, запуск стека, smoke-тесты через Caddy; запускается и при правке `ci.yml` и `deploy-test.yml`. Job `go` дополнительно собирает сервер под linux/amd64 и linux/arm64 (`just build-cross`).
- **`deploy-test.yml`.**
  - Образ amd64 + arm64 в GHCR с тегами `:main` и `:<ревизия>`.
  - Выкатка коммита, который проверил `ci` (`head_sha`), рецептом `just deploy-test`; затем smoke-тесты и сверка версии на стенде с собранной.
  - Запуск только для зелёного `ci` от `push` в `main` этого репозитория (`event`, `head_branch`, `head_repository.full_name`); ручной — только с `main`.
  - Выкатывается только текущая вершина `main`: прогон более старого коммита пропускается, чтобы стенд не откатился назад.
  - `concurrency: deploy-test` — выкатки идут по одной и не отменяют друг друга.
- **`justfile`.** Новые рецепты `image`, `lint-deploy` (в `lint`), `test-deploy` (в `test`), `compose-smoke`, `build-cross`. `deploy-test` копирует `docker-compose.yml` и `Caddyfile` из git-ревизии; `remote-up` создаёт `.env` и ждёт готовности; оба пересоздают `caddy`, если `Caddyfile` изменился. `dev-up` и `dev-server` работают с `deploy/compose/.env`; `smoke-test` повторяет запрос, пока стенд поднимается; `remote-check` показывает версии Docker, Compose и buildx.
- **Прочее.** `hurl` в `mise.toml`; блок `docker-compose` в Dependabot; [ADR-0022](../docs/adr/0022-s3-storage-garage.md) (Garage вместо MinIO); `deploy/README.md`; правки `docs/dev/WORKFLOW.md`.

### Проверено

| Что | Как | Результат |
|---|---|---|
| Стек на стенде агента | `just remote-up`, `just smoke-test http://test.bebeberloga.org:18080` | `200`, `HEALTH_STATE_OK`, `postgres`, `valkey`, `nats` = OK, версия `dev-<ревизия>-dirty` |
| Рецепт CI | `just remote compose-smoke` | сборка, запуск на `127.0.0.1:18089`, smoke-тест, удаление стека — успешно |
| Кросс-сборка | `just build-cross`; `just remote 'image … linux/arm64'` | amd64 и arm64 собираются; образ `linux/arm64`, пользователь 65532 |
| Защита контейнеров | `docker inspect` на стенде | пользователь, read-only, capabilities, лимиты памяти и сети — как описано выше |
| Пароли хранилищ | `valkey-cli ping` без пароля; `/varz` у NATS | `NOAUTH`; `auth_required: true` |
| Сеть `backend` | запрос наружу из контейнера `nats` | `Network unreachable` |
| HTTP/3 выключен | журнал Caddy после `just remote-up` | `protocols: h1, h2` |
| Изменённый `Caddyfile` применяется | `just remote-up` после правки файла и повторно без правки | `caddy` пересоздан один раз; при повторе — нет |
| `init-env.sh`, Compose-файлы | `just test-deploy`, `just lint-deploy` (Mac и стенд, где есть настоящий `.env`) | успешно |
| Копирование файлов выкатки | `git archive … \| tar --strip-components=2` в локальный каталог | файлы совпадают |
| Скрипты оболочки | `shellcheck` 0.11.0 `-S warning` для `deploy/compose/*.sh` и всех `*.sh` репозитория | замечаний нет |
| Go-тесты сервера | `just remote test-go` | успешно |

Не проверено до merge: `deploy-test.yml` целиком (запускается только на `main` и требует настройки тест-стенда владельцем) и job `deploy` на раннере GitHub (первый прогон — в PR).

Ревью `cleanroom-reviewer` (2026-11-06): **clean-room review: pass**; находки исправлены по решению владельца. При ревью случился инцидент стены — запись в `docs/cleanroom/LOG.md`.

### Технические решения

- **У `server` нет healthcheck контейнера** (решение владельца, 2026-11-06): в distroless нет оболочки и `curl`. Готовность проверяют smoke-тесты с повторами.
- **HTTP/3 выключен, 443/udp закрыт** (решение владельца, 2026-11-06): API и gateway работают по HTTP/1.1 и HTTP/2, открытых портов меньше.
- **Caddy не проверяет upstream активно** — отступление от плана. При одном сервере проверка ничего не балансирует, а ответ `503` от `/api/v1/health` заменяла бы пустым `503` от Caddy: не видно, какая зависимость недоступна, и весь API закрывается из-за одной зависимости.
- **`Caddyfile` применяется пересозданием контейнера.** Файл смонтирован в контейнер, и Compose не видит, что он изменился: без пересоздания Caddy работает со старым файлом. `deploy-test` и `remote-up` сверяют файл в контейнере с файлом на диске и пересоздают `caddy` только при различии. Администратору после своей правки нужен `docker compose up -d --force-recreate caddy` (README).
  - Других файлов, смонтированных в контейнеры, нет: `Caddyfile` — единственный. `nats.conf` не существует — NATS получает настройки флагами в `docker-compose.yml`, а их изменение Compose видит сам и пересоздаёт контейнер. Когда B06 добавит `nats.conf`, ему нужна такая же сверка (или вариант ниже).
  - **Вариант на потом: монтировать каталог и вызывать `caddy reload`.** `Caddyfile` переезжает в свой каталог (`deploy/compose/caddy/`), который монтируется в `/etc/caddy` целиком: каталог, в отличие от одиночного файла, показывает контейнеру заменённый файл сразу. После копирования рецепт вызывает `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` — Caddy перечитывает конфигурацию без перезапуска контейнера и сверка не нужна. Цена: меняется раскладка файлов на серверах (отдельный каталог нужен, чтобы в Caddy не попал `.env`), список копируемых файлов и README; ошибку в новом `Caddyfile` `reload` отвергнет, и Caddy останется на старой конфигурации — рецепт должен это показать. В ч.1 не сделано: пересоздание проще, а на стенде секунда простоя Caddy не важна. Для `nats.conf` приём тот же, перечитывание — сигналом (`docker compose kill -s HUP nats`).
- **NATS настроен флагами, без `nats.conf`** — отступление от плана: на один файл меньше копировать на сервер. Файл понадобится для лимитов JetStream (B06).
- **`livekit` и `coturn` — комментарий в Compose-файле, а не сервисы под профилем `media`** — отступление от плана. Образы не удалось скачать на стенд и проверить, а сервис без конфигурации под тегом `latest` в файле для администраторов хуже, чем пустое место. Имена сервисов и порты записаны для B07.
- **Версии образов закреплены** по журналам стенда: PostgreSQL 16.15, Valkey 8.1.11, NATS 2.15.2, Caddy 2.11.9. Обновления приносит Dependabot; мажорные версии PostgreSQL и Valkey отключены. Блока `docker` для `server/Dockerfile` нет: тег `golang:1.27-alpine` следует за `mise.toml` и `go.mod`, а у distroless нет версии в теге.
- **`lint-deploy` не запускает `docker build --check`** — отступление от плана: проверке нужен реестр, а Docker Hub с Mac не отвечает. Dockerfile проверяет настоящая сборка в `compose-smoke`.
- **Лимиты памяти — потолок для сервиса, не резерв.** На стенде агента они жёсткие (`compose.agent.yml`), у тест-стенда — `BB_MEM_*` в его `.env`, у администраторов по умолчанию лимита нет.
- **`compose-smoke`** использует отдельный проект `bb-smoke`, адрес `127.0.0.1:18089` и своё имя образа, чтобы не мешать стенду агента на том же Docker и не открывать порт наружу.
- **`just dev-server` передаёт серверу только три адреса подключения.** Остальные переменные из `.env` не экспортируются: переменные развёртывания (`BB_DOMAIN`, `BB_MEM_*`) делят префикс `BB_` с конфигом сервера.
- **Версия сборки** вне релиза — `dev-<12 символов ревизии>`, как у `buildinfo`; для рабочего дерева с правками — с суффиксом `-dirty`.

### Образы и инструменты: лицензии

Отдельные сервисы и инструменты сборки, не зависимости кода (`LICENSING.md`).

| Что | Лицензия | Роль |
|---|---|---|
| `golang:1.27-alpine` | BSD-3-Clause (Go) | только этап сборки |
| `gcr.io/distroless/static-debian13` | Apache-2.0; пакеты Debian — свои свободные лицензии | основа образа сервера |
| `postgres:16.15` | PostgreSQL License | ADR-0002 |
| `valkey/valkey:8.1.11-alpine` | BSD-3-Clause | ADR-0002 |
| `nats:2.15.2-alpine` | Apache-2.0 | ADR-0002 |
| `caddy:2.11.9-alpine` | Apache-2.0 | ARCHITECTURE §5.5 |
| Docker Compose, buildx, BuildKit | Apache-2.0 | сборка образа и запуск стека |
| `hurl` 8 | Apache-2.0 | smoke-тесты |
| `jq` | MIT | сверка версии в `deploy-test.yml` |
| `docker/setup-buildx-action`, `docker/login-action`, `docker/build-push-action` | Apache-2.0 | сборка образа в CI |
| `jdx/mise-action` | MIT | установка `hurl` в CI |

## Сломано / известные ограничения

- **Память тест-сервера.** Лимиты тест-стенда (608 МБ с рекомендованными `BB_MEM_*`) и стенда агента (608 МБ) — вместе 1,2 ГБ из 1,9 ГБ. `just remote compose-smoke` добавляет ещё до 608 МБ, а сборка образа под лимиты не попадает вовсе. Пока на сервере нет swap, одновременная сборка и два стенда могут упереться в память; swap-файл — в первой настройке (README).
- **`main` красный — стенд стоит.** Если `ci` самого нового коммита упал, более старый зелёный коммит не выкатывается: стенд остаётся на прежней версии до следующего зелёного `main`.
- **Docker Hub с Mac разработчика не отвечает** (2026-11-06): `just image` и `just compose-smoke` локально зависают на загрузке образов. Проверка — `just remote compose-smoke`.
- **NATS считает лимит памяти JetStream от памяти хоста** (1,45 ГБ при лимите контейнера 96 МБ) и предупреждает о пароле открытым текстом. Пока потоков JetStream нет, это не мешает.
- **Valkey** работает без `maxmemory` и предупреждает про `vm.overcommit_memory` на хосте (README).
- **Пароли Valkey и NATS передаются в командной строке** и видны в `docker inspect` тем, у кого есть доступ к Docker. `.env` доступен тем же людям.
- **Адрес для ACME не задаётся**: Caddy получает сертификат без почты.
- **`just dev-server` вызывает `air`**, который не настроен (B04).

## Дальше

- **Владелец:**
  - первая настройка тест-стенда по [`README.md`](README.md#тест-сервер-первая-настройка), включая swap-файл, — после неё закрывается критерий «после merge тест-сервер обновляется автоматически»;
  - `just deploy-test` — в `deny` в `.claude/settings.json` (скилл `/deploy-test` удалён: выкатку с Mac владелец запускает из терминала);
  - хвосты ADR-0022: в промптах B06 п. 3 и B17 ч.1 п. 2 всё ещё MinIO.
- **Контур A:** ARCHITECTURE §5 (схема), §5.4 и §6.1 — «MinIO или Garage» → Garage (ADR-0022).
- **Подкоманда `bebeberloga-server healthcheck`** (B04 или B16): запрос к своему `/api/v1/health` с кодом выхода. С ней в Compose появится `healthcheck` у `server`, а `caddy` и `--wait` будут ждать готовности, не только запуска.
- **B04:** вызов `migrate` в Compose перед `server`; `air` для `just dev-server` — сначала проверить лицензию (GPL-3.0; инструмент разработки, в сборку не входит) по `LICENSING.md`.
- **B06:** Garage с шагом инициализации (ADR-0022); `nats.conf` с лимитами JetStream и правами; `maxmemory` у Valkey; доверенный прокси для `X-Forwarded-For`.
- **B07:** сервисы `livekit` и `coturn`, порты из WORKFLOW (у стенда агента — свои, записаны в `compose.agent.yml`).
- **B09:** раздача веб-клиента через Caddy и заголовки безопасности (HSTS, CSP).
- **B16:** `config.example.yaml`, резервные копии.
- **B17 ч.2:** Helm-чарт, `release.yml`, образы по digest, тег релиза вместо `:main` по умолчанию, подпись и SBOM образа.
