// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Очищенная сводка фактов из results/raw → results/facts.json: разрешения, список источников,
// выбор энкодера, звук, системный пикер, Linux. Названия окон, подписи дорожек и идентификаторы
// источников машины замера в сводку не попадают (кроме идентификаторов портала Linux — они и есть находка).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableJson } from "./json.mjs";

const root = join(import.meta.dirname, "..", "results");
const raw = join(root, "raw");
const read = (name) =>
  existsSync(join(raw, name)) ? JSON.parse(readFileSync(join(raw, name), "utf8")) : undefined;
const files = existsSync(raw) ? readdirSync(raw) : [];

const perm = (p) =>
  p && {
    screen: p.screen,
    osVersion: p.osVersion,
    packaged: p.packaged,
    sessionType: p.sessionType || undefined,
  };
const sourceList = (l) =>
  l && {
    tookMs: l.tookMs,
    error: l.error,
    count: l.sources.length,
    emptyThumbnails: l.sources.filter((s) => s.thumbnailEmpty).length,
    withoutIcon: l.sources.filter((s) => !s.hasIcon).length,
    withoutName: l.sources.filter((s) => !s.name).length,
  };
const track = (t) =>
  t && {
    readyState: t.readyState,
    muted: t.muted,
    settings: pick(t.settings, [
      "width",
      "height",
      "frameRate",
      "displaySurface",
      "channelCount",
      "sampleRate",
      "autoGainControl",
      "echoCancellation",
      "noiseSuppression",
      "deviceId",
    ]),
  };
const capture = (c) =>
  c && {
    error: c.error,
    note: c.note,
    tookMs: c.tookMs,
    videoWidth: c.videoWidth,
    videoHeight: c.videoHeight,
    meanLuma: c.meanLuma,
    video: track(c.video),
    audio: track(c.audio),
  };
const level = (l) =>
  l && {
    error: l.error,
    readyState: l.readyState,
    peakRms: l.peakRms,
    tone440dB: l.tone440dB,
    events: l.events,
  };
function pick(obj, keys) {
  if (!obj) return undefined;
  const out = {};
  // идентификатор источника оставляется только как признак вида (loopback, window:…:s), без номера окна
  for (const k of keys)
    if (obj[k] !== undefined)
      out[k] = k === "deviceId" ? String(obj[k]).replace(/^(window|screen):\d+/, "$1:N") : obj[k];
  return out;
}
const probe = (d) =>
  d && {
    permAtStart: perm(d.permAtStart),
    perm: perm(d.perm),
    windows: sourceList(d.windows),
    screens: sourceList(d.screens),
    capture:
      d.capture && Object.fromEntries(Object.entries(d.capture).map(([k, v]) => [k, capture(v)])),
    codecs: d.codecs,
    encoders: d.encoders,
    systemPicker: d.systemPicker && {
      handlerCalls: d.systemPicker.handlerCalls,
      result: capture(d.systemPicker.result),
    },
  };
const audio = (d) =>
  d &&
  Object.fromEntries(
    Object.entries(d)
      .filter(([k]) => k === "loopback" || k === "loopbackWithMute")
      .map(([mode, r]) => [
        mode,
        {
          start: capture(r.start),
          silence: level(r.silence),
          ownTone: level(r.ownTone),
          external: level(r.external),
        },
      ])
      .concat(
        d.published
          ? [["published", { ...d.published, started: capture(d.published.started) }]]
          : [],
      ),
  );

// размеры собранного кода окон (dist/renderer/assets), если сборка есть
const assets = join(import.meta.dirname, "..", "dist", "renderer", "assets");
const bundleKB = existsSync(assets)
  ? Object.fromEntries(
      readdirSync(assets)
        .filter((f) => f.endsWith(".js"))
        .map((f) => [
          f.replace(/-[\w-]{8}\.js$/, ".js"),
          Math.round(statSync(join(assets, f)).size / 1024),
        ]),
    )
  : undefined;

const facts = {
  note: "Создано scripts/facts.mjs из results/raw; руками не править.",
  bundleKB,
  macos: {
    probe: probe(read("mac-probe.json")),
    withoutPermission: {
      packagedFirstLaunch: probe(read("mac-packaged-noperm-probe.json")),
      neverRequested: probe(read("mac-nokey-noperm-probe.json")),
      afterRebuildWithToggleOn: probe(read("mac-packaged-granted-probe.json")),
    },
    systemPicker: probe(read("mac-picker-probe.json"))?.systemPicker,
    audioFromTerminal: audio(read("mac-dev-audio.json")),
    audioPackaged: audio(read("mac-packaged-audio.json")),
    permissionWait: files
      .filter((f) => /^mac-packaged-permwait-\d+\.json$/.test(f))
      .map((f) => read(f))
      .sort((a, b) => (a.timeline[0]?.at ?? "").localeCompare(b.timeline[0]?.at ?? ""))
      .map((d) => ({
        relaunchedBySystem: d.relaunched,
        grantedWithoutRestart: d.grantedWithoutRestart ?? null,
        timeline: d.timeline.map((t) => ({
          at: t.at,
          status: t.status,
          sourcesListed: t.works,
          error: t.error,
        })),
      })),
  },
  linux: files
    .filter((f) => /^linux-.*-linux\.json$/.test(f))
    .sort()
    .map((f) => {
      const d = read(f);
      const envFile = join(raw, f.replace(/-linux\.json$/, "-env.txt"));
      const portal = (l) =>
        l && {
          tookMs: l.tookMs,
          error: l.error,
          sources: l.sources.map((s) => ({
            id: s.id,
            nameEmpty: !s.name,
            kind: s.kind,
            thumbnailEmpty: s.thumbnailEmpty,
            hasIcon: s.hasIcon,
          })),
        };
      return {
        ozone: d.env.S3_OZONE || "wayland",
        session: { type: d.env.XDG_SESSION_TYPE, desktop: d.env.XDG_CURRENT_DESKTOP },
        // сведения об окружении: ядро, дистрибутив, версии PipeWire и портала (без даты и часового пояса)
        environment: existsSync(envFile)
          ? readFileSync(envFile, "utf8")
              .split("\n")
              .filter((l) => l && !l.startsWith("date:") && !l.startsWith("plasmashell:"))
              .map((l) => l.trim())
          : undefined,
        list: portal(d.list),
        capture: capture(d.capture),
        audio: d.audio && { start: capture(d.audio.start), external: level(d.audio.external) },
        publishedRuns: (d.runs ?? []).map((r) => String(r).split("/").at(-1)),
        listAgain: portal(d.listAgain),
        hardwareCodecs:
          d.codecs &&
          Object.fromEntries(
            Object.entries(d.codecs).map(([k, v]) => [
              k,
              { encodeHw: v.encodeHw, decodeHw: v.decodeHw },
            ]),
          ),
      };
    }),
};

writeFileSync(join(root, "facts.json"), stableJson(facts));
console.log("results/facts.json");
