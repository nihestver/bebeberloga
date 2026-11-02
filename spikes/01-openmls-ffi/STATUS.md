# S1 — спайк OpenMLS через FFI: состояние

Промпт: `docs/prompts/S1-openmls-ffi.md`. Ветка `spike/S1-openmls`. Отчёт — `REPORT.md`, черновик решения — `docs/adr/0016-spike-s1-openmls-ffi.md`.

## Сделано

- Каркас: отдельный Cargo workspace (`mls-core`, `node-ffi`, `uniffi-ffi`), `justfile` с рецептами спайка, `deny.toml`.
- `mls-core`: обёртка над openmls 0.9.2 — устройство, группа с `external_senders`, Add/Remove, Welcome, application message, exporter, политика к внешним предложениям (вход постороннего и GroupContextExtensions от сервера отвергаются), снимки состояния под feature `bench`; 11 сценарных тестов зелёные; clippy `-D warnings` чистый.
- Ревью субагентами: clean-room — pass по заимствованиям, замечания по лицензиям и формулировкам учтены; security — блокер «призрачное устройство» и ослабленная политика формата исправлены в коде, остальное записано в `REPORT.md` «Безопасность» и ADR-0016.
- `node-ffi` (napi-rs): один и тот же `.node` работает в Node 22 и в main-процессе Electron 33.4.11 — демо печатает расшифрованные сообщения в обе стороны; `package-lock.json` закреплён.
- `uniffi-ffi`: привязки Swift и Kotlin генерируются; Swift собран и выполнен на macOS-хосте; `aarch64-apple-ios` (с Xcode) и `staticlib` для `aarch64-linux-android` (без NDK) собираются.
- Бенчмарк criterion и таблица размеров для 10 / 100 / 1 000 устройств — в `REPORT.md`.
- Dev-контейнер x86_64 в корне репозитория (`.devcontainer/`): Rust + цель Android, Go, Node, pnpm, Android NDK r27c, Kotlin 2.1.20, JNA.

## Сломано / не получилось

- Запуск Kotlin и сборка `.so` для Android требуют dev-контейнера; образ собирается долго (эмуляция x86_64 без Rosetta, медленная сеть) — на момент PR не собран.
- `cargo deny check` и `cargo audit` чистые только с игнорами (обоснования в `deny.toml` и `.cargo/audit.toml`): advisory на `crypto-bigint` (P-256, не используется), `libcrux-kem` (не собирается), два unmaintained-крейта инструментов сборки.
- iOS-симулятор и wasm-bindgen не проверялись.
- Спайк не проверяет credential из KeyPackage в Add-предложениях сервера (роль AS на клиенте) — см. ADR-0016 п. 3.

## Дальше

- Дособрать dev-контейнер и прогнать в нём `just kotlin cross`; дописать раздел `REPORT.md` «Kotlin и Android».
- Решения для B02: проверка credential при Add от сервера, источник leaf index для Remove, доставка ratchet tree в больших каналах, окно past epochs, ротация KeyPackages (см. риски в `REPORT.md`).
- После merge: статус S1 в `docs/prompts/README.md` → «готово (PR #…)».

## Технические допущения

- Версии: `openmls =0.9.2`, `openmls_rust_crypto =0.6.0`, `openmls_basic_credential =0.6.0` (feature `clonable` для снимков), `napi =3.16.1`, `uniffi =0.32.2`, `criterion =0.8.2`; toolchain — `rust = "stable"` из `mise.toml` (1.99.1 на момент спайка).
- Хранилище MLS — только в памяти (`MemoryStorage` из `openmls_rust_crypto`); на диск не пишется, сетевых вызовов нет.
- Политика формата `PURE_CIPHERTEXT`: handshake-сообщения участников всегда зашифрованы; открытые предложения сервера под входящую политику не подпадают.
- uniffi — через proc-macro, без `core.udl`; сгенерированные привязки (`uniffi-ffi/generated/`) в git не хранятся.
- `SECURITY-CHANGELOG.md` для спайка не ведётся — прототип; находки security-ревью в `REPORT.md`.
- Спайк не входит в корневые `just lint`/`just test` и CI (отдельный workspace); проверки — `just` в каталоге спайка.
