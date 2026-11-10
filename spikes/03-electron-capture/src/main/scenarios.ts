// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Автоматические сценарии спайка: матрица замеров, снимок разрешений и источников, проверка звука.

import { execFile, spawn } from "node:child_process";
import type { Ctx } from "./main";
import type { AudioMode, PresetId, ProcSample, PublishConfig, ViewConfig } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function list(name: string, def: string): string[] {
  return (process.env[name] ?? def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const js = (v: unknown): string => JSON.stringify(v);

export interface RunSpec {
  preset: PresetId;
  source: "window" | "screen" | "canvas";
  e2ee: boolean;
  codec: PublishConfig["codec"];
  simulcast: boolean;
  wrongKey?: boolean;
}

/** Один прогон: зритель и стример входят в новую комнату, прогрев, окно замера, запись JSON. */
export async function runOne(
  ctx: Ctx,
  spec: RunSpec,
  durationS: number,
  warmupS: number,
  tag: string,
  sourceId?: string,
): Promise<string> {
  const room = `s3-${Date.now().toString(36)}`;
  const name = `${tag}-${spec.source}-${spec.preset}-${spec.codec}-${spec.e2ee ? "e2ee" : "plain"}${spec.simulcast ? "-sim" : ""}${spec.wrongKey ? "-wrongkey" : ""}`;
  ctx.log(`прогон ${name}`);
  const view: ViewConfig = {
    room,
    e2ee: spec.e2ee,
    strip: spec.source === "window" ? ctx.env.clockStripWindow : ctx.env.clockStripScreen,
    e2eeKey: spec.wrongKey ? "s3-не-тот-ключ" : undefined,
  };
  const pub: PublishConfig = {
    room,
    sourceId: sourceId
      ? sourceId
      : spec.source === "canvas"
        ? `canvas:${ctx.env.clockSourceId}`
        : spec.source === "window"
          ? ctx.env.clockSourceId
          : ctx.env.screenSourceId,
    preset: spec.preset,
    e2ee: spec.e2ee,
    codec: spec.codec,
    audio: "none",
    systemPicker: false,
    simulcast: spec.simulcast,
    degradation:
      (process.env.S3_DEGRADATION as PublishConfig["degradation"] | undefined) ??
      "maintain-framerate",
  };
  const procs: ProcSample[] = [];
  let result: unknown;
  try {
    await ctx.call(ctx.viewer, `window.__spike.viewStart(${js(view)})`);
    const started = await ctx.call<unknown>(
      ctx.streamer,
      `window.__spike.publishStart(${js(pub)})`,
    );
    await sleep(warmupS * 1000);
    await ctx.sample(); // сбросить счётчик CPU: percentCPUUsage считается от прошлого вызова
    await ctx.call(ctx.viewer, "window.__spike.measureBegin()");
    await ctx.call(ctx.streamer, "window.__spike.measureBegin()");
    for (let i = 0; i < durationS; i++) {
      await sleep(1000);
      procs.push(await ctx.sample());
      if (process.env.S3_SHOT === "1" && i === Math.floor(durationS / 2))
        await ctx.shot(ctx.viewer, `${name}.png`);
    }
    const viewer = await ctx.call<unknown>(ctx.viewer, "window.__spike.measureEnd()");
    const streamer = await ctx.call<unknown>(ctx.streamer, "window.__spike.measureEnd()");
    result = {
      name,
      spec,
      durationS,
      warmupS,
      started,
      streamer,
      viewer,
      procs,
      perm: ctx.permissions(),
    };
  } finally {
    await ctx.call(ctx.streamer, "window.__spike.publishStop()").catch(() => undefined);
    await ctx.call(ctx.viewer, "window.__spike.viewStop()").catch(() => undefined);
  }
  const file = ctx.write(`${name}.json`, result);
  await sleep(1500);
  return file;
}

export async function runMatrix(ctx: Ctx): Promise<void> {
  const presets = list("S3_PRESETS", "720p30,1080p30,1080p60") as PresetId[];
  const sources = list("S3_SOURCES", "window,screen") as RunSpec["source"][];
  const e2ee = list("S3_E2EE", "on,off").map((v) => v === "on");
  const codecs = list("S3_CODECS", "h264") as PublishConfig["codec"][];
  const sim = list("S3_SIMULCAST", "off").map((v) => v === "on");
  const duration = Number(process.env.S3_DURATION ?? 60);
  // 20 с: при maintain-framerate разрешение выходит на полное за 12–15 с (REPORT.md, «Источники и захват»)
  const warmup = Number(process.env.S3_WARMUP ?? 20);
  const tag = process.env.S3_TAG ?? process.platform;
  await sleep(1500);
  for (const source of sources)
    for (const codec of codecs)
      for (const preset of presets)
        for (const simulcast of sim)
          for (const on of e2ee)
            await runOne(
              ctx,
              { preset, source, e2ee: on, codec, simulcast },
              duration,
              warmup,
              tag,
            );
  if (process.env.S3_WRONGKEY === "1")
    await runOne(
      ctx,
      {
        preset: "720p30",
        source: "window",
        e2ee: true,
        codec: "h264",
        simulcast: false,
        wrongKey: true,
      },
      10,
      5,
      tag,
    );
}

/** Снимок: разрешения ОС, список источников (окна и экраны) с признаком пустой миниатюры, попытка захвата. */
export async function runProbe(ctx: Ctx): Promise<void> {
  const tag = process.env.S3_TAG ?? process.platform;
  const perm = ctx.permissions();
  const windows = await ctx.listSources(["window"], 320);
  const screens = await ctx.listSources(["screen"], 320);
  const strip = (l: typeof windows) => ({
    tookMs: l.tookMs,
    error: l.error,
    sources: l.sources.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.displayId,
      thumbnailEmpty: s.thumbnailEmpty,
      thumbnailBytes: s.thumbnail.length,
      hasIcon: s.appIcon !== "",
    })),
  });
  // Захват без LiveKit: что вернёт getDisplayMedia и идут ли кадры (чёрный кадр без разрешения).
  const capture: Record<string, unknown> = {};
  for (const [label, id] of [
    ["window", ctx.env.clockSourceId],
    ["screen", ctx.env.screenSourceId],
  ] as const) {
    capture[label] = await ctx
      .call<unknown>(
        ctx.streamer,
        `window.__spike.captureProbe(${js({ sourceId: id, audio: "none", systemPicker: false })})`,
      )
      .catch((e: unknown) => ({ error: String(e) }));
  }
  // Системный пикер macOS: обработчик не должен вызываться; без выбора пользователя запрос висит.
  let systemPicker: unknown;
  if (process.env.S3_PICKER === "1") {
    const before = ctx.handlerCalls();
    const waitS = Number(process.env.S3_PICKER_WAIT ?? 40);
    ctx.log(`системный пикер: жду выбора до ${waitS} с`);
    const result = await Promise.race([
      ctx
        .call<unknown>(
          ctx.streamer,
          `window.__spike.captureProbe(${js({ sourceId: "", audio: "none", systemPicker: true })})`,
        )
        .catch((e: unknown) => ({ error: String(e) })),
      sleep(waitS * 1000).then(() => ({ pending: true })),
    ]);
    systemPicker = { result, handlerCalls: ctx.handlerCalls() - before };
    ctx.log(`системный пикер: ${JSON.stringify(systemPicker).slice(0, 300)}`);
  }
  const permAfter = ctx.permissions();
  const codecs = await ctx
    .call<unknown>(ctx.streamer, "window.__spike.codecProbe()")
    .catch((e: unknown) => ({ error: String(e) }));
  const encoders =
    process.env.S3_ENCODER_PROBE === "1"
      ? await ctx
          .call<unknown>(ctx.streamer, `window.__spike.encoderProbe(${js(ctx.env.clockSourceId)})`)
          .catch((e: unknown) => ({ error: String(e) }))
      : undefined;
  const file = ctx.write(`${tag}-probe.json`, {
    permAtStart: ctx.permAtStart,
    perm,
    permAfter,
    codecs,
    encoders,
    systemPicker,
    windows: strip(windows),
    screens: strip(screens),
    capture,
  });
  ctx.log(`probe → ${file}`);
}

/**
 * Linux: что отдаёт getSources (на Wayland — через системное окно выбора), идёт ли захват без второго
 * запроса, есть ли звук, работает ли публикация с E2EE. В системном окне выбирать окно «S3 часы».
 */
export async function runLinux(ctx: Ctx): Promise<void> {
  const tag = process.env.S3_TAG ?? "linux";
  const brief = (l: Awaited<ReturnType<Ctx["listSources"]>>) => ({
    tookMs: l.tookMs,
    error: l.error,
    sources: l.sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      thumbnailEmpty: s.thumbnailEmpty,
      hasIcon: s.appIcon !== "",
    })),
  });
  const out: Record<string, unknown> = {
    perm: ctx.permissions(),
    env: Object.fromEntries(
      [
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
        "WAYLAND_DISPLAY",
        "DISPLAY",
        "S3_OZONE",
        "S3_FEATURES",
      ].map((k) => [k, process.env[k] ?? ""]),
    ),
  };
  const save = (): string => ctx.write(`${tag}-linux.json`, out);
  ctx.log("ШАГ 1: getSources(window, screen) — если открылось системное окно, выбери «S3 часы»");
  const list = await ctx.listSources(["window", "screen"], 320);
  out.list = brief(list);
  ctx.log(
    `ШАГ 1 готов: ${list.sources.length} источников за ${list.tookMs} мс${list.error ? `, ошибка ${list.error}` : ""}`,
  );
  save();
  const src = list.sources.find((s) => s.name.includes("S3 часы")) ?? list.sources[0];
  if (src) {
    ctx.log(`ШАГ 2: захват ${src.id} «${src.name}» через getDisplayMedia`);
    out.capture = await ctx
      .call<unknown>(
        ctx.streamer,
        `window.__spike.captureProbe(${js({ sourceId: src.id, audio: "none", systemPicker: false })})`,
      )
      .catch((e: unknown) => ({ error: String(e) }));
    save();
    ctx.log("ШАГ 3: тот же источник со звуком loopback");
    const audio: Record<string, unknown> = {};
    audio.start = await ctx
      .call<unknown>(
        ctx.streamer,
        `window.__spike.audioStart(${js({ sourceId: src.id, audio: "loopback", systemPicker: false })})`,
      )
      .catch((e: unknown) => ({ error: String(e) }));
    const player = externalSound();
    await sleep(500);
    audio.external = await ctx
      .call<unknown>(ctx.streamer, `window.__spike.audioLevel("external", 3000)`)
      .catch((e: unknown) => ({ error: String(e) }));
    player?.kill();
    audio.stop = await ctx
      .call<unknown>(ctx.streamer, "window.__spike.audioStop()")
      .catch((e: unknown) => ({ error: String(e) }));
    out.audio = audio;
    save();
    const presets = (process.env.S3_LINUX_PRESETS ?? "720p30")
      .split(",")
      .filter((p) => p && p !== "none") as PresetId[];
    if (ctx.sfuReady && presets.length > 0) {
      ctx.log(`ШАГ 4: публикация в LiveKit с E2EE: ${presets.join(", ")}`);
      const runs: string[] = [];
      for (const preset of presets)
        runs.push(
          await runOne(
            ctx,
            { preset, source: "window", e2ee: true, codec: "h264", simulcast: false },
            15,
            12,
            tag,
            src.id,
          ).catch((e: unknown) => `ошибка: ${String(e)}`),
        );
      out.runs = runs;
      save();
    }
  }
  ctx.log("ШАГ 5: повторный getSources — открывается ли системное окно снова");
  const again = await ctx.listSources(["window", "screen"], 320);
  out.listAgain = brief(again);
  ctx.log(`ШАГ 5 готов: ${again.sources.length} источников за ${again.tookMs} мс`);
  out.codecs = await ctx
    .call<unknown>(ctx.streamer, "window.__spike.codecProbe()")
    .catch((e: unknown) => ({ error: String(e) }));
  ctx.log(`готово → ${save()}`);
}

/**
 * Ждать разрешения «Запись экрана»: каждые 2 с — статус и попытка получить список экранов.
 * Отвечает на вопрос, нужен ли перезапуск после выдачи разрешения; затем проверяет захват и звук.
 */
export async function runPermWait(ctx: Ctx): Promise<void> {
  const tag = process.env.S3_TAG ?? process.platform;
  const limitMs = Number(process.env.S3_WAIT ?? 1800) * 1000;
  const file = `${tag}-permwait-${process.pid}.json`;
  const timeline: { tMs: number; at: string; status: string; works: boolean; error?: string }[] =
    [];
  const t0 = Date.now();
  ctx.persistEnv(true);
  let works = false;
  while (Date.now() - t0 < limitMs) {
    const status = ctx.permissions().screen;
    const list = await ctx.listSources(["screen"], 160);
    works = !list.error && list.sources.length > 0;
    const last = timeline.at(-1);
    if (!last || last.status !== status || last.works !== works) {
      timeline.push({
        tMs: Date.now() - t0,
        at: new Date().toISOString(),
        status,
        works,
        error: list.error,
      });
      ctx.log(
        `разрешение: ${status}, список экранов ${works ? "получен" : `не получен (${list.error ?? "пусто"})`}`,
      );
      ctx.write(file, {
        pid: process.pid,
        relaunched: ctx.relaunched,
        permAtStart: ctx.permAtStart,
        timeline,
      });
    }
    if (works) break;
    await sleep(2000);
  }
  const out: Record<string, unknown> = {
    pid: process.pid,
    relaunched: ctx.relaunched,
    permAtStart: ctx.permAtStart,
    timeline,
    // true — доступ появился в том же процессе, который начинал без разрешения
    grantedWithoutRestart: works && timeline.length > 1,
  };
  // ожидание закончено (доступ появился или вышло время): сохранённый режим больше не нужен
  ctx.persistEnv(false);
  if (works) {
    await ctx.refreshScreenSource();
    out.capture = await ctx
      .call<unknown>(
        ctx.streamer,
        `window.__spike.captureProbe(${js({ sourceId: ctx.env.screenSourceId, audio: "none", systemPicker: false })})`,
      )
      .catch((e: unknown) => ({ error: String(e) }));
    ctx.write(file, out);
    await runAudio(ctx);
  }
  ctx.write(file, out);
}

/** Системный звук: дорожка от getDisplayMedia, её состояние и уровень при тоне из своего окна и из чужого процесса. */
export async function runAudio(ctx: Ctx): Promise<void> {
  const tag = process.env.S3_TAG ?? process.platform;
  const modes = list("S3_AUDIO_MODES", "loopback,loopbackWithMute") as AudioMode[];
  const out: Record<string, unknown> = { perm: ctx.permissions() };
  for (const mode of modes) {
    const probe = (phase: string) =>
      ctx
        .call<unknown>(ctx.streamer, `window.__spike.audioLevel(${js(phase)}, 3000)`)
        .catch((e: unknown) => ({ error: String(e) }));
    const res: Record<string, unknown> = {};
    res.start = await ctx
      .call<unknown>(
        ctx.streamer,
        `window.__spike.audioStart(${js({ sourceId: ctx.env.screenSourceId, audio: mode, systemPicker: false })})`,
      )
      .catch((e: unknown) => ({ error: String(e) }));
    await sleep(1000);
    res.silence = await probe("silence");
    // 1) звук самого приложения: тон 440 Гц из окна часов
    await ctx.call(ctx.clock, "window.__spike.setTone(true)");
    await sleep(500);
    res.ownTone = await probe("own");
    await ctx.call(ctx.clock, "window.__spike.setTone(false)");
    await sleep(500);
    // 2) звук чужого процесса: системный звук через afplay (macOS) или paplay (Linux)
    const player = externalSound();
    await sleep(300);
    res.external = await probe("external");
    player?.kill();
    res.stop = await ctx
      .call<unknown>(ctx.streamer, "window.__spike.audioStop()")
      .catch((e: unknown) => ({ error: String(e) }));
    out[mode] = res;
    await sleep(1000);
  }
  if (ctx.sfuReady)
    out.published = await publishedAudio(ctx).catch((e: unknown) => ({ error: String(e) }));
  out.permAfter = ctx.permissions();
  const file = ctx.write(`${tag}-audio.json`, out);
  ctx.log(`audio → ${file}`);
}

/** Звук системы в стриме с E2EE: публикация дорожки и уровень у зрителя, пока играет чужой процесс. */
async function publishedAudio(ctx: Ctx): Promise<unknown> {
  const room = `s3-audio-${Date.now().toString(36)}`;
  const view: ViewConfig = { room, e2ee: true, strip: ctx.env.clockStripWindow };
  const pub: PublishConfig = {
    room,
    sourceId: ctx.env.clockSourceId,
    preset: "720p30",
    e2ee: true,
    codec: "h264",
    audio: "loopback",
    systemPicker: false,
    simulcast: false,
    degradation: "maintain-framerate",
  };
  try {
    await ctx.call(ctx.viewer, `window.__spike.viewStart(${js(view)})`);
    const started = await ctx.call<unknown>(
      ctx.streamer,
      `window.__spike.publishStart(${js(pub)})`,
    );
    await sleep(4000);
    await ctx.call(ctx.viewer, "window.__spike.measureBegin()");
    await ctx.call(ctx.streamer, "window.__spike.measureBegin()");
    const player = externalSound();
    await sleep(8000);
    player?.kill();
    const viewer = await ctx.call<{
      stats: { audio: Record<string, unknown>[] }[];
      roomEvents: string[];
      hadAudioTrack: boolean;
    }>(ctx.viewer, "window.__spike.measureEnd()");
    await ctx.call(ctx.streamer, "window.__spike.measureEnd()");
    const audio = viewer.stats
      .map((s) => s.audio.find((x) => x.type === "inbound-rtp"))
      .filter(Boolean) as Record<string, number>[];
    const first = audio[0];
    const last = audio.at(-1);
    return {
      started,
      hadAudioTrack: viewer.hadAudioTrack,
      roomEvents: viewer.roomEvents,
      samples: audio.length,
      bytesReceived: first && last ? (last.bytesReceived ?? 0) - (first.bytesReceived ?? 0) : null,
      totalAudioEnergy:
        first && last ? (last.totalAudioEnergy ?? 0) - (first.totalAudioEnergy ?? 0) : null,
      maxAudioLevel: Math.max(0, ...audio.map((a) => a.audioLevel ?? 0)),
      audioCodec: viewer.stats.at(-1)?.audio.find((x) => x.type === "codec") ?? null,
    };
  } finally {
    await ctx.call(ctx.streamer, "window.__spike.publishStop()").catch(() => undefined);
    await ctx.call(ctx.viewer, "window.__spike.viewStop()").catch(() => undefined);
  }
}

function externalSound(): { kill(): void } | undefined {
  if (process.platform === "darwin") {
    // системный звук macOS, несколько повторов подряд
    let stop = false;
    let child: ReturnType<typeof execFile> | undefined;
    const loop = (): void => {
      if (stop) return;
      child = execFile("afplay", ["/System/Library/Sounds/Submarine.aiff"], () => loop());
    };
    loop();
    return {
      kill() {
        stop = true;
        child?.kill();
      },
    };
  }
  if (process.platform === "linux") {
    const child = spawn("sh", [
      "-c",
      "while true; do paplay /usr/share/sounds/freedesktop/stereo/bell.oga 2>/dev/null || sleep 1; done",
    ]);
    return { kill: () => child.kill() };
  }
  return undefined;
}
