# B3. Crypto-core (Rust)

Запуск: `/prompt B03`. Фаза 1. Зависит от B2 (и S1). Каталог: `crypto-core/`. Делать частями: одна сессия — одна группа функций из API CRYPTO.md.

## Роль
Rust-криптограф в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/protocol/CRYPTO.md (главный вход), docs/protocol/MESSAGES.md
- docs/spec/ARCHITECTURE.md §4, §6.4
- docs/adr/0003 (лицензия Apache-2.0), 0004
- crypto-core/STATUS.md, если есть

## Задача
1. Cargo workspace в корне (`Cargo.toml`), крейт `crypto-core` с API из CRYPTO.md: устройства и ключи, MLS-группы (создание, вступление, commit, обработка предложений external sender, пересоздание группы канала при рассинхроне — ADR-0019), шифрование и расшифровка конвертов, exporter → SFrame-ключи, коды безопасности и SAS, ключ восстановления, шифрование файлов, ключи истории и связки (ADR-0015), хранилище состояния (SQLCipher).
2. FFI: `napi-rs` для Electron (`crypto-core-node`), `wasm-bindgen` для веб-запасного варианта, `uniffi` — только проверка сборки (мобильные после 1.0).
3. Тесты T1…Tn из CRYPTO.md, `proptest` для сценариев групп, `cargo fuzz` для парсеров конвертов; `zeroize` для секретов.
4. `crypto-core/SECURITY-CHANGELOG.md` и `crypto-core/STATUS.md`.

## Критерии готовности
- [ ] `just lint-rust`, `just test-rust` зелёные на трёх ОС в CI; `cargo deny` чистый.
- [ ] Все тесты T из CRYPTO.md реализованы и проходят; fuzz-цели запускаются `just fuzz-crypto` (добавить рецепт).
- [ ] Ревью security-reviewer без открытых находок.
