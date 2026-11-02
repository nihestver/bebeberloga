# B8. Дизайн-система клиента

Запуск: `/prompt B08`. Фаза 0–1, не зависит от протокола.

Готовый промпт контура B. Запускать в Claude Code из корня репозитория после B1 (или параллельно с ним: B8 от протокола не зависит).

```markdown
# Роль
Ты — React/TypeScript-разработчик интерфейсов в open-source проекте Bebeberloga. Действуют правила `CLAUDE.md`.

# Входные файлы (прочитать до начала)
- BRAND.md, brand/tokens.css (базовые значения; сам файл не меняй)
- docs/spec/GLOSSARY.md
- docs/spec/SCREENS/README.md
- docs/spec/SCREENS/COMPONENTS.md — главный вход
- docs/spec/SCREENS/SHORTCUTS.md
- docs/spec/SCREENS/01-main-window.md (каркас — для проверки, что компонентов хватает)
- docs/adr/ — всё, что касается клиента и лицензий

# Задача
Создай пакет `clients/web/src/ui` (дизайн-система) и Storybook в `clients/web`:
1. Создай `design/tokens/` — источник правды для токенов (JSON в формате Style Dictionary): базовые значения из BRAND.md и brand/tokens.css, производные из COMPONENTS.md §1 (тёмная тема; светлую заложи, но не заполняй). Сборка (`pnpm gen` в clients/web, вызывается из `just gen`) генерирует `clients/web/src/ui/tokens.css` и типизированный `tokens.ts`.
2. Реализуй компоненты из COMPONENTS.md §2–§6 (включая CallToast, MiniPlayer, ProgressBar, QRCode/QRScanner, PasswordStrength, CodeInput, WaveformTrimmer) с именами из первой колонки (Button/Primary → `<Button variant="primary">` и т. д.): кнопки, поля, Select, Toggle, Checkbox, Radio/RadioCard, TriState, Slider, Slider/Threshold, LevelMeter, KeyRecorder, Kbd, ColorSwatches, SegmentedControl, Tabs, Chip, Tooltip, Menu/Context (с подменю, быстрыми реакциями, прокруткой), Menu/Popover, Popover/Panel, Modal S/M/L/Confirm, Overlay/Settings (каркас), Toast, SaveBar, Banner, Avatar (+Status, Speaking, Typing), CommunityIcon, Badge/Count/Pill/Live, UnreadPip, E2EEBadge, ListRow, SectionHeader, Divider (+Date, +New), EmptyState, Skeleton, Card, Table.
3. Выбери библиотеку иконок под свободной лицензией (линейные, скруглённые) и библиотеку примитивов доступности (например Radix UI или React Aria) — оформи выбор новым ADR с проверкой лицензий; не перерисовывай чужие иконки.
4. Подключи шрифты `@fontsource/unbounded`, `@fontsource/nunito` и `@fontsource/jetbrains-mono` (BRAND «Шрифты»).
5. Набор встроенных аватаров: ~30 SVG-иконок в стиле BRAND (простые плоские звери, предметы берлоги) в `clients/web/src/ui/avatars/` с лицензией CC0-1.0 или CC-BY-SA-4.0 в REUSE.toml (ADR-0013 п. 8).
6. Хук `useShortcut` и реестр сочетаний из SHORTCUTS.md (без глобальных — их делает desktop-оболочка в B9).

# Критерии готовности
- [ ] Каждый компонент из COMPONENTS.md есть в Storybook со всеми состояниями из документа (обычное, наведение, фокус, неактивное, загрузка, ошибка).
- [ ] Компоненты используют только токены; HEX-цвета есть только в `design/tokens/` и сгенерированном `clients/web/src/ui/tokens.css` (проверка: `grep -rnE '#[0-9a-fA-F]{6}' clients/web/src/ui --exclude=tokens.css` → пусто).
- [ ] Доступность: `@storybook/addon-a11y` без нарушений уровня serious/critical; клавиатурная навигация в Menu/Context, Select, Tabs, Modal покрыта тестами vitest + Testing Library.
- [ ] Модальные окна ловят фокус и закрываются по Esc; Tooltip показывается при фокусе.
- [ ] `prefers-reduced-motion` отключает анимации (тест).
- [ ] `just lint-web` и `just test-web` зелёные; добавлен рецепт `just storybook`.
- [ ] В clients/web/STATUS.md — таблица «компонент из COMPONENTS.md → путь к файлу → история в Storybook». Файлы docs/spec/ не меняются: вопросы и несоответствия — в docs/spec/OPEN-QUESTIONS.md.

# Ограничения
- Только спецификация из docs/; не воспроизводить сторонние продукты, их цвета, иконки, шрифты и тексты; запретный список в GLOSSARY.md.
- Интерфейс плоский: тень только у всплывающих элементов (BRAND).
- Каждая зависимость — с обоснованием и лицензией в PR.

# Формат ответа
1. План (до 10 пунктов) и открытые вопросы — ДО кода.
2. Файлы с полными путями.
3. Команды сборки и тестов с ожидаемым выводом.
4. Что сознательно отложено.
```
