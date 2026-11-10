// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Окно стримера: сетка источников (desktopCapturer), захват через getDisplayMedia и публикация в LiveKit.
// Интерфейс упрощён (спайк, без дизайн-системы); раскладка — по смыслу SCREENS/05 §4.

import { LocalAudioTrack, LocalVideoTrack, Track, type Room } from "livekit-client";
import {
  PRESETS,
  type AudioMode,
  type PresetId,
  type PublishConfig,
  type SelectRequest,
  type SourceInfo,
} from "../main/types";
import { join, pickStats } from "./room";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = $("status");
const grid = $("grid");
const empty = $("empty");

let tab: "window" | "screen" = "window";
let room: Room | undefined;
let roomEvents: string[] = [];
let stream: MediaStream | undefined;
let unlock: MediaStream | undefined;
let videoTrack: LocalVideoTrack | undefined;
let statsTimer: number | undefined;
let samples: Record<string, unknown>[] = [];
let trackEvents: string[] = [];

function say(msg: string): void {
  status.textContent = msg;
  window.s3.log(`streamer: ${msg}`);
}

async function capture(req: SelectRequest, preset: PresetId): Promise<MediaStream> {
  const p = PRESETS[preset];
  await window.s3.selectSource(req);
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { max: p.width },
      height: { max: p.height },
      frameRate: { ideal: p.fps, max: p.fps },
    },
    // звук стрима — без обработки, стерео 48 кГц (ARCHITECTURE §6.5 п. 7)
    audio:
      req.audio !== "none"
        ? {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2,
            sampleRate: 48000,
          }
        : false,
  });
}

/** Контрольный источник не из захвата экрана: анимация на canvas (проверка выбора энкодера). */
function canvasStream(w: number, h: number, fps: number): MediaStream {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  let n = 0;
  const tick = (): void => {
    n++;
    g.fillStyle = "#101418";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 28; i++) {
      g.fillStyle = `hsl(${i * 37} 60% 50%)`;
      g.fillRect(((n * (3 + i)) % (w + 200)) - 200, (i * h) / 28, 200, h / 40);
    }
    if (stream) requestAnimationFrame(tick);
  };
  requestAnimationFrame(() => requestAnimationFrame(tick));
  return c.captureStream(fps);
}

function describe(s: MediaStream): Record<string, unknown> {
  const v = s.getVideoTracks()[0];
  const a = s.getAudioTracks()[0];
  return {
    video: v
      ? { label: v.label, readyState: v.readyState, muted: v.muted, settings: v.getSettings() }
      : null,
    audio: a
      ? { label: a.label, readyState: a.readyState, muted: a.muted, settings: a.getSettings() }
      : null,
  };
}

async function publishStart(cfg: PublishConfig): Promise<Record<string, unknown>> {
  await publishStop();
  const p = PRESETS[cfg.preset];
  const t0 = performance.now();
  if (cfg.sourceId.startsWith("canvas:")) {
    // Chromium показывает encoderImplementation только странице с активным захватом — держим его открытым
    unlock = await capture(
      { sourceId: cfg.sourceId.slice(7), audio: "none", systemPicker: false },
      cfg.preset,
    );
    stream = canvasStream(p.width, p.height, p.fps);
  } else {
    stream = await capture(
      { sourceId: cfg.sourceId, audio: cfg.audio, systemPicker: cfg.systemPicker },
      cfg.preset,
    );
  }
  const tCapture = performance.now() - t0;
  const v = stream.getVideoTracks()[0];
  if (!v) throw new Error("getDisplayMedia не вернул видеодорожку");
  trackEvents = [];
  v.addEventListener("ended", () => {
    trackEvents.push(`${Math.round(performance.now())} video ended`);
    say("Источник закрыт — стрим остановлен");
  });
  v.contentHint = "motion";
  const joined = await join(cfg.room, "streamer", cfg.e2ee, cfg.e2eeKey);
  room = joined.room;
  roomEvents = joined.events;
  videoTrack = new LocalVideoTrack(v, undefined, true);
  await room.localParticipant.publishTrack(videoTrack, {
    source: Track.Source.ScreenShare,
    videoCodec: cfg.codec,
    backupCodec: false,
    simulcast: cfg.simulcast,
    screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.fps },
    degradationPreference: cfg.degradation,
  });
  const a = stream.getAudioTracks()[0];
  if (a) {
    a.addEventListener("ended", () =>
      trackEvents.push(`${Math.round(performance.now())} audio ended`),
    );
    if (a.readyState === "live")
      await room.localParticipant.publishTrack(new LocalAudioTrack(a, undefined, true), {
        source: Track.Source.ScreenShareAudio,
        dtx: false,
        red: false,
        audioPreset: { maxBitrate: 128_000 },
      });
  }
  $("stop").removeAttribute("disabled");
  return {
    captureMs: Math.round(tCapture),
    publishMs: Math.round(performance.now() - t0),
    ...describe(stream),
    e2ee: room.isE2EEEnabled,
  };
}

async function publishStop(): Promise<void> {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = undefined;
  stream?.getTracks().forEach((t) => t.stop());
  stream = undefined;
  unlock?.getTracks().forEach((t) => t.stop());
  unlock = undefined;
  videoTrack = undefined;
  if (room) await room.disconnect();
  room = undefined;
  $("stop").setAttribute("disabled", "");
}

function measureBegin(): void {
  samples = [];
  statsTimer = window.setInterval(() => {
    void (async () => {
      const report = await videoTrack?.getRTCStatsReport();
      const settings = videoTrack?.mediaStreamTrack.getSettings();
      samples.push({
        t: Date.now(),
        settings,
        stats: pickStats(report, ["outbound-rtp", "media-source", "codec"]),
      });
    })();
  }, 1000);
}

function measureEnd(): Record<string, unknown> {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = undefined;
  return { samples, roomEvents, trackEvents };
}

// --- проверки без LiveKit ---

/** Захват на 2 с: настройки дорожки и средняя яркость кадра (чёрный кадр = нет разрешения). */
async function captureProbe(req: SelectRequest): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  let s: MediaStream;
  try {
    s = await capture(req, "720p30");
  } catch (e) {
    return {
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      tookMs: Math.round(performance.now() - t0),
    };
  }
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = s;
  await video.play().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2000));
  const c = new OffscreenCanvas(64, 36);
  const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
  let luma: number | null = null;
  if (video.videoWidth > 0) {
    g.drawImage(video, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
    luma = Math.round(sum / (d.length / 4) / 3);
  }
  const info = {
    tookMs: Math.round(performance.now() - t0),
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    meanLuma: luma,
    ...describe(s),
  };
  s.getTracks().forEach((t) => t.stop());
  return info;
}

/** Что WebCodecs считает доступным аппаратно: кодирование и декодирование 1080p60. */
async function codecProbe(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, codec] of [
    ["h264", "avc1.42E02A"],
    ["h264-high", "avc1.64002A"],
    ["hevc", "hvc1.1.6.L123.B0"],
    ["vp9", "vp09.00.41.08"],
    ["av1", "av01.0.09M.08"],
  ] as const) {
    const base = { codec, width: 1920, height: 1080, framerate: 60, bitrate: 8_000_000 };
    const enc = async (hw: HardwareAcceleration): Promise<boolean> =>
      (
        await VideoEncoder.isConfigSupported({
          ...base,
          hardwareAcceleration: hw,
          latencyMode: "realtime",
        }).catch(() => ({ supported: false }))
      ).supported === true;
    const dec = async (hw: HardwareAcceleration): Promise<boolean> =>
      (
        await VideoDecoder.isConfigSupported({
          codec,
          codedWidth: 1920,
          codedHeight: 1080,
          hardwareAcceleration: hw,
        }).catch(() => ({ supported: false }))
      ).supported === true;
    out[name] = {
      encodeHw: await enc("prefer-hardware"),
      encodeSw: await enc("prefer-software"),
      decodeHw: await dec("prefer-hardware"),
      decodeSw: await dec("prefer-software"),
    };
  }
  return out;
}

/**
 * Какой энкодер берёт WebRTC без LiveKit: петля из двух RTCPeerConnection, H.264 первым в списке кодеков.
 * Варианты: с scalabilityMode и без, contentHint motion/detail, потолок битрейта.
 */
async function encoderProbe(sourceId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const variants: { name: string; hint: string; mode?: string; codec: string; fmtp?: string }[] = [
    { name: "h264 по умолчанию", hint: "", codec: "video/H264" },
    { name: "h264 motion", hint: "motion", codec: "video/H264" },
    { name: "h264 motion L1T1", hint: "motion", mode: "L1T1", codec: "video/H264" },
    { name: "h264 motion L1T3", hint: "motion", mode: "L1T3", codec: "video/H264" },
    { name: "h264 detail", hint: "detail", codec: "video/H264" },
    { name: "h264 42e01f motion", hint: "motion", codec: "video/H264", fmtp: "42e01f" },
    { name: "h264 640c motion", hint: "motion", codec: "video/H264", fmtp: "640c" },
    { name: "h265 motion", hint: "motion", codec: "video/H265" },
  ];
  for (const v of variants) {
    const s = await capture({ sourceId, audio: "none", systemPicker: false }, "1080p60");
    const track = s.getVideoTracks()[0];
    if (!track) continue;
    track.contentHint = v.hint;
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    a.onicecandidate = (e) => void b.addIceCandidate(e.candidate ?? undefined);
    b.onicecandidate = (e) => void a.addIceCandidate(e.candidate ?? undefined);
    const tr = a.addTransceiver(track, {
      direction: "sendonly",
      sendEncodings: [
        { maxBitrate: 8_000_000, maxFramerate: 60, ...(v.mode ? { scalabilityMode: v.mode } : {}) },
      ],
    });
    const caps = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
    const first = caps.filter(
      (c) =>
        c.mimeType === v.codec &&
        (!v.fmtp || (c.sdpFmtpLine ?? "").includes(`profile-level-id=${v.fmtp}`)),
    );
    tr.setCodecPreferences([...first, ...caps.filter((c) => !first.includes(c))]);
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription as RTCSessionDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription as RTCSessionDescription);
    await new Promise((r) => setTimeout(r, 6000));
    const stats = pickStats(await tr.sender.getStats(), ["outbound-rtp", "codec"]);
    const o = stats.find((x) => x.type === "outbound-rtp") ?? {};
    const c = stats.find((x) => x.type === "codec") ?? {};
    out[v.name] = {
      candidates: first.length,
      encoder: o.encoderImplementation,
      hw: o.powerEfficientEncoder,
      size: `${String(o.frameWidth)}×${String(o.frameHeight)}`,
      fps: o.framesPerSecond,
      mode: o.scalabilityMode,
      codec: c.mimeType,
      fmtp: c.sdpFmtpLine,
      limit: o.qualityLimitationReason,
    };
    a.close();
    b.close();
    s.getTracks().forEach((t) => t.stop());
  }
  return out;
}

let audioStream: MediaStream | undefined;
let audioCtx: AudioContext | undefined;
let analyser: AnalyserNode | undefined;
let audioEvents: string[] = [];

async function audioStart(req: SelectRequest): Promise<Record<string, unknown>> {
  audioEvents = [];
  const t0 = performance.now();
  try {
    audioStream = await capture(req, "720p30");
  } catch (e) {
    return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  const a = audioStream.getAudioTracks()[0];
  const info = { tookMs: Math.round(performance.now() - t0), ...describe(audioStream) };
  if (!a) return { ...info, note: "звуковой дорожки нет" };
  for (const ev of ["ended", "mute", "unmute"])
    a.addEventListener(ev, () => audioEvents.push(`${Math.round(performance.now() - t0)} ${ev}`));
  audioCtx = new AudioContext();
  await audioCtx.resume();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 8192;
  audioCtx.createMediaStreamSource(new MediaStream([a])).connect(analyser);
  return info;
}

/** RMS дорожки за окно и доля энергии около 440 Гц (тон окна часов). */
async function audioLevel(phase: string, ms: number): Promise<Record<string, unknown>> {
  const a = audioStream?.getAudioTracks()[0];
  if (!analyser || !audioCtx || !a) return { phase, error: "нет дорожки" };
  const time = new Float32Array(analyser.fftSize);
  const freq = new Float32Array(analyser.frequencyBinCount);
  let peakRms = 0;
  let tone = -Infinity;
  const bin = Math.round((440 / audioCtx.sampleRate) * analyser.fftSize);
  const end = performance.now() + ms;
  while (performance.now() < end) {
    analyser.getFloatTimeDomainData(time);
    let sum = 0;
    for (const v of time) sum += v * v;
    peakRms = Math.max(peakRms, Math.sqrt(sum / time.length));
    analyser.getFloatFrequencyData(freq);
    tone = Math.max(
      tone,
      freq[bin] ?? -Infinity,
      freq[bin - 1] ?? -Infinity,
      freq[bin + 1] ?? -Infinity,
    );
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    phase,
    readyState: a.readyState,
    muted: a.muted,
    peakRms: Number(peakRms.toFixed(5)),
    tone440dB: Math.round(tone),
    events: [...audioEvents],
  };
}

async function audioStop(): Promise<Record<string, unknown>> {
  const a = audioStream?.getAudioTracks()[0];
  const out = { readyState: a?.readyState ?? "нет", events: [...audioEvents] };
  audioStream?.getTracks().forEach((t) => t.stop());
  audioStream = undefined;
  await audioCtx?.close();
  audioCtx = undefined;
  analyser = undefined;
  return out;
}

window.__spike = {
  publishStart,
  publishStop,
  measureBegin,
  measureEnd,
  captureProbe,
  codecProbe,
  encoderProbe,
  audioStart,
  audioLevel,
  audioStop,
} as never;

// --- ручной режим: сетка ---

function card(s: SourceInfo): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "card";
  const img = document.createElement("img");
  img.className = "thumb";
  if (s.thumbnail) img.src = s.thumbnail;
  const t = document.createElement("div");
  t.className = "t";
  if (s.appIcon) {
    const icon = document.createElement("img");
    icon.src = s.appIcon;
    t.append(icon);
  }
  t.append(s.name || "(без названия)");
  b.append(img, t);
  // клик по карточке сразу запускает стрим (SCREENS/05 §4.2)
  b.addEventListener("click", () => void startManual(s.id, false));
  return b;
}

async function startManual(sourceId: string, systemPicker: boolean): Promise<void> {
  try {
    const info = await publishStart({
      room: "s3-manual",
      sourceId,
      preset: $<HTMLSelectElement>("preset").value as PresetId,
      e2ee: true,
      codec: "h264",
      audio: $<HTMLSelectElement>("audio").value as AudioMode,
      systemPicker,
      simulcast: false,
      degradation: "maintain-framerate",
    });
    say(`Стрим идёт: ${JSON.stringify(info)}`);
  } catch (e) {
    say(`Не удалось начать стрим: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
}

async function refresh(): Promise<void> {
  const perm = await window.s3.permissions();
  $("perm").textContent =
    `${perm.platform} ${perm.osVersion} · запись экрана: ${perm.screen}${perm.sessionType ? ` · сеанс: ${perm.sessionType}` : ""}`;
  const denied = perm.platform === "darwin" && perm.screen !== "granted";
  const list = await window.s3.listSources([tab], 440);
  grid.replaceChildren(...list.sources.map(card));
  empty.hidden = !(denied || list.sources.length === 0);
  $("open-settings").hidden = !denied;
  $("empty-text").textContent = denied
    ? "Нет разрешения «Запись экрана». Выдай его в настройках системы и перезапусти приложение."
    : list.error
      ? `Ошибка списка: ${list.error}`
      : "Нет окон для показа";
}

function setTab(next: "window" | "screen"): void {
  tab = next;
  $("tab-window").classList.toggle("on", tab === "window");
  $("tab-screen").classList.toggle("on", tab === "screen");
  void refresh();
}

void window.s3.env().then((env) => {
  if (env.mode !== "interactive") return;
  $("tab-window").addEventListener("click", () => setTab("window"));
  $("tab-screen").addEventListener("click", () => setTab("screen"));
  $("system").addEventListener("click", () => void startManual("", true));
  $("stop").addEventListener("click", () => void publishStop().then(() => say("Стрим остановлен")));
  $("open-settings").addEventListener("click", () => void window.s3.openScreenSettings());
  void refresh();
  setInterval(() => void refresh(), 2000); // живые миниатюры, раз в 2 с
});
