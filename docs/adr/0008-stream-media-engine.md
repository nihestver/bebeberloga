# ADR-0008: Стрим — нативный Rust media-engine, Chromium-путь для AMD/Intel в 1.0

- Статус: Принято
- Дата: 2026-11-02
- Связано: PLAN.md раздел 6.5, таблица рисков в разделе 12; ADR-0004, ADR-0009

## Контекст

Стрим экрана, окна или приложения со звуком только этого приложения, 720p30–1080p60, задержкой < 1 с и E2EE — ключевая функция 1.0. Chromium не умеет захватывать звук отдельного приложения ни на одной ОС и даёт мало контроля над энкодером (rate control, ключевые кадры). Публичные инженерные описания крупных платформ показывают, что для такого стрима используют собственный захват и кодирование, а WebRTC — только как транспорт. В LiveKit Rust SDK на Windows аппаратный энкодер есть только для NVIDIA.

## Решение

1. **Нативный `media-engine`** (Rust, утилитарный процесс Electron через `napi-rs`): захват → аппаратное кодирование → E2EE кадров → публикация через [LiveKit Rust SDK](https://github.com/livekit/client-sdk-native) (libwebrtc). Стример подключается к комнате вторым участником «стрим», чтобы перегрузка стрима не задевала голос.
2. **Путь публикации выбирается по GPU при старте стрима:**
   - Windows с NVIDIA, macOS, Linux — нативный `media-engine` (NVENC, VideoToolbox, VAAPI/NVENC);
   - Windows с AMD и Intel в 1.0 — **Chromium-путь** (`desktopCapturer` + `getDisplayMedia` + `livekit-client`): его энкодер Media Foundation проверен на всех трёх вендорах; звук приложения и в этом режиме идёт из `media-engine`;
   - для остальных Chromium-путь — автоматический fallback, если нативный не стартовал или упал.
3. **Захват видео — цепочка с fallback:** Windows: WGC → DXGI Desktop Duplication → GDI; macOS: ScreenCaptureKit; Linux: xdg-desktop-portal/PipeWire → XComposite. Кадры остаются на GPU до энкодера.
4. **Захват звука — процесс и его дочерние процессы:** Windows: WASAPI process loopback (`INCLUDE_TARGET_PROCESS_TREE`); macOS: ScreenCaptureKit `capturesAudio` с `excludesCurrentProcessAudio`; Linux: PipeWire-клиент с линковкой узлов приложения по `application.process.id`, без PipeWire — звук системы через PulseAudio monitor с предупреждением.
5. **Кодирование и транспорт:** H.264 всегда, HEVC/AV1 только если все зрители декодируют; энкодер под управлением оценки полосы WebRTC (сброс кадров → битрейт → пресет), без буферизации ради качества; ключевые кадры не сбрасываются при смене параметров, PLI/FIR ≤ 1 в секунду; simulcast из двух слоёв + dynacast; SFU пересылает только тем, кто нажал «Смотреть»; звук стрима Opus 48 кГц стерео 128–256 kbps без обработки.
6. **v1.x:** AMD и Intel на Windows переводятся на нативный путь через энкодеры FFmpeg (h264_amf, h264_qsv, h264_mf) с настройками по образцу OBS и Sunshine (GPL-3.0, совместимо с клиентами).
7. **Запасной план**, если LiveKit Rust SDK упрётся в ограничения: GStreamer (`livekitwebrtcsink`) — с учётом того, что `wasapi2src` скрывает захват звука процесса на сборках ниже 20348, а E2EE в формате LiveKit придётся писать самим.

## Последствия

- Два пути публикации в 1.0: нужна матрица тестов по вендорам GPU и самотест при старте стрима.
- Зритель всегда смотрит в Chromium (`livekit-client`, аппаратное декодирование, E2EE через encoded transforms).
- Метрики качества (fps, равномерность, задержка, VMAF, CPU/GPU) собираются локально и показываются в оверлее; телеметрия — только с согласия.
- Эталонное железо для приёмки: Windows 11 с NVIDIA GTX 16xx / AMD RX 6000 / Intel Arc или Xe; MacBook Air M1 и Intel Mac 2019; Ubuntu 24.04 с AMD и NVIDIA.

## Рассмотренные альтернативы

- Только Chromium-путь: нет звука приложения и контроля над энкодером; остаётся запасным и основным для AMD/Intel в 1.0.
- C++ напрямую на libwebrtc: максимум контроля, но сигналинг LiveKit и совместимое E2EE пришлось бы писать самим (официальный C++ SDK LiveKit сам построен поверх Rust SDK).
- Go + Pion: нет аппаратных энкодеров и совместимого E2EE кадров; потребовал бы cgo-обёртки для NVENC/MF/VideoToolbox.
- Собственный адаптер Media Foundation в LiveKit Rust SDK для 1.0: отложен в пользу Chromium-пути, чтобы не задерживать релиз.
