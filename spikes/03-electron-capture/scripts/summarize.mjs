// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Сводка по прогонам матрицы: results/raw/*.json → results/summary.json и results/summary.md.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableJson } from "./json.mjs";

const root = join(import.meta.dirname, "..", "results");
const raw = join(root, "raw");

const q = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) =>
  x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10) / 10;
const mode = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const delta = (samples, pick) => {
  const vals = samples.map(pick).filter((v) => typeof v === "number");
  return vals.length >= 2 ? vals[vals.length - 1] - vals[0] : null;
};

export function summarize(run) {
  const frames = run.viewer.frames ?? [];
  const lat = frames.map((f) => f.lat).sort((a, b) => a - b);
  const latCb = frames.map((f) => f.latCb).sort((a, b) => a - b);
  const out = (s) =>
    s.stats.find(
      (x) => x.type === "outbound-rtp" && x.kind === "video" && (x.frameWidth ?? 0) > 0,
    ) ?? s.stats.find((x) => x.type === "outbound-rtp");
  const src = (s) => s.stats.find((x) => x.type === "media-source");
  const inb = (s) => s.video.find((x) => x.type === "inbound-rtp");
  const ss = run.streamer.samples ?? [];
  const vs = run.viewer.stats ?? [];
  const span = ss.length >= 2 ? (ss[ss.length - 1].t - ss[0].t) / 1000 : null;
  const sentRes = mode(ss.map((s) => `${out(s)?.frameWidth}×${out(s)?.frameHeight}`));
  const recvRes = mode(frames.map((f) => `${f.w}×${f.h}`));
  const limit = mode(ss.map((s) => out(s)?.qualityLimitationReason ?? "?"));
  const codec = ss.at(-1)?.stats.find((x) => x.type === "codec")?.mimeType ?? null;
  const encFrames = delta(ss, (s) => out(s)?.framesEncoded);
  const decFrames = delta(vs, (s) => inb(s)?.framesDecoded);
  const emitted = delta(vs, (s) => inb(s)?.jitterBufferEmittedCount);
  // CPU — в процентах одного ядра: прирост процессорного времени (ps) за окно замера
  const first = run.procs[0];
  const lastP = run.procs.at(-1);
  const wall = first && lastP ? (lastP.t - first.t) / 1000 : 0;
  const cpu = {};
  const memMB = {};
  for (const pr of lastP?.procs ?? []) {
    const key = pr.role || pr.type;
    const before = first.procs.find((x) => x.pid === pr.pid);
    if (before && pr.cpuTimeS !== null && before.cpuTimeS !== null && wall > 0)
      cpu[key] = r1((cpu[key] ?? 0) + ((pr.cpuTimeS - before.cpuTimeS) / wall) * 100);
    memMB[key] =
      (memMB[key] ?? 0) +
      Math.round(
        Math.max(...run.procs.map((p) => p.procs.find((x) => x.pid === pr.pid)?.memKB ?? 0)) / 1024,
      );
  }
  const sfuCpu =
    first && lastP && first.sfuCpuTimeS !== null && lastP.sfuCpuTimeS !== null && wall > 0
      ? r1(((lastP.sfuCpuTimeS - first.sfuCpuTimeS) / wall) * 100)
      : null;
  const capture = run.started?.video?.settings ?? {};
  return {
    name: run.name,
    os: `${run.perm.platform} ${run.perm.osVersion}`,
    electron: run.perm.electron,
    chrome: run.perm.chrome,
    ...run.spec,
    durationS: run.durationS,
    measuredAt: first ? new Date(first.t).toISOString() : null,
    capture: `${capture.width}×${capture.height}@${r1(capture.frameRate)}`,
    sourceFps: r1(
      q(
        ss.map((s) => src(s)?.framesPerSecond ?? 0).sort((a, b) => a - b),
        0.5,
      ),
    ),
    sent: sentRes.map(([k, n]) => `${k} (${Math.round((n / ss.length) * 100)} %)`).join(", "),
    sentFps: r1(encFrames !== null && span ? encFrames / span : null),
    bitrateMbps: r1(span ? ((delta(ss, (s) => out(s)?.bytesSent) ?? 0) * 8) / span / 1e6 : null),
    encoder: out(ss.at(-1) ?? { stats: [] })?.encoderImplementation ?? null,
    // то, что сообщает энкодер в outbound-rtp; у OpenH264 это L1T1, даже если режим не задавался
    scalabilityMode: out(ss.at(-1) ?? { stats: [] })?.scalabilityMode ?? null,
    hwEncoder: out(ss.at(-1) ?? { stats: [] })?.powerEfficientEncoder ?? null,
    codec,
    encodeMsPerFrame: r1(
      encFrames ? ((delta(ss, (s) => out(s)?.totalEncodeTime) ?? 0) / encFrames) * 1000 : null,
    ),
    keyFrames: delta(ss, (s) => out(s)?.keyFramesEncoded),
    qualityLimit: limit.map(([k, n]) => `${k} ${Math.round((n / ss.length) * 100)} %`).join(", "),
    received: recvRes
      .map(([k, n]) => `${k} (${Math.round((n / frames.length) * 100)} %)`)
      .join(", "),
    viewerFps: r1(run.viewer.callbacks / run.durationS),
    decodedStampShare: r1(
      (frames.length / Math.max(1, frames.length + run.viewer.undecoded)) * 100,
    ),
    latencyMeanMs: r1(mean(lat)),
    latencyMs: {
      p50: r1(q(lat, 0.5)),
      p95: r1(q(lat, 0.95)),
      p99: r1(q(lat, 0.99)),
      min: r1(lat[0] ?? null),
      max: r1(lat.at(-1) ?? null),
    },
    latencyToCallbackP50: r1(q(latCb, 0.5)),
    decoder: inb(vs.at(-1) ?? { video: [] })?.decoderImplementation ?? null,
    hwDecoder: inb(vs.at(-1) ?? { video: [] })?.powerEfficientDecoder ?? null,
    jitterBufferMs: r1(
      emitted ? ((delta(vs, (s) => inb(s)?.jitterBufferDelay) ?? 0) / emitted) * 1000 : null,
    ),
    decodeMsPerFrame: r1(
      decFrames ? ((delta(vs, (s) => inb(s)?.totalDecodeTime) ?? 0) / decFrames) * 1000 : null,
    ),
    framesDropped: delta(vs, (s) => inb(s)?.framesDropped),
    freezes: delta(vs, (s) => inb(s)?.freezeCount),
    firstFrameMs: run.viewer.firstFrameMs,
    cpu,
    cpuTotal: r1(Object.values(cpu).reduce((a, b) => a + (b ?? 0), 0)),
    memMB,
    memTotalMB: Object.values(memMB).reduce((a, b) => a + b, 0),
    gpuUtil: r1(mean(run.procs.map((p) => p.gpuUtil).filter((v) => v !== null))),
    sfuCpu,
    encryptionErrors: [...(run.viewer.roomEvents ?? []), ...(run.streamer.roomEvents ?? [])].filter(
      (e) => e.includes("encryptionError"),
    ).length,
    viewerEncrypted: (run.viewer.roomEvents ?? []).some((e) => e.includes("encrypted=true")),
  };
}

const PRESET_ORDER = ["720p30", "1080p30", "1080p60"];
const codecName = (r) => (r.codec ?? "").replace("video/", "");
const order = (r) =>
  [
    r.source,
    codecName(r),
    PRESET_ORDER.indexOf(r.preset),
    r.simulcast ? 1 : 0,
    r.wrongKey ? 1 : 0,
    r.e2ee ? 0 : 1,
  ].join("|");

if (process.argv[1] === import.meta.filename) {
  const runs = readdirSync(raw)
    .filter((f) => f.endsWith(".json") && !f.includes("probe") && !f.includes("audio"))
    .map((f) => JSON.parse(readFileSync(join(raw, f), "utf8")))
    .filter((r) => r?.spec)
    .map(summarize)
    .sort((a, b) => order(a).localeCompare(order(b)));
  writeFileSync(join(root, "summary.json"), stableJson(runs));
  const table = (head, rows) =>
    [
      `| ${head.join(" | ")} |`,
      `|${head.map(() => "---").join("|")}|`,
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n");
  const label = (r) =>
    `${r.source === "window" ? "окно" : r.source === "screen" ? "экран" : r.source} · ${codecName(r)} · ${r.preset}${r.simulcast ? " + simulcast" : ""}${r.wrongKey ? " (чужой ключ)" : ""}`;
  const c = (r, k) => r.cpu[k] ?? 0;
  const sections = [];
  for (const os of [...new Set(runs.map((r) => r.os))]) {
    const normal = runs.filter((r) => r.os === os && !r.wrongKey);
    const main = table(
      [
        "Источник · кодек · пресет",
        "E2EE",
        "Захват",
        "Отправлено",
        "к/с отпр.",
        "Мбит/с",
        "Энкодер",
        "Задержка средн. / p50 / p95 / p99, мс",
        "к/с у зрителя",
        "Jitter-буфер, мс",
        "Фризы",
        "Меток прочитано, %",
      ],
      normal.map((r) => [
        label(r),
        r.e2ee ? "да" : "нет",
        r.capture,
        r.sent,
        r.sentFps,
        r.bitrateMbps,
        `${r.encoder}${r.hwEncoder ? " (аппаратный)" : " (программный)"}`,
        `${r.latencyMeanMs} / ${r.latencyMs.p50} / ${r.latencyMs.p95} / ${r.latencyMs.p99}`,
        r.viewerFps,
        r.jitterBufferMs,
        r.freezes,
        r.decodedStampShare,
      ]),
    );
    const load = table(
      [
        "Источник · кодек · пресет",
        "E2EE",
        "CPU стример",
        "CPU GPU-процесс",
        "CPU зритель",
        "CPU часы",
        "CPU прочее",
        "CPU всего",
        "GPU, %",
        "SFU, % ядра",
        "Память стример / GPU / зритель / всего, МБ",
        "Кодирование, мс/кадр",
        "Декодирование, мс/кадр",
      ],
      normal.map((r) => [
        label(r),
        r.e2ee ? "да" : "нет",
        c(r, "streamer"),
        c(r, "GPU"),
        c(r, "viewer"),
        c(r, "clock"),
        r1(r.cpuTotal - c(r, "streamer") - c(r, "GPU") - c(r, "viewer") - c(r, "clock")),
        r.cpuTotal,
        r.gpuUtil,
        r.sfuCpu,
        `${r.memMB.streamer} / ${r.memMB.GPU} / ${r.memMB.viewer} / ${r.memTotalMB}`,
        r.encodeMsPerFrame,
        r.decodeMsPerFrame,
      ]),
    );
    // Добавка E2EE: пары прогонов, отличающиеся только шифрованием. «Подряд» — оба прогона сделаны
    // один за другим (между замерами меньше 5 минут); пары с повторённым позже прогоном сравнивают
    // разные условия и в выводы о добавке E2EE не входят.
    const pairs = [];
    for (const on of normal.filter((r) => r.e2ee)) {
      const off = normal.find(
        (r) =>
          !r.e2ee &&
          r.source === on.source &&
          r.preset === on.preset &&
          r.codec === on.codec &&
          r.simulcast === on.simulcast,
      );
      if (!off) continue;
      const gapMin =
        on.measuredAt && off.measuredAt
          ? Math.abs(Date.parse(on.measuredAt) - Date.parse(off.measuredAt)) / 60000
          : null;
      pairs.push([
        label(on),
        gapMin !== null && gapMin < 5
          ? "да"
          : `нет (${gapMin === null ? "?" : Math.round(gapMin)} мин)`,
        r1(on.latencyMeanMs - off.latencyMeanMs),
        r1(on.latencyMs.p50 - off.latencyMs.p50),
        r1(on.jitterBufferMs - off.jitterBufferMs),
        r1(c(on, "streamer") - c(off, "streamer")),
        r1(c(on, "viewer") - c(off, "viewer")),
        r1(on.cpuTotal - off.cpuTotal),
      ]);
    }
    const wrong = runs
      .filter((r) => r.os === os && r.wrongKey)
      .map(
        (r) =>
          `- ${label(r)}: кадров у зрителя ${r.viewerFps} к/с, ошибок расшифровки в журнале ${r.encryptionErrors}.`,
      );
    sections.push(
      `## ${os} · Electron ${normal[0]?.electron} (Chromium ${normal[0]?.chrome})`,
      "",
      "### Конвейер",
      "",
      main,
      "",
      "### Нагрузка",
      "",
      load,
      "",
    );
    if (pairs.length)
      sections.push(
        "### Добавка E2EE (с шифрованием минус без)",
        "",
        table(
          [
            "Источник · кодек · пресет",
            "Подряд",
            "Δ средней задержки, мс",
            "Δ p50, мс",
            "Δ jitter-буфера, мс",
            "Δ CPU стримера",
            "Δ CPU зрителя",
            "Δ CPU всего",
          ],
          pairs,
        ),
        "",
      );
    if (wrong.length) sections.push("### Зритель с чужим ключом", "", ...wrong, "");
  }
  writeFileSync(
    join(root, "summary.md"),
    [
      "<!-- Создано scripts/summarize.mjs из results/raw; руками не править. CPU — проценты одного ядра. -->",
      ...sections,
    ].join("\n"),
  );
  console.log(`${runs.length} прогонов → results/summary.{json,md}`);
}
