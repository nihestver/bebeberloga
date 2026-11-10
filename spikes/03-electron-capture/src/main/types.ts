// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Типы, общие для main-процесса и окон спайка.

export type AudioMode = "none" | "loopback" | "loopbackWithMute";
export type PresetId = "720p30" | "1080p30" | "1080p60";

export interface Preset {
  id: PresetId;
  width: number;
  height: number;
  fps: number;
  maxBitrate: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  "720p30": { id: "720p30", width: 1280, height: 720, fps: 30, maxBitrate: 3_000_000 },
  "1080p30": { id: "1080p30", width: 1920, height: 1080, fps: 30, maxBitrate: 5_000_000 },
  "1080p60": { id: "1080p60", width: 1920, height: 1080, fps: 60, maxBitrate: 8_000_000 },
};

export interface SourceInfo {
  id: string;
  name: string;
  kind: "window" | "screen";
  displayId: string;
  thumbnail: string; // data URL; пустая строка, если ОС не дала миниатюру
  thumbnailEmpty: boolean;
  appIcon: string;
}

export interface SourceList {
  sources: SourceInfo[];
  tookMs: number;
  error?: string;
}

export interface SelectRequest {
  sourceId: string; // пусто при systemPicker
  audio: AudioMode;
  systemPicker: boolean;
}

export interface PermissionStatus {
  platform: string;
  osVersion: string;
  screen: string;
  microphone: string;
  sessionType: string; // XDG_SESSION_TYPE на Linux
  electron: string;
  chrome: string;
  packaged: boolean;
}

/** Нормированный прямоугольник (0..1) полосы с меткой времени внутри кадра источника. */
export interface StripRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PublishConfig {
  room: string;
  sourceId: string;
  preset: PresetId;
  /** false — только сравнительный замер на стенде; в продукте публикации без E2EE нет. */
  e2ee: boolean;
  codec: "h264" | "h265" | "vp8" | "vp9" | "av1";
  audio: AudioMode;
  systemPicker: boolean;
  simulcast: boolean;
  degradation: "maintain-framerate" | "maintain-resolution" | "balanced";
  e2eeKey?: string;
}

export interface ViewConfig {
  room: string;
  e2ee: boolean;
  strip: StripRect;
  e2eeKey?: string;
}

export interface ProcSample {
  t: number;
  /** cpu — доля от всех ядер по Electron; cpuTimeS — накопленное процессорное время по ps (для % одного ядра). */
  procs: {
    type: string;
    role: string;
    pid: number;
    cpu: number;
    memKB: number;
    cpuTimeS: number | null;
  }[];
  sfuCpuTimeS: number | null;
  gpuUtil: number | null;
  sfuCpu: number | null;
}

export interface Env {
  livekitUrl: string;
  mode: string;
  clockSourceId: string;
  screenSourceId: string;
  clockStripWindow: StripRect;
  clockStripScreen: StripRect;
}

export interface S3Api {
  env(): Promise<Env>;
  listSources(types: ("window" | "screen")[], thumb: number): Promise<SourceList>;
  selectSource(req: SelectRequest): Promise<void>;
  permissions(): Promise<PermissionStatus>;
  openScreenSettings(): Promise<void>;
  token(room: string, identity: string): Promise<string>;
  log(msg: string): void;
}
