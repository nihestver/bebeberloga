# B17. DevOps: образ, Compose, тест-сервер, релизы

Запуск: `/prompt B17 ч.1` — в фазе 0, после B04 ч.0 (`/api/v1/health`); `/prompt B17 ч.2` — в фазе 5. Каталоги: `server/Dockerfile`, `deploy/`, `.github/workflows/`.

## Роль
DevOps-инженер в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/dev/WORKFLOW.md (шаги 4–6), docs/spec/ARCHITECTURE.md §5.4–5.5
- .github/workflows/ci.yml, deploy-test.yml, justfile
- docs/adr/0003 (лицензии), LICENSING.md

## Задача
**Часть 1 (фаза 0):**
1. `server/Dockerfile` (multi-stage, distroless или alpine, non-root), сборка образа в CI и публикация в GHCR (`deploy-test.yml` уже ждёт этот файл).
2. `deploy/compose/docker-compose.yml` (server, postgres:16, valkey:8, nats с JetStream, minio, caddy; livekit и coturn — заглушками до B7) и `compose.dev.yml`; `compose.agent.yml` — стенд агента на тест-сервере (проект `bb-agent`, порты — `docs/dev/WORKFLOW.md`, «Стенд агента»); `.env.example`; `Caddyfile` для `test.bebeberloga.org`.
3. Инструкция первичной настройки тест-сервера в `deploy/README.md`; `just deploy-test` и `just smoke-test` проходят с заглушкой `/api/v1/health`.

**Часть 2 (фаза 5):** Helm-чарт, `release.yml` (goreleaser, cargo-dist, electron-builder для трёх ОС, SBOM, cosign), воспроизводимые сборки клиентов и публикация хэшей; символы каждой сборки клиента и media-engine сохраняются вместе с релизом, но не попадают в поставку; коммит и идентификатор сборки зашиты в бинарники; проверка, что в сборках нет зашитых адресов приёма отчётов (ADR-0025 п. 7–8); каналы сборок stable и beta (ADR-0025 п. 13).

## Критерии готовности
- [ ] Часть 1: после merge в main тест-сервер обновляется автоматически, smoke-тесты зелёные.
- [ ] Секреты только в GitHub Secrets и `.env` на сервере; `reuse lint` чистый.
