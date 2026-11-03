# S1 — спайк: OpenMLS через FFI. Отчёт

Промпт: [`docs/prompts/S1-openmls-ffi.md`](../../docs/prompts/S1-openmls-ffi.md). Черновик решения: [ADR-0016](../../docs/adr/0016-spike-s1-openmls-ffi.md). Код спайка — прототип, не продуктовый.

## Версии

| Компонент | Версия | Лицензия |
|---|---|---|
| `openmls` | =0.9.2 (2026-10-22) | MIT |
| `openmls_rust_crypto`, `openmls_basic_credential`, `openmls_traits` | =0.6.0 | MIT |
| `napi` / `napi-derive` / `napi-build` | =3.16.1 / =3.7.0 / =2.6.0 | MIT |
| `uniffi` | =0.32.2 | MPL-2.0 |
| `criterion` | =0.8.2 | Apache-2.0 OR MIT |
| Rust | stable 1.99.1 (`mise.toml`: `rust = "stable"`) | — |
| Node | 22.23.4 (mise) | — |
| Electron | 33.4.11 | MIT |
| Xcode / iOS SDK | 26.6 / 26.5 | — |
| Android NDK | r30 (30.0.16248370, dmg с dl.google.com, SHA-256 сверен) | Android SDK License Agreement; инструмент сборки, в поставку не входит |
| Kotlin compiler | 2.4.21 (zip с релизов Kotlin, SHA-256 сверен) | Apache-2.0 |
| JDK | Oracle 25.0.3 LTS (уже стояла на хосте) | — |
| JNA (runtime-зависимость Kotlin-привязок uniffi) | 5.14.0 | Apache-2.0 OR LGPL-2.1-or-later — используем по Apache-2.0 |
| Хост | MacBook Pro, Apple M4 Pro, 24 ГБ, macOS 26.4.1 | — |

Транзитивный граф Rust (282 крейта) — MIT, Apache-2.0, BSD-2/3, ISC, MPL-2.0 (`hpke-rs`), Unlicense, CC0 и Unicode-3.0 (`unicode-ident`, добавлена в `LICENSING.md`); проверка `cargo deny` — см. ниже.

## Что сделано и что получилось

| Пункт задачи | Результат | Как проверить |
|---|---|---|
| 1. Крейт на `openmls`: группа, Add по KeyPackage, commit, Welcome, application message, external sender (Add/Remove), exporter | ✅ `mls-core`: 10 тестов зелёные, включая отказ чужого external sender, отказ предложения входа от постороннего, отказ GroupContextExtensions от сервера, отказ commit-а устаревшей эпохи, PCS после Remove, replay-защиту | `just test` в каталоге спайка |
| 2. napi-rs + Node 22 | ✅ `node-ffi`: `.node` без npm-зависимостей; скрипт печатает расшифрованные сообщения в обе стороны и совпадение exporter-секрета | `just node` |
| 2. Electron 33 | ✅ тот же `.node` в main-процессе Electron 33.4.11 (Node 20.18.3 внутри — другой ABI, Node-API не зависит от него); печатает те же сообщения | `just electron` |
| 3. uniffi → Swift | ✅ привязка сгенерирована, скомпилирована `swiftc` на macOS-хосте, вызов проходит (два устройства, одно сообщение) | `just swift` |
| 3. uniffi → iOS aarch64 | ✅ `cargo build --target aarch64-apple-ios` с SDK Xcode: `.a` и `.dylib` собираются. Симулятор и iOS-приложение не проверялись (клиент iOS не разрабатывается, ADR-0010) | `just cross` с `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` |
| 3. uniffi → Kotlin / Android aarch64 | ✅ привязка Kotlin скомпилирована `kotlinc` и выполнена на JVM macOS (два устройства, одно сообщение); `.so` для `aarch64-linux-android` собран с NDK r30; запуск на устройстве или эмуляторе не проверялся — см. раздел «Kotlin и Android» | `just kotlin`, `just cross-android` |
| 4. Бенчмарк criterion 10 / 100 / 1 000 | ✅ таблица ниже | `just bench`, `just sizes` |

## Замеры

Хост: Apple M4 Pro, release-профиль, criterion (20 выборок по 10 с), каждая итерация — со снимка состояния. Группа на N устройств построена одним commit-ом создателя (N − 1 Add); у дерева пустые родительские узлы — это худший случай для размера commit-а и Welcome.

### Время

| N устройств | commit Add одного устройства (у отправителя) | обработка этого commit-а получателем (включая merge) | вход нового устройства по Welcome |
|---|---|---|---|
| 10 | 0,54 мс | 0,30 мс | 0,38 мс |
| 100 | 1,46 мс | 0,62 мс | 2,8 мс |
| 1 000 | 8,6 мс | 3,3 мс | 28,8 мс |

### Размеры

| N устройств | состояние участника (хранилище, байт) | KeyPackage | commit Add (+1) | Welcome (+1) | application message (16 байт полезной нагрузки) |
|---|---|---|---|---|---|
| 10 | 17 337 | 280 | 1 533 | 2 607 | 159 |
| 100 | 106 278 | 280 | 9 018 | 19 018 | 159 |
| 1 000 | 971 302 | 280 | 82 931 | 182 121 | 159 |

Выводы по числам:

- Время всех операций для 1 000 устройств — единицы и десятки миллисекунд; для лимита канала в 2 000 участников (ADR-0005) и 5 000 листьев (ARCHITECTURE §4.3) запас есть даже с учётом телефонов (в 5–10 раз медленнее).
- Welcome и commit растут линейно с N, потому что при пустых родительских узлах путь коммитера шифруется на все листья соседних поддеревьев. После нескольких self-update родители заполняются, и commit уменьшается до O(log N). Welcome при `use_ratchet_tree_extension` всегда несёт дерево целиком (~180 байт на лист).
- Состояние участника ~1 КБ на лист — для SQLCipher-базы клиента несущественно.

## Что выяснилось про API (важно для B02/B03)

- **Политика формата.** Предложения external sender — всегда `PublicMessage` (у сервера нет ключей). Входящая политика формата к внешним сообщениям не применяется (`MlsGroup` пропускает проверку для `ProtocolMessage::is_external()`), поэтому группа живёт с `PURE_CIPHERTEXT`: handshake участников только зашифрован. Первая версия спайка ослабляла политику до `MIXED_CIPHERTEXT` — security-ревью показало, что это не нужно и лишь позволяет участнику раскрыть серверу содержимое своих commit-ов.
- **External senders.** Extension `external_senders` ставится при создании группы; предложение от неизвестного ключа и предложение в группу без extension отвергаются библиотекой. Сервер указывает свой индекс в extension (0) и текущую эпоху — обе величины он знает как DS. Библиотека проверяет **только подпись сервера**: credential из KeyPackage в Add-предложении (подпись ключом идентичности пользователя, право быть в канале) должен проверять клиент до `store_pending_proposal` — в спайке этого нет, в продукте обязательно (ADR-0016 п. 3).
- **Remove по leaf index.** Remove-предложению нужен индекс листа; в спайке его сообщает участник (`leaf_index`). При зашифрованных commit-ах и GroupInfo сервер дерева не видит — откуда DS берёт индекс, спецификация не говорит; вопрос для B02/S4 (ADR-0016 п. 4).
- **Собственные commit-ы от DS.** `openmls` 0.9 возвращает `ProcessedMessageContent::OwnPendingCommit` (открытый commit) и `OwnPrivateMessage` (зашифрованный): если сервер рассылает commit и автору, клиент обязан обработать оба варианта. Проще не возвращать автору его сообщения.
- **Конкурентные commit-ы.** Сервер читает id группы и эпоху из заголовка (`message_header`) без ключей; проигравший коммитер делает `clear_pending_commit` и повторяет в новой эпохе — проверено тестом.
- **Replay.** Повторная подача того же `PrivateMessage` отвергается (`SecretTree`) — ошибка, а не тихое дублирование. Открытые предложения сервера в той же эпохе принимаются повторно (дубли схлопываются при commit); подпись сервера покрывает group_id, эпоху, отправителя и предложение, но не GroupContext; между эпохами предложение отвергается. Дубли сообщений DS и клиент отсекают по UUIDv7 конверта.
- **Что видит сервер.** В `PrivateMessage` открыты group_id, эпоха, тип содержимого и `authenticated_data` (в AAD ничего секретного); длина видна точно — `padding_size` по умолчанию 0, 16 байт полезной нагрузки дают 159 байт шифртекста, паддинг — вопрос B02. В Welcome открыт `KeyPackageRef` каждого новичка; в предложениях сервера — KeyPackage или leaf index целиком. Всё в рамках модели угроз ARCHITECTURE §4.1 (метаданные не защищаются).
- **Состояние.** `MlsGroup` живёт в `StorageProvider`; для снимков в бенчмарке хватило копии `MemoryStorage` и `MlsGroup::load`. Продуктовая реализация — трейт поверх SQLCipher.
- **uniffi.** Proc-macro без UDL достаточно: `#[derive(uniffi::Object)]`, `#[uniffi::export]`, `uniffi::Record`, `uniffi::Error`. Объект держит `Mutex<Device>`; все методы `&self`. Kotlin-генератор хочет `ktlint` для форматирования — без него только предупреждение (`--no-format`).
- **napi-rs.** Класс с `&mut self`-методами и `Buffer` работает без `@napi-rs/cli`: `napi-build` + копирование `.dylib` в `.node`.

## Безопасность: ревью спайка

Субагент `security-reviewer` проверил спайк с собственными PoC-тестами поверх `s1-mls-core`. Что найдено и что с этим сделано:

| № | Находка | Статус |
|---|---|---|
| Б1 | **Призрачное устройство.** Первая версия обёртки коммитила любое внешнее предложение, включая `NewMemberProposal` — openmls принимает его в любой группе, и посторонний, зная id группы и эпоху, входил в группу и читал сообщения | Исправлено в спайке: такое предложение отвергается до постановки в очередь (`Error::Unauthorized`), тест `self_join_proposal_from_outsider_is_rejected`. Полная политика клиента (проверка credential, права на канал) — ADR-0016 п. 3, B02/B03 |
| В1 | `MIXED_CIPHERTEXT` не нужна: входящая политика к внешним сообщениям не применяется | Исправлено: `PURE_CIPHERTEXT`, режим один, тест на открытый handshake убран |
| В2 | External sender мог прислать GroupContextExtensions (например, дописать свой второй ключ в `external_senders`), и спайк его коммитил | Исправлено в спайке: от `Sender::External` принимаются только Add и Remove, тест `external_sender_may_only_add_and_remove`. Проверка `external_senders` при входе по Welcome — B02 |
| В3 | Remove от сервера теряется, если другое устройство первым закоммитит своё в той же эпохе (очередь предложений очищается при merge); удаляемое устройство может оттягивать удаление | Дизайн DS: ADR-0016 п. 4 — сервер повторяет Remove в каждой эпохе и не принимает commit от удаляемого устройства; B02 |
| В4 | При зашифрованных commit-ах сервер не знает дерева: ни leaf index для Remove, ни лимита листьев | Открытый вопрос ADR-0016 п. 4; B02/S4 |
| В5 | Заголовок `PrivateMessage` для DS не аутентифицирован; `OwnPrivateMessage` — неаутентифицированная подсказка; `OwnPendingCommit` при зашифрованных handshake недостижим | Исправлено в спайке (`OwnPendingCommit` → ошибка, свой commit только по подтверждению DS); формулировки ADR п. 4 |
| В6 | Участник опознаётся по отображаемому имени (`credential_name`, `leaf_index`) | В спайке оставлено с пометкой; B03 — по проверенному ключу идентичности |
| В7 | Ключи в `MemoryStorage` без zeroize; `snapshot()` копирует приватные ключи и создаёт второй экземпляр листа; секреты уходят в FFI обычными буферами | `snapshot` и `fixture` вынесены под feature `bench`; требования к B03 — ADR-0016 «Последствия», риск 0 ниже |
| З1–З8 | Тексты ошибок с фрагментами входа; верхняя граница `Lifetime` KeyPackage не проверяется (`validate` смотрит только на текущее время); паддинг; паники в napi роняют процесс; `Buffer` без копии; Electron 33 вне поддержки; нет lockfile | Записаны в ADR-0016 «Последствия» и в риски |

Для `spikes/` `SECURITY-CHANGELOG.md` не ведётся (правило касается `crypto-core/`, `server/internal/mls/`, `media-engine/`); первая запись журнала crypto-core в B03 сошлётся на этот раздел.

## Electron

`just electron` → `npm ci` по `package-lock.json` (electron 33.4.11, граф MIT/ISC/BSD/Apache) и запуск `electron-main.cjs` без окна:

```
electron 33.4.11, node 20.18.3
версия openmls: 0.9.2
эпоха после добавления: A=1 B=1
участники у B: alice-laptop, bob-phone
B получил (174 байт шифртекста) от alice-laptop: привет от ноутбука
A получил (174 байт шифртекста) от bob-phone: привет от телефона
exporter-секрет совпадает: true
```

Один и тот же `s1.node`, собранный против Node-API, работает в Node 22.23 и в Electron 33 с Node 20.18 внутри — ABI Node не важен. Нюанс окружения: если в процессе задана `ELECTRON_RUN_AS_NODE=1` (так запускает дочерние процессы сам Electron, в том числе Claude Code в VS Code), `electron` стартует как обычный node и `require("electron")` не даёт `app`; рецепт снимает переменную. Electron 33 к концу 2026 вне поддержки — продукту нужна поддерживаемая ветка (ADR-0007 допускает «33+»).

## Kotlin и Android на macOS

Всё нативно на Apple Silicon, без Homebrew и без контейнера: компилятор Kotlin — zip-архив в `~/.local/share/kotlinc-2.4.21`, NDK — каталог из dmg в `~/.local/share/android-ndk-r30` (бинарники NDK — universal, arm64 выполняется без Rosetta). Скрипты находят их там сами; другое место задаётся через `KOTLINC` и `ANDROID_NDK_HOME`.

`just kotlin` — та же библиотека `libs1_uniffi_ffi.dylib`, привязка uniffi, `Main.kt`, JNA 5.14.0 (jar проверяется по SHA-1 с Maven Central):

```
openmls 0.9.2 через uniffi/Kotlin: a-android -> привет из Kotlin
участники: a-android, b-phone, эпоха 1
```

JDK 25 предупреждает о `System::load` из JNA — скрипт запускает `java --enable-native-access=ALL-UNNAMED`; в Android-приложении это не нужно, библиотеку грузит рантайм.

`just cross-android` — `cargo build --release --target aarch64-linux-android` с линкером `aarch64-linux-android24-clang` из NDK:

| Артефакт | Размер |
|---|---|
| `libs1_uniffi_ffi.so` (release, `debug = 1`) | 36,1 МБ |
| тот же после `llvm-strip` | 3,1 МБ |

`.so` зависит только от `libc.so` и `libdl.so` (C-кода в графе нет), экспортирует 28 функций `uniffi_s1_*`. Запуск на устройстве или эмуляторе и упаковка в AAR не проверялись — это B14 (Android-клиент после 1.0, ADR-0010).

## Проверки зависимостей

`cargo deny check`: licenses ok, bans ok, sources ok; advisories ok после трёх игноров с обоснованием в `deny.toml`:

| Advisory | Крейт | Почему не блокирует |
|---|---|---|
| RUSTSEC-2026-0387 (timing) | `crypto-bigint` 0.5.5 ← `p256` ← `hpke-rs-rust-crypto` ← `openmls_rust_crypto` | P-256 нужен ciphersuite 0x0002; наш 0x0001 — X25519/Ed25519, код не выполняется. Исправление придёт с `hpke-rs` на `elliptic-curve` 0.14 — отслеживать в B03 |
| RUSTSEC-2026-0374 (unmaintained) | `basic-toml` ← `askama` ← `uniffi_bindgen` | только генератор привязок, в библиотеку не попадает |
| RUSTSEC-2026-0173 (unmaintained) | `proc-macro-error2` ← `hax-lib-macros` ← `libcrux` | proc-macro этапа компиляции |

`cargo audit`: чисто с теми же игнорами в `.cargo/audit.toml` плюс два на `libcrux-kem` 0.0.9 (RUSTSEC-2026-0331, -0330 — паники на коротких ключах гибридного KEM): крейт попадает в `Cargo.lock` через необязательную фичу libcrux-провайдера и не собирается ни в одной конфигурации (`cargo tree -i libcrux-kem --target all --edges all` пуст); `cargo deny` его поэтому и не видит. Для crypto-core: не включать `libcrux-provider`, пока `hpke-rs`/`openmls_libcrux_crypto` не перейдут на `libcrux-kem` ≥ 0.0.10.

## Риски

0. **Ключи в памяти без zeroize.** `MemoryStorage` хранит приватные ключи в обычных `Vec<u8>`; `snapshot()` их копирует; exporter-секреты уходят в FFI как `Vec<u8>`/`Buffer`. Для спайка допустимо; crypto-core обязан обнулять ключи (`zeroize`, правило `CLAUDE.md`) и не давать `Debug`-вывода секретов.
1. **Свежесть `openmls` 0.9.2** (вышла за 11 дней до спайка): возможны patch-релизы с исправлениями; версию закреплять точно и обновлять осознанно, с записью в `SECURITY-CHANGELOG.md`.
2. **Размер Welcome/commit в больших каналах**: 180 КБ на вход в канал на 1 000 устройств — приемлемо для desktop, заметно для мобильной сети. Варианты для B02: отдавать дерево с сервера отдельно, регулярные self-update, лимит листьев.
3. **Время жизни KeyPackage** (`Lifetime`): по умолчанию 84 дня; `KeyPackageIn::validate` проверяет только, что текущее время внутри интервала, верхнюю границу не ограничивает — KeyPackage «на 100 лет» будет принят. Клиент и DS должны отвергать KeyPackage со сроком больше заданного (RFC 9420 §7.2); политика ротации KeyPackages — вопрос B02.
4. **Past epochs**: по умолчанию `max_past_epochs = 0` — сообщения, пришедшие после смены эпохи, не расшифруются. Для доставки с задержкой B02 должен задать окно (с осознанной платой по forward secrecy).
5. **wasm-bindgen** (web-fallback, ARCHITECTURE §6.1) спайком не проверялся.

## Рекомендация

Принять ADR-0016: строить crypto-core на `openmls` 0.9.x с `openmls_rust_crypto`, сервер — external sender с `PublicMessage`-предложениями, группа с `PURE_CIPHERTEXT` и ratchet tree в Welcome; Electron — napi-rs, мобильные — uniffi proc-macro. Открытые решения для B02: доставка дерева для больших каналов, окно past epochs, ротация KeyPackages.

## Как воспроизвести

```bash
cd spikes/01-openmls-ffi
export PATH="$HOME/.cargo/bin:$PATH"       # если rustup не в PATH
just test            # cargo test --workspace
just lint            # fmt + clippy -D warnings
just sizes           # таблица размеров
just bench           # criterion; отчёт в target/criterion/report/index.html
just node            # Node 22: .node + demo.mjs
just electron        # Electron 33 (ставит electron в node-ffi/node/node_modules)
just bindings swift  # uniffi → Swift на macOS
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer just cross   # iOS + Android
just kotlin          # uniffi → Kotlin на JVM хоста
just cross-android   # .so под aarch64-linux-android
```

Для Kotlin и Android нужны JDK 17+, компилятор Kotlin и NDK: распаковать `kotlin-compiler-<версия>.zip` с релизов Kotlin в `~/.local/share/kotlinc-<версия>`, скопировать каталог `NDK` из `.app` в dmg NDK в `~/.local/share/android-ndk-<версия>` (или задать `KOTLINC` / `ANDROID_NDK_HOME`); `rustup target add aarch64-linux-android`. Dev-контейнер x86_64 из первой версии PR убран: на Apple Silicon он работал под эмуляцией и только замедлял то, что мак делает нативно.
