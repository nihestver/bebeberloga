// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Окно зрителя: подписка на стрим, чтение метки времени из кадра и статистика приёма.
// Задержка «экран → зритель» = ожидаемое время показа кадра у зрителя − время, нарисованное в кадре.
// Оба окна на одной машине, часы общие; сети между ними нет (localhost).

import { RoomEvent, Track, type RemoteTrack, type Room } from "livekit-client";
import { decodeBits, latencyMs, STRIP_CELLS } from "../main/strip";
import type { StripRect, ViewConfig } from "../main/types";
import { join, pickStats } from "./room";

const video = document.getElementById("v") as HTMLVideoElement;
const hud = document.getElementById("hud") as HTMLElement;
const sink = new Audio();
const SAMPLE_H = 4;
const PX = 4; // пикселей холста на ячейку
const probe = new OffscreenCanvas(STRIP_CELLS * PX, SAMPLE_H);
const g = probe.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;

let room: Room | undefined;
let roomEvents: string[] = [];
let track: RemoteTrack | undefined;
let audioTrack: RemoteTrack | undefined;
let strip: StripRect = { x: 0, y: 0, w: 1, h: 0.2 };
let measuring = false;
let statsTimer: number | undefined;
let stats: Record<string, unknown>[] = [];
let firstFrameMs: number | null = null;
let subscribedAt = 0;

interface FrameSample {
  lat: number; // до ожидаемого показа, мс
  latCb: number; // до вызова колбэка, мс
  n: number; // счётчик кадров источника
  w: number;
  h: number;
}
let frames: FrameSample[] = [];
let undecoded = 0;
let undecodedAt: number[] = []; // моменты нечитаемых кадров, мс от начала замера
let measureT0 = 0;
let callbacks = 0;
let last = { lat: 0, w: 0, h: 0 };

/** Разбор полосы: null, если маркеры или контрольная сумма не сошлись (смазанный или чужой кадр). */
function decode(): { ms: number; n: number } | null {
  const sx = strip.x * video.videoWidth;
  const sw = strip.w * video.videoWidth;
  // средняя половина полосы по высоте — подальше от границ
  const sy = (strip.y + strip.h * 0.25) * video.videoHeight;
  const sh = strip.h * 0.5 * video.videoHeight;
  g.drawImage(video, sx, sy, sw, sh, 0, 0, probe.width, SAMPLE_H);
  const d = g.getImageData(0, 1, probe.width, 1).data;
  const bit = (i: number): number => {
    const o = (i * PX + PX / 2) * 4;
    return ((d[o] ?? 0) + (d[o + 1] ?? 0) + (d[o + 2] ?? 0)) / 3 > 128 ? 1 : 0;
  };
  return decodeBits(bit);
}

let chain = 0; // поколение цепочки колбэков: новая подписка отменяет старую

function onFrame(gen: number, now: number, meta: VideoFrameCallbackMetadata): void {
  if (!track || gen !== chain) return;
  callbacks++;
  if (firstFrameMs === null) firstFrameMs = Math.round(performance.now() - subscribedAt);
  const got = decode();
  if (got) {
    const shown = performance.timeOrigin + meta.expectedDisplayTime;
    const diff = (x: number): number => latencyMs(x, got.ms);
    last = { lat: diff(shown), w: meta.width, h: meta.height };
    if (measuring)
      frames.push({
        lat: diff(shown),
        latCb: diff(performance.timeOrigin + now),
        n: got.n,
        w: meta.width,
        h: meta.height,
      });
  } else if (measuring) {
    undecoded++;
    if (undecodedAt.length < 4000) undecodedAt.push(Math.round(performance.now() - measureT0));
  }
  video.requestVideoFrameCallback((n, m) => onFrame(gen, n, m));
}

setInterval(() => {
  if (track) hud.textContent = `${last.w}×${last.h}\nзадержка ${last.lat.toFixed(0)} мс`;
}, 500);

async function viewStart(cfg: ViewConfig): Promise<void> {
  await viewStop();
  strip = cfg.strip;
  firstFrameMs = null;
  const joined = await join(cfg.room, "viewer", cfg.e2ee, cfg.e2eeKey);
  room = joined.room;
  roomEvents = joined.events;
  room.on(RoomEvent.TrackSubscribed, (t, pub) => {
    roomEvents.push(
      `${Math.round(performance.now())} subscribed ${pub.source} encrypted=${pub.isEncrypted}`,
    );
    if (t.kind === Track.Kind.Video) {
      track = t;
      t.attach(video);
      subscribedAt = performance.now();
      const gen = ++chain;
      video.requestVideoFrameCallback((n, m) => onFrame(gen, n, m));
    } else if (t.kind === Track.Kind.Audio) {
      audioTrack = t;
      // дорожка должна воспроизводиться, чтобы шла статистика приёма; громкость 0 — иначе звук зрителя
      // на той же машине снова попадёт в захват системного звука
      t.attach(sink);
      sink.volume = 0;
    }
  });
}

async function viewStop(): Promise<void> {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = undefined;
  measuring = false;
  chain++;
  track?.detach(video);
  track = undefined;
  audioTrack?.detach(sink);
  audioTrack = undefined;
  if (room) await room.disconnect();
  room = undefined;
  hud.textContent = "ожидание стрима";
}

function measureBegin(): void {
  frames = [];
  stats = [];
  undecoded = 0;
  undecodedAt = [];
  measureT0 = performance.now();
  callbacks = 0;
  measuring = true;
  statsTimer = window.setInterval(() => {
    void (async () => {
      const v = pickStats(await track?.getRTCStatsReport(), ["inbound-rtp", "codec"]);
      const a = pickStats(await audioTrack?.getRTCStatsReport(), ["inbound-rtp", "codec"]);
      stats.push({ t: Date.now(), video: v, audio: a });
    })();
  }, 1000);
}

function measureEnd(): Record<string, unknown> {
  measuring = false;
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = undefined;
  return {
    frames,
    undecoded,
    undecodedAt,
    callbacks,
    stats,
    roomEvents,
    firstFrameMs,
    hadVideoTrack: track !== undefined,
    hadAudioTrack: audioTrack !== undefined,
  };
}

window.__spike = { viewStart, viewStop, measureBegin, measureEnd } as never;

// ручной режим: зритель сам входит в комнату ручного стрима
void window.s3.env().then((env) => {
  if (env.mode === "interactive")
    void viewStart({ room: "s3-manual", e2ee: true, strip: env.clockStripWindow });
});
