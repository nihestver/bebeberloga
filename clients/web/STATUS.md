# STATUS — web-клиент: дизайн-система (B08)

Модуль: `clients/web/src/ui`. Промпт — `docs/prompts/B08-design-system.md`. Ветка `feat/B08-design-system`.
Токены — `design/tokens/` (README там же); собственные ассеты — `design/avatars/`, `design/icons/`.

## Сделано (2026-11-07)

- Каркас `clients/web`: Vite 8, React 19, TypeScript 6.0, ESLint 10 (strict type-checked, jsx-a11y),
  Prettier, Vitest 5 + Testing Library + jsdom, Storybook 10 с `addon-a11y`. Рецепты: `just storybook`,
  `just lint-web`, `just test-web`, `just gen` (токены), `just lint-licenses` (лицензии дерева npm).
- Токены: `design/tokens/*.json` (Style Dictionary 5, DTCG) → `src/ui/tokens.css` и `tokens.ts`;
  производные цвета COMPONENTS §1 считаются при сборке; светлая тема заложена пустой; при
  `prefers-reduced-motion` длительности равны нулю. 20 образцов для `ColorSwatches` и фона аватаров.
- ADR-0023: примитивы доступности React Aria Components 1.22.1, иконки Lucide 1.70.0; собственные
  иконки и аватары — ассеты в `design/`. Шрифты BRAND через `@fontsource/*`.
- Все компоненты COMPONENTS.md §2–§6 (таблица ниже), истории со всеми состояниями, тесты.
- Реестр сочетаний SHORTCUTS.md (`src/ui/shortcuts`): `useShortcut`, сравнение по физической клавише
  (работает в русской раскладке), диспетчер `Esc` по порядку слоёв (`useEscapeLayer`), `Kbd`.
  Проверка набора: внутренних конфликтов нет; расхождения с системой и полем ввода — в OPEN-QUESTIONS №28.
- Тексты компонентов — `src/locales/{ru,en}/ui.json` и `shortcuts.json` через `UiProvider`
  (`I18nProvider` примитивов получает `ru-RU`/`en-US`).
- Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` — 244 теста, среди них axe по каждой из 81
  истории (serious/critical нет), контраст пар токенов ≥ 4.5:1, свежесть `tokens.*`, отсутствие HEX
  и длительностей мимо токенов в `src/ui`, декодирование отрисованного QR-кода через jsQR.

## Компоненты COMPONENTS.md → файл → история Storybook

Истории: `just storybook` → http://localhost:6006 (путь в колонке «История» — раздел и история).

| Компонент                                   | Файл (`src/ui/…`)                                                                      | История                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Button/Primary` … `/Link`                  | `Button/Button.tsx` (`Button variant`)                                                 | Button → Primary, Secondary, Danger, DangerOutline, Link |
| `Button/Icon`                               | `Button/Button.tsx` (`IconButton`)                                                     | Button → Icon                                            |
| `Button/IconToggle`                         | `Button/Button.tsx` (`IconToggleButton`)                                               | Button → IconToggle                                      |
| `Button/Split`                              | `Button/SplitButton.tsx`                                                               | Button → Split                                           |
| `Button/Pill`                               | `Button/Button.tsx` (`Button variant="pill"`)                                          | Button → Pill                                            |
| `Button/Hangup`                             | `Button/Button.tsx` (`HangupButton`)                                                   | Button → Hangup                                          |
| `Input/Text`                                | `Input/Input.tsx` (`TextInput`)                                                        | Input → Text                                             |
| `Input/WithAction`                          | `Input/Input.tsx` (`ActionInput`)                                                      | Input → WithAction                                       |
| `Input/Search`                              | `Input/Input.tsx` (`SearchInput`)                                                      | Input → Search                                           |
| `Input/Textarea`                            | `Input/Input.tsx` (`Textarea`)                                                         | Input → Textarea                                         |
| `Input/RichText`                            | `Input/Input.tsx` (`RichTextInput`)                                                    | Input → RichText                                         |
| `Input/ChannelName`                         | `Input/Input.tsx` (`ChannelNameInput`, `normalizeChannelName`)                         | Input → ChannelName                                      |
| `Select`                                    | `Select/Select.tsx`                                                                    | Select → Default, WithSearch                             |
| `Toggle`                                    | `Toggle/Toggle.tsx`                                                                    | Toggle → Default                                         |
| `Checkbox`                                  | `Checkbox/Checkbox.tsx`                                                                | Checkbox → Default                                       |
| `Radio`                                     | `Radio/Radio.tsx` (`Radio`)                                                            | Radio → Radio                                            |
| `RadioGroup`                                | `Radio/Radio.tsx` (`RadioGroup`)                                                       | Radio → RadioGroup                                       |
| `RadioCard`                                 | `Radio/Radio.tsx` (`RadioCard`)                                                        | Radio → RadioCard                                        |
| `TriState`                                  | `SegmentedControl/SegmentedControl.tsx` (`TriState`)                                   | TriState → Default                                       |
| `Slider`                                    | `Slider/Slider.tsx` (`Slider`)                                                         | Slider → Default                                         |
| `Slider/Threshold`                          | `Slider/Slider.tsx` (`ThresholdSlider`)                                                | Slider → Threshold                                       |
| `LevelMeter`                                | `Slider/Slider.tsx` (`LevelMeter`)                                                     | Slider → LevelMeter                                      |
| `KeyRecorder`                               | `KeyRecorder/KeyRecorder.tsx`                                                          | KeyRecorder → Default                                    |
| `Kbd`                                       | `Kbd/Kbd.tsx` (`Kbd`, `KeyComboView`, `ShortcutKeys`)                                  | Kbd → Default, Registry                                  |
| `ColorSwatches`                             | `ColorSwatches/ColorSwatches.tsx`                                                      | ColorSwatches → Default                                  |
| `SegmentedControl`                          | `SegmentedControl/SegmentedControl.tsx`                                                | SegmentedControl → Default                               |
| `Tabs`                                      | `Tabs/Tabs.tsx`                                                                        | Tabs → Default                                           |
| `Chip`                                      | `Chip/Chip.tsx` (`ChipGroup`)                                                          | Chip → Default                                           |
| `Tooltip`, `Tooltip/Success`                | `Tooltip/Tooltip.tsx` (`Tooltip`, `useSuccessTooltip`)                                 | Tooltip → Default, Success                               |
| `Menu/Context`                              | `Menu/Menu.tsx` (`ContextMenu`, `MenuItem`, `MenuSection`, `MenuSeparator`, `Submenu`) | Menu → Context, Scrolling                                |
| `Menu/Context` с быстрыми реакциями         | `Menu/Menu.tsx` (`QuickReactions`)                                                     | Menu → ContextQuickReactions                             |
| `Menu/Popover`                              | `Menu/Menu.tsx` (`PopoverMenu`)                                                        | Menu → Popover                                           |
| `Popover/Panel`                             | `Popover/PopoverPanel.tsx`                                                             | Popover → Panel                                          |
| `Modal/S`, `/M`, `/L`                       | `Modal/Modal.tsx` (`Modal size`)                                                       | Modal → S, M, L, LWide, SplitFooter                      |
| `Modal/Confirm`                             | `Modal/Modal.tsx` (`ConfirmModal`)                                                     | Modal → Confirm                                          |
| `Overlay/Settings`                          | `Modal/Modal.tsx` (`SettingsOverlay`)                                                  | Overlay → Settings                                       |
| `Modal/Settings`                            | `Modal/Modal.tsx` (`SettingsModal`)                                                    | Modal → Settings                                         |
| `CallToast`                                 | `CallToast/CallToast.tsx`                                                              | CallToast → Default                                      |
| `MiniPlayer`                                | `MiniPlayer/MiniPlayer.tsx`                                                            | MiniPlayer → Default                                     |
| `Toast`                                     | `Toast/Toast.tsx` (`ToastRegion`, `showToast`)                                         | Toast → Default                                          |
| `SaveBar`                                   | `Banner/Banner.tsx` (`SaveBar`)                                                        | SaveBar → Default                                        |
| `Banner`                                    | `Banner/Banner.tsx` (`Banner`)                                                         | Banner → Default                                         |
| `Avatar`, `/Status`, `/Speaking`, `/Typing` | `Avatar/Avatar.tsx`, `Avatar/builtin.ts`                                               | Avatar → Sizes, BuiltIn, Tones, Status, Speaking, Typing |
| `CommunityIcon`                             | `Avatar/Avatar.tsx` (`CommunityIcon`)                                                  | Avatar → CommunityIcon                                   |
| `Badge/Count`                               | `Badge/Badge.tsx` (`CountBadge`, `formatCount`)                                        | Badge → Count                                            |
| `Badge/Pill`                                | `Badge/Badge.tsx` (`PillBadge`)                                                        | Badge → Pill                                             |
| `Badge/Live`                                | `Badge/Badge.tsx` (`LiveBadge`)                                                        | Badge → Live                                             |
| `UnreadPip`                                 | `Badge/Badge.tsx` (`UnreadPip`)                                                        | Indicators → UnreadPip                                   |
| `E2EEBadge`                                 | `Badge/Badge.tsx` (`E2EEBadge`)                                                        | Indicators → E2EEBadge                                   |
| `ListRow`                                   | `List/List.tsx` (`ListRow` в `RowList`)                                                | List → ListRow                                           |
| `SectionHeader`                             | `List/List.tsx`                                                                        | List → SectionHeader                                     |
| `Divider`, `/Date`, `/New`                  | `List/List.tsx` (`Divider variant`)                                                    | List → Divider                                           |
| `EmptyState`                                | `EmptyState/EmptyState.tsx` (+ `SleepingBear`, `SearchingBear`)                        | EmptyState → Default                                     |
| `ProgressBar`                               | `Progress/Progress.tsx`                                                                | Progress → ProgressBar                                   |
| `QRCode`                                    | `QR/QRCode.tsx`                                                                        | QR → QRCode                                              |
| `QRScanner`                                 | `QR/QRScanner.tsx`                                                                     | QR → QRScanner, QRScannerDenied                          |
| `PasswordStrength`                          | `Progress/Progress.tsx`                                                                | Progress → PasswordStrength                              |
| `CodeInput`                                 | `CodeInput/CodeInput.tsx`                                                              | CodeInput → Default                                      |
| `WaveformTrimmer`                           | `WaveformTrimmer/WaveformTrimmer.tsx`                                                  | WaveformTrimmer → Default                                |
| `Skeleton`                                  | `Progress/Progress.tsx` (`Skeleton`, `SkeletonText`)                                   | Progress → Skeleton                                      |
| `Card`                                      | `Card/Card.tsx` (`Card`, `LinkCard`)                                                   | Card → Default                                           |
| `Table`                                     | `Card/Card.tsx` (`Table`)                                                              | Card → Table                                             |
| Иконки (§7)                                 | `icons/icons.ts`, `icons/Icon.tsx`, `design/icons/`                                    | — (используются в историях)                              |

Состояния из §2 («обычное, наведение, нажатие, фокус, неактивное, загрузка, ошибка») показаны
рядом: помощник `stories/States.tsx` ставит data-атрибуты, которыми примитивы отмечают состояния,
поэтому картинка совпадает с настоящим наведением и фокусом.

## Отклонения от промпта и технические решения

- **Аватары и собственные иконки лежат в `design/avatars/` и `design/icons/`**, а не в
  `clients/web/src/ui/avatars/`, как написано в промпте: решение владельца при одобрении плана —
  ими будут пользоваться и мобильные клиенты. Web-клиент берёт их при сборке (алиас `@design`,
  `import.meta.glob … ?raw`). Лицензия и авторство — CC BY-SA 4.0, автор nihestver: `LICENSING.md`,
  `NOTICE` и `REUSE.toml` (PR #20 владельца) и построчно `ATTRIBUTION.md`.
- **Список id аватаров — контракт** (`docs/protocol/AVATARS.md`): `User.avatar_id` передаётся между
  клиентами. Неизвестный id показывается запасным `bear`. Тон фона закреплён за аватаром
  (OPEN-QUESTIONS №25).
- **Состояния через data-атрибуты примитивов**, а не `:hover`/`:active`: нажатие с клавиатуры и
  наведение на сенсорных экранах ведут себя правильно; глобальное кольцо фокуса — `base.css` по
  `data-focus-visible`.
- **`Esc` — собственный диспетчер** (`shortcuts/escape.ts`): примитивы не закрывают слои сами
  (`isKeyboardDismissDisabled`), порядок задаёт тип слоя по SHORTCUTS.md, одно нажатие — одно
  действие. Слои приложения (правка сообщения, полный экран, входящий звонок, «прочитано»)
  подписываются через `useEscapeLayer`.
- **Производные цвета** считаются при сборке токенов (смешивание в sRGB, OPEN-QUESTIONS №22);
  в коде компонентов нет ни одной записи цвета HEX — это проверяет тест и критерий промпта.
- **Тексты компонентов** — JSON-словари через `UiProvider`; библиотеку i18n для экранов выбирает B09
  и оборачивает ею провайдер. Строки `ui.json`/`shortcuts.json` любой i18n-библиотеке читать удобно.
- **Toast** — поверх `UNSTABLE_Toast*` примитивов (в 1.22 API ещё не стабилен); время показа
  приводится к 3–5 с, видно не больше трёх.
- **`Select`** с числом вариантов больше 10 получает поиск (`Autocomplete`); список — 8 строк.
- **`Input/RichText`** — панель форматирования и обратный вызов `onFormat`; как разметка попадает в
  текст (Markdown-подмножество формата сообщений), решает композитор в B09.
- **`CodeInput`** считает цифрами только `0–9`; `normalizeChannelName` обрезает по кодовым точкам
  до 64 (контракт не уточняет единицу длины).
- **`QRScanner`** читает кадр каждые 150 мс через холст и декодер библиотеки `qr`; тест подменяет
  камеру. В Storybook история запрашивает настоящую камеру.
- **ESLint 10 с `eslint-plugin-jsx-a11y` 6.10** (peer-диапазон до ESLint 9) — работает, pnpm
  предупреждает о peer-зависимости. TypeScript 6.0, не 7: `typescript-eslint` 8.72 поддерживает до 6.1.
- **Лицензии транзитивных зависимостей**: 0BSD (`tslib`, в сборке), BlueOak-1.0.0 и CC-BY-4.0 (только
  инструменты) не названы в LICENSING.md — скрипт `check-licenses.mjs` держит их отдельным списком
  «ждут строки в LICENSING.md» (ADR-0023 §6, решение владельца).

## Зависимости (прямые)

См. ADR-0023 §5: точные версии, лицензии и назначение. Рантайм: `react`, `react-dom`,
`react-aria-components`, `lucide-react`, `qr`, `@fontsource/{unbounded,nunito,jetbrains-mono}`,
`@bufbuild/protobuf` (для `src/gen`).

## Сломано, ограничения

- Проверка контраста и доступности в настоящем браузере автоматически не идёт (Playwright появится
  в B09): в CI — axe в jsdom и расчёт контраста по токенам; в Storybook панель Accessibility
  (`a11y.test: "error"`) проверена вручную.
- `prefers-reduced-motion` проверяется статически (токены-длительности = 0 и правило в `base.css`),
  а не прогоном в браузере.
- Иллюстрации `EmptyState` — заглушки в коде (BRAND.md: иллюстрации «когда дойдёт до интерфейса»).
- Рингтон `CallToast` не проигрывается: звук — собственный ассет, появится вместе со звонками (B11).
- `Button/Split` и `IconToggleButton` в неактивном состоянии не показывают подсказку (примитив не
  шлёт события наведения с неактивной кнопки) — поведение примитива.

## Дальше

- B09: оболочка клиента на этих компонентах, i18n-библиотека приложения, Playwright e2e с проверкой
  контраста и a11y в браузере, Electron.
- После ответов контура A: OPEN-QUESTIONS №22–№29 (формула цветов, образцы, белая подложка QR, фон
  аватара, символы имени канала, счётчик «1K+», конфликты сочетаний, авторство в «О программе»).
- Глобальные сочетания (PTT, свои сочетания) — desktop-оболочка B09; реестр уже знает о них
  (`userAssigned`).
