# S3. Спайк: захват экрана в Electron (запасной путь)

Запуск: `/prompt S3`. Фаза 0. Каталог: `spikes/03-electron-capture/`.

## Роль
Electron/TypeScript-разработчик в проекте Bebeberloga. Действуют правила `CLAUDE.md`.

## Входные файлы
- docs/spec/ARCHITECTURE.md §6.2, §6.5 («Два пути публикации стрима», путь 2)
- docs/adr/0007-desktop-shell-electron.md, 0008-stream-media-engine.md, 0009-platform-minimums.md
- docs/spec/SCREENS/05-voice-and-stream.md §4 (окно выбора источника)

## Задача
1. Electron 33+: список окон и мониторов через `desktopCapturer` с миниатюрами; захват выбранного источника через `getDisplayMedia`/`setDisplayMediaRequestHandler`, со звуком где ОС позволяет.
2. Публикация в локальный LiveKit с E2EE (encoded transforms) и просмотр во втором окне.
3. Замеры для 720p30, 1080p30, 1080p60: задержка «экран → зритель» (метки времени в кадре), CPU/GPU, память процесса, размер сборки.
4. Поведение на macOS без разрешения «Запись экрана» и на Linux Wayland (портал).

## Критерии готовности
- [ ] REPORT.md: таблица по ОС и пресетам, что не работает и почему; черновик ADR.
