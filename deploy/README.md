# Развёртывание

Здесь лежит всё, чтобы запустить инстанс Bebeberloga через Docker Compose: тот же набор файлов получают администраторы, на нём же работают тест-сервер и стенд агента. Состояние работ — [`STATUS.md`](STATUS.md). Helm-чарт и релизные сборки появятся в B17 ч.2.

Сейчас сервер — каркас: отвечает только `GET /api/v1/health`. Хранилище файлов (Garage, [ADR-0022](../docs/adr/0022-s3-storage-garage.md)), миграции базы и медиа (LiveKit, coturn) добавятся вместе с модулями сервера.

## Файлы

| Файл | Назначение |
|---|---|
| [`compose/docker-compose.yml`](compose/docker-compose.yml) | Инстанс целиком: `server`, `postgres`, `valkey`, `nats` (JetStream), `caddy` |
| [`compose/Caddyfile`](compose/Caddyfile) | TLS и прокси на сервер; домен берётся из `BB_DOMAIN` |
| [`compose/.env.example`](compose/.env.example) | Все переменные с пояснениями |
| [`compose/init-env.sh`](compose/init-env.sh) | Создаёт `.env` со случайными паролями; существующий не трогает |
| [`compose/compose.dev.yml`](compose/compose.dev.yml) | Оверлей для разработки: только хранилища, порты на `127.0.0.1` |
| [`compose/compose.agent.yml`](compose/compose.agent.yml) | Оверлей стенда агента и CI: образ из рабочего дерева, HTTP на 18080, лимиты памяти |
| [`../server/Dockerfile`](../server/Dockerfile) | Образ сервера: статический бинарник, distroless, пользователь без прав root |

## Установка инстанса

Нужны Docker Engine с Docker Compose v2, домен с записью DNS на сервер и открытые порты 80 и 443.

1. Скопируй на сервер в один каталог `docker-compose.yml`, `Caddyfile`, `.env.example` и `init-env.sh`.
2. Запусти `./init-env.sh` и впиши в `.env` свой домен: `BB_DOMAIN=chat.example.org`.
3. Запусти `docker compose up -d`. Caddy сам получит сертификат.
4. Проверь: `curl https://chat.example.org/api/v1/health` — в ответе `"status":"HEALTH_STATE_OK"`.

Что важно знать:

- **Пароли.** `init-env.sh` создаёт их случайными. Без пароля Compose не запустится: значений по умолчанию нет. После первого запуска пароль менять нельзя — он уже записан в томе данных.
- **Сети.** Наружу открыт только Caddy: 80 и 443/tcp. HTTP/3 выключен, порт 443/udp не нужен. PostgreSQL, Valkey и NATS живут во внутренней сети `backend`: портов на хосте у них нет, выхода в интернет тоже.
- **Данные** — в томах Docker `postgres-data`, `valkey-data`, `nats-data`, `caddy-data`, `caddy-config`. В `docker volume ls` у них префикс проекта: `bebeberloga_postgres-data`. `docker compose down` тома сохраняет, `docker compose down -v` — удаляет.
- **Обновление:** `docker compose pull && docker compose up -d`.
- **Правка `Caddyfile`.** После изменения файла пересоздай контейнер: `docker compose up -d --force-recreate caddy`. Файл смонтирован в контейнер, и без пересоздания Caddy продолжает работать со старым.
- **Откат:** в `.env` укажи образ нужной ревизии — `BB_SERVER_IMAGE=ghcr.io/nihestver/bebeberloga/server:<ревизия>` — и снова `docker compose up -d`.
- **Журналы:** `docker compose logs --tail=200 server`. Журнал каждого контейнера ограничен 50 МБ.
- **Память.** Лимиты `BB_MEM_*` из `.env.example` — потолок для каждого сервиса: память они не резервируют. На сервере с 2 ГБ задай их и добавь swap-файл 1–2 ГБ (команды — в разделе про тест-сервер).
- **Valkey** при старте предупреждает про `vm.overcommit_memory`. Чтобы фоновое сохранение не падало при нехватке памяти, включи на хосте `sysctl vm.overcommit_memory=1`.

Резервные копии и восстановление появятся вместе с админ-CLI (B16).

## Ответственность оператора

Запуская инстанс для других людей, ты становишься его оператором и отвечаешь за него по законам своей страны — в том числе за данные пользователей и за работу сервиса обмена сообщениями. Проект даёт только код и не получает от инстанса никаких данных.

По умолчанию инстанс собирает как можно меньше ([ADR-0025](../docs/adr/0025-diagnostics-and-reports.md)):

- регистрация — по приглашениям (политику меняет админ-CLI, B16);
- приём отчётов об ошибках выключен: у клиентов нет кнопки «Отправить», отчёты сохраняются файлами;
- Caddy не ведёт журнал доступа, сервер не пишет в журнал IP-адреса, параметры пути и содержимое.

Если открываешь регистрацию для всех, включаешь приём отчётов или журнал с IP-адресами — заранее выясни, какие требования это создаёт в твоей юрисдикции, и опиши пользователям, какие данные хранятся и сколько.

## Тест-сервер: первая настройка

Тест-стенд (Compose-проект `bb-test`, пользователь `deploy`, каталог `~/bebeberloga`) обновляет CI после каждого merge в `main` — [`deploy-test.yml`](../.github/workflows/deploy-test.yml). Один раз его нужно подготовить руками. Сервер, пользователи, межсетевой экран, SSH-ключи и DNS описаны в [`docs/dev/WORKFLOW.md`](../docs/dev/WORKFLOW.md#тест-сервер); ниже — то, что относится к самому стенду.

1. **Swap.** На сервере 2 ГБ памяти, а на нём работают два стенда и собирается образ. От root, один раз, файл на 1–2 ГБ:

   ```bash
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```

2. **Файлы.** С Mac, из корня репозитория:

   ```bash
   scp deploy/compose/{docker-compose.yml,Caddyfile,.env.example,init-env.sh} bb-test:bebeberloga/
   ```

3. **`.env`.** На сервере от пользователя `deploy`:

   ```bash
   cd ~/bebeberloga && ./init-env.sh
   ```

   Затем в `.env` задай `BB_DOMAIN=test.bebeberloga.org`, `COMPOSE_PROJECT_NAME=bb-test` и раскомментируй лимиты `BB_MEM_*` (в сумме 608 МБ). Столько же у стенда агента — вместе 1,2 ГБ из 2 ГБ. Сборка образа и `just remote compose-smoke` (ещё до 608 МБ) под эти лимиты не попадают: их и закрывает swap.

4. **GitHub.** В environment `test` репозитория — секреты `TEST_SSH_KEY`, `TEST_KNOWN_HOSTS`, `TEST_SSH_HOST` и переменная `TEST_BASE_URL` (WORKFLOW, раздел «Тест-сервер»). Пока секретов нет, `deploy-test.yml` пропускает сборку и выкатку.

5. **Первый образ.** После merge `deploy-test.yml` соберёт образ и выложит его в GHCR как `ghcr.io/nihestver/bebeberloga/server`. Новый пакет GHCR по умолчанию приватный, и сервер не сможет его скачать: шаг выкатки упадёт с `unauthorized` или `denied`. Открой пакет: GitHub → профиль → Packages → `bebeberloga/server` → Package settings → Change visibility → Public. Затем запусти `deploy-test` заново: Actions → deploy-test → Run workflow.

6. **Проверка.** `just smoke-test` — smoke-тесты по `https://test.bebeberloga.org`; `just test-logs server` — журнал сервера.

Дальше стенд обновляется сам. Workflow выкатывает ровно тот коммит, который проверил `ci`: копирует на сервер `docker-compose.yml` и `Caddyfile` из этого коммита (`.env` не трогает), тянет образ, перезапускает сервисы, прогоняет smoke-тесты и сверяет версию в ответе `/api/v1/health` с собранной. Выкатывается только текущая вершина `main`: если к началу выкатки в `main` уже есть более новый коммит, прогон пропускается — стенд обновит прогон этого коммита. Вручную то же самое делает владелец командой `just deploy-test`; агент тест-стенд не выкатывает.

Если в `.env` на сервере закреплён `BB_SERVER_IMAGE` (откат), сверка версии будет падать, пока строку не уберут, — так откат не забывается.

## Стенд агента

Отдельный Compose-проект `bb-agent` на том же сервере (WORKFLOW, раздел «Стенд агента»): образ сервера собирается из рабочего дерева, наружу — только HTTP на порту 18080, у каждого контейнера жёсткий лимит памяти (в сумме до 608 МБ).

```bash
just remote-up                                         # скопировать дерево, собрать образ, поднять стенд
just smoke-test http://test.bebeberloga.org:18080      # ожидается HEALTH_STATE_OK
just remote-logs server
just remote-down                                       # тома сохраняются
```

`.env` стенда создаёт `init-env.sh` на сервере при первом `just remote-up`; на Mac он не копируется, `rsync` его не перезаписывает.

`just compose-smoke` делает то же в одну команду там, где запущен: собирает образ, поднимает стек отдельным проектом `bb-smoke` на `127.0.0.1:18089`, прогоняет smoke-тесты и удаляет стек вместе с томами. Его же запускает job `deploy` в CI. На тест-сервере он добавляет ещё до 608 МБ к двум стендам — запускай его там, когда стенд агента остановлен, или полагайся на CI.

## Локальная разработка

```bash
just dev-up       # PostgreSQL, Valkey и NATS; порты 5432, 6379, 4222 на 127.0.0.1
just dev-server   # сервер с хоста; адреса и пароли берутся из deploy/compose/.env
just dev-down
```

Если порт занят, задай `BB_DEV_POSTGRES_PORT`, `BB_DEV_VALKEY_PORT` или `BB_DEV_NATS_PORT` в `deploy/compose/.env`.
