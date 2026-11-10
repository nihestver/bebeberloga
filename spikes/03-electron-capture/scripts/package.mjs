// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Упаковка спайка в приложение (out/) и размеры сборки. На macOS в Info.plist добавляется
// NSAudioCaptureUsageDescription: без ключа системный звук через getDisplayMedia не отдаётся.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packager } from "@electron/packager";
import { stableJson } from "./json.mjs";

const root = join(import.meta.dirname, "..");
const withAudioKey = process.env.S3_NO_AUDIO_KEY !== "1";

// Стандартный Info.plist Electron 45 уже содержит NSAudioCaptureUsageDescription; вариант «без ключа»
// (S3_NO_AUDIO_KEY=1) удаляет его после упаковки. Оба варианта подписываются ad hoc со своим
// идентификатором: разрешения macOS (TCC) привязываются к нему, а не к общему бинарнику Electron.
const [appPath] = await packager({
  dir: root,
  out: join(root, "out"),
  name: withAudioKey ? "S3Capture" : "S3CaptureNoKey",
  appBundleId: withAudioKey ? "org.bebeberloga.spike.s3" : "org.bebeberloga.spike.s3nokey",
  overwrite: true,
  asar: true,
  prune: true,
  // в сборку идёт только собранный код: livekit-client уже внутри бандла окон, node_modules не нужен
  ignore: [
    /^\/src/,
    /^\/scripts/,
    /^\/results/,
    /^\/out/,
    /^\/bin/,
    /^\/node_modules/,
    /^\/[^/]+\.(md|ts)$/,
    /^\/justfile$/,
    /^\/tsconfig/,
    /^\/package-lock\.json$/,
  ],
  // готовый архив Electron (если сеть медленная): каталог с electron-v<версия>-<платформа>-<арх>.zip
  ...(process.env.S3_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.S3_ELECTRON_ZIP_DIR } : {}),
  extendInfo: withAudioKey
    ? {
        NSAudioCaptureUsageDescription: "Спайк S3 передаёт в стрим звук системы.",
        NSMicrophoneUsageDescription: "Спайк S3 не использует микрофон.",
      }
    : {},
});

// символические ссылки не раскрываются: во фреймворках macOS Versions/Current ведёт на тот же каталог
if (process.platform === "darwin") {
  const app = join(
    appPath,
    readdirSync(appPath).find((f) => f.endsWith(".app")),
  );
  if (!withAudioKey)
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      "Delete :NSAudioCaptureUsageDescription",
      join(app, "Contents", "Info.plist"),
    ]);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
}

function du(path) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, f) => sum + du(join(path, f)), 0);
}
const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

const sizes = { appPath, platform: process.platform, arch: process.arch, totalMB: mb(du(appPath)) };
if (process.platform === "darwin") {
  const app = join(
    appPath,
    readdirSync(appPath).find((f) => f.endsWith(".app")),
  );
  const res = join(app, "Contents", "Resources");
  sizes.appBundleMB = mb(du(app));
  sizes.frameworksMB = mb(du(join(app, "Contents", "Frameworks")));
  sizes.appAsarMB = mb(du(join(res, "app.asar")));
  sizes.localesMB = mb(
    readdirSync(res)
      .filter((f) => f.endsWith(".lproj"))
      .reduce((s, f) => s + du(join(res, f)), 0),
  );
  const zip = join(root, "out", "S3Capture.zip");
  if (withAudioKey) {
    execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
    sizes.zipMB = mb(statSync(zip).size);
  }
} else {
  const res = join(appPath, "resources");
  if (existsSync(join(res, "app.asar"))) sizes.appAsarMB = mb(du(join(res, "app.asar")));
}
console.log(JSON.stringify(sizes, null, 1));
if (withAudioKey) {
  // путь сборки в файл не пишется: он содержит домашний каталог того, кто собирал
  const { appPath: _appPath, ...saved } = sizes;
  writeFileSync(
    join(root, "results", `size-${process.platform}-${process.arch}.json`),
    stableJson(saved),
  );
}
