# ADR-0007: Desktop-оболочка — Electron

- Статус: Принято
- Дата: 2026-11-02
- Связано: PLAN.md разделы 6.1–6.3; ADR-0008

## Контекст

Desktop-клиент нужен на Windows, macOS и Linux с одинаковым интерфейсом, рабочим WebRTC, E2EE кадров и захватом экрана. Tauri легче и ближе к FOSS-духу, но на Linux использует WebKitGTK, в стандартных сборках которого WebRTC отключён ([tauri#2600](https://github.com/tauri-apps/tauri/issues/2600), [WebKit Bugzilla 274711](https://www2.webkit.org/show_bug.cgi?id=274711)).

## Решение

- Для 1.0 — **Electron 33+** с React 19 + TypeScript; сборки через `electron-builder` (NSIS/MSIX, DMG, deb; AppImage и Flatpak опционально). Веб-клиент — побочный продукт той же кодовой базы.
- Chromium даёт на всех трёх ОС одинаковые WebRTC, encoded transforms (E2EE кадров), аппаратное декодирование и `desktopCapturer`.
- Нативные части (crypto-core, media-engine) подключаются как Node-модули через `napi-rs` и работают в утилитарных процессах.
- Решение для 1.0 окончательное. Tauri пересматривается после 1.0, если WebKitGTK получит WebRTC в стандартных сборках.

## Последствия

- Размер дистрибутива ~150 МБ и расход памяти выше, чем у Tauri.
- Linux-сборка зависит от Chromium, а не от системного WebKitGTK — предсказуемее для голоса и стрима.

## Рассмотренные альтернативы

- Tauri 2: нет WebRTC на Linux; обходной путь с нативным медиа через LiveKit Rust SDK и рендером видео в webview сложен.
- Flutter: одна база для всех платформ, но нет веба как бонуса, сложнее плотные списки и Markdown-редактор.
- Kotlin Multiplatform / Compose Desktop: нет LiveKit SDK для JVM-desktop.
