// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Спайк S3, main-процесс. Три окна: «стример» (выбор источника и публикация), «часы»
// (источник с меткой времени в кадре) и «зритель». Локальный LiveKit запускается отсюда же.
// Режимы (переменная S3_MODE): interactive — ручная работа; matrix — серия замеров;
// probe — снимок разрешений и списка источников в JSON; audio — проверка системного звука;
// permwait — ждать разрешения «Запись экрана», затем проверить захват и звук;
// linux — сценарий портала на Wayland (или X11 при S3_OZONE=x11).

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  powerSaveBlocker,
  screen,
  session,
  shell,
  systemPreferences,
  type Streams,
} from "electron";
import { runAudio, runLinux, runMatrix, runPermWait, runProbe } from "./scenarios";
import { STRIP_HEIGHT } from "./strip";
import {
  type Env,
  type PermissionStatus,
  type ProcSample,
  type SelectRequest,
  type SourceInfo,
  type SourceList,
  type StripRect,
} from "./types";

// Если macOS сама перезапустила приложение («Завершить и открыть снова» после выдачи разрешения),
// переменных окружения уже нет: режим ожидания разрешения сохраняет их в файл и читает отсюда.
const ENV_FILE = join(app.getPath("userData"), "s3-env.json");
let relaunched = false;
// Только у упакованного приложения: иначе забытый файл подменил бы режим у `just run`.
if (app.isPackaged && !process.env.S3_MODE && existsSync(ENV_FILE)) {
  Object.assign(process.env, JSON.parse(readFileSync(ENV_FILE, "utf8")) as Record<string, string>);
  relaunched = true;
}
const MODE = process.env.S3_MODE ?? "interactive";
const APP_ROOT = resolve(__dirname, "..", "..");
// Результаты пишутся рядом с исходниками спайка; у упакованного .app — в S3_OUT или в каталог данных.
const OUT_DIR =
  process.env.S3_OUT ??
  (app.isPackaged ? join(app.getPath("userData"), "results") : join(APP_ROOT, "results", "raw"));
const LIVEKIT_BIN = process.env.S3_LIVEKIT_BIN ?? join(APP_ROOT, "bin", "livekit-server");
const LIVEKIT_PORT = 7880;
// Ключи dev-режима LiveKit (флаг --dev): публичные значения по умолчанию, сервер слушает только loopback.
const DEV_KEY = "devkey";
const DEV_SECRET = "secret";

// Окна не перекрываются и не троттлятся: иначе замер покажет троттлинг, а не конвейер.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env.S3_DISABLE_FEATURES)
  app.commandLine.appendSwitch("disable-features", process.env.S3_DISABLE_FEATURES);
if (process.env.S3_FEATURES)
  app.commandLine.appendSwitch("enable-features", process.env.S3_FEATURES);

export interface Ctx {
  streamer: BrowserWindow;
  clock: BrowserWindow;
  viewer: BrowserWindow;
  env: Env;
  outDir: string;
  sample(): Promise<ProcSample>;
  write(name: string, data: unknown): string;
  /** Снимок содержимого окна в PNG (диагностика; в git не попадает). */
  shot(win: BrowserWindow, name: string): Promise<string>;
  call<T>(win: BrowserWindow, expr: string): Promise<T>;
  listSources(types: ("window" | "screen")[], thumb: number): Promise<SourceList>;
  permissions(): PermissionStatus;
  /** Статус разрешений до первого обращения к захвату. */
  permAtStart: PermissionStatus;
  /** Приложение перезапущено системой, а не сценарием. */
  relaunched: boolean;
  /** Есть ли локальный LiveKit (нужен для публикации). */
  sfuReady: boolean;
  /** Сохранить или убрать окружение для перезапуска системой. */
  persistEnv(on: boolean): void;
  /** Сколько раз вызван обработчик getDisplayMedia (системный пикер его не вызывает). */
  handlerCalls(): number;
  /** Обновить id экрана после выдачи разрешения. */
  refreshScreenSource(): Promise<void>;
  log(msg: string): void;
}

// На Wayland каждый вызов getSources открывает системное окно выбора (портал), поэтому список
// не запрашивается при старте, а обработчик getDisplayMedia берёт источник из последнего списка.
const WAYLAND =
  process.platform === "linux" &&
  process.env.XDG_SESSION_TYPE === "wayland" &&
  process.env.S3_OZONE !== "x11";
let lastSources: Electron.DesktopCapturerSource[] = [];
let handlerCalls = 0;

let pending: SelectRequest = { sourceId: "", audio: "none", systemPicker: false };
let sfu: ChildProcess | undefined;
let staticServer: Server | undefined;

function log(msg: string): void {
  console.log(`[s3 ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

// --- статика окон: http://127.0.0.1 — безопасный контекст, getDisplayMedia и worker работают ---

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
};

function serveStatic(): Promise<number> {
  const root = join(APP_ROOT, "dist", "renderer");
  return new Promise((done, fail) => {
    const srv = createServer((req, res) => {
      const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
      const file = join(root, path);
      if (!file.startsWith(root) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(res);
    });
    srv.on("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      staticServer = srv;
      const addr = srv.address();
      if (addr && typeof addr === "object") done(addr.port);
      else fail(new Error("нет адреса статики"));
    });
  });
}

// --- локальный LiveKit ---

function portOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      done(true);
    });
    s.once("error", () => done(false));
  });
}

async function startSfu(): Promise<void> {
  if (await portOpen(LIVEKIT_PORT)) {
    log(`LiveKit уже слушает ${LIVEKIT_PORT} — использую его`);
    return;
  }
  if (!existsSync(LIVEKIT_BIN)) throw new Error(`нет ${LIVEKIT_BIN}: выполни just livekit`);
  sfu = spawn(LIVEKIT_BIN, ["--dev", "--bind", "127.0.0.1", "--node-ip", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile: string[] = [];
  sfu.stdout?.on("data", (d: Buffer) => logFile.push(d.toString()));
  sfu.stderr?.on("data", (d: Buffer) => logFile.push(d.toString()));
  sfu.on("exit", (code) => log(`LiveKit завершился: ${code}`));
  for (let i = 0; i < 50; i++) {
    if (await portOpen(LIVEKIT_PORT)) return;
    await sleep(200);
  }
  throw new Error(`LiveKit не поднялся: ${logFile.join("").slice(-800)}`);
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

/** Токен доступа в комнату: JWT HS256 с правами входа, публикации и подписки. */
function accessToken(room: string, identity: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: DEV_KEY,
      sub: identity,
      nbf: now - 10,
      exp: now + 3600,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true },
    }),
  );
  const sig = createHmac("sha256", DEV_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// --- источники и разрешения ---

async function listSources(types: ("window" | "screen")[], thumb: number): Promise<SourceList> {
  const t0 = performance.now();
  try {
    const raw = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: thumb, height: Math.round((thumb * 9) / 16) },
      fetchWindowIcons: true,
    });
    lastSources = raw;
    const sources: SourceInfo[] = raw.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
      displayId: s.display_id,
      thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL(),
      thumbnailEmpty: s.thumbnail.isEmpty(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : "",
    }));
    return { sources, tookMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return { sources: [], tookMs: Math.round(performance.now() - t0), error: String(e) };
  }
}

function permissions(): PermissionStatus {
  const mac = process.platform === "darwin";
  return {
    platform: process.platform,
    osVersion: process.getSystemVersion(),
    screen:
      mac || process.platform === "win32"
        ? systemPreferences.getMediaAccessStatus("screen")
        : "n/a",
    microphone:
      mac || process.platform === "win32"
        ? systemPreferences.getMediaAccessStatus("microphone")
        : "n/a",
    sessionType: process.env.XDG_SESSION_TYPE ?? "",
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    packaged: app.isPackaged,
  };
}

/** Обработчик getDisplayMedia: источник выбирает окно стримера, системный пикер — по запросу. */
function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      handlerCalls++;
      const req = pending;
      void (async () => {
        try {
          let src = lastSources.find((s) => s.id === req.sourceId);
          if (!src && !WAYLAND) {
            const all = await desktopCapturer.getSources({
              types: ["window", "screen"],
              thumbnailSize: { width: 0, height: 0 },
            });
            src = all.find((s) => s.id === req.sourceId);
          }
          if (!src) {
            log(`источник ${req.sourceId} не найден`);
            callback({} as Streams);
            return;
          }
          const streams: Streams = { video: src };
          if (request.audioRequested && req.audio !== "none") streams.audio = req.audio;
          callback(streams);
        } catch (e) {
          log(`обработчик захвата: ${String(e)}`);
          try {
            callback({} as Streams);
          } catch {
            // запрос уже отклонён
          }
        }
      })();
    },
    { useSystemPicker: pending.systemPicker },
  );
}

// --- метрики ---

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((done) =>
    execFile(cmd, args, { timeout: 3000 }, (_err, out) => done(out ?? "")),
  );
}

/** Загрузка GPU: на macOS — «Device Utilization %» ускорителя из ioreg (без sudo); иначе null. */
async function gpuUtil(): Promise<number | null> {
  if (process.platform !== "darwin") return null;
  const out = await exec("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]);
  const m = /"Device Utilization %"=(\d+)/.exec(out);
  return m?.[1] ? Number(m[1]) : null;
}

/** Накопленное процессорное время процессов по ps, секунды (формат [ЧЧ:]ММ:СС.сс). */
async function cpuTimes(pids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (process.platform === "win32" || pids.length === 0) return out;
  const text = await exec("ps", ["-o", "pid=,time=", "-p", pids.join(",")]);
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+([\d:.,-]+)/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const parts = m[2].replace(",", ".").replace("-", ":").split(":").map(Number);
    out.set(
      Number(m[1]),
      parts.reduce((acc, v) => acc * 60 + v, 0),
    );
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- окна ---

function makeWindow(
  page: string,
  port: number,
  opts: Electron.BrowserWindowConstructorOptions,
): BrowserWindow {
  const win = new BrowserWindow({
    ...opts,
    show: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (e) => {
    if (e.message.includes("Electron Security Warning")) return; // CSP: статика спайка отдаётся только с loopback
    if (process.env.S3_VERBOSE || e.level === "error" || e.level === "warning")
      log(`${page}: ${e.message}`);
  });
  void win.loadURL(`http://127.0.0.1:${port}/${page}`);
  return win;
}

async function main(): Promise<void> {
  await app.whenReady();
  powerSaveBlocker.start("prevent-display-sleep");
  mkdirSync(OUT_DIR, { recursive: true });
  // окна спрашивают env сразу при загрузке — обработчик ставится до их создания
  let envReady: (env: Env) => void = () => undefined;
  const envPromise = new Promise<Env>((r) => (envReady = r));
  ipcMain.handle("env", () => envPromise);
  const port = await serveStatic();
  let sfuReady = false;
  if (MODE === "interactive" || MODE === "matrix") {
    await startSfu();
    sfuReady = true;
  } else if (MODE === "audio" || MODE === "permwait" || MODE === "linux") {
    sfuReady = await startSfu().then(
      () => true,
      (e: unknown) => {
        log(`без LiveKit: ${String(e)}`);
        return false;
      },
    );
  }
  // сторож для запуска через open(1): системный диалог разрешения может держать сценарий бесконечно
  const limit = Number(process.env.S3_TIMEOUT ?? 0);
  if (limit > 0)
    setTimeout(() => {
      log(`сторож: ${limit} с истекли`);
      shutdown();
      app.exit(3);
    }, limit * 1000);
  installDisplayMediaHandler();

  // Раскладка без перекрытий: часы 960×540 pt слева сверху (на Retina ×2 — ровно 1920×1080 пикселей),
  // зритель справа от них, стример под часами.
  const disp = screen.getPrimaryDisplay();
  const wa = disp.workArea;
  const clockW = wa.width >= 1280 ? 960 : Math.floor(wa.width * 0.7);
  const clockH = Math.round((clockW * 9) / 16);
  const clock = makeWindow("clock.html", port, {
    x: wa.x,
    y: wa.y,
    width: clockW,
    height: clockH,
    frame: false,
    hasShadow: false,
    minWidth: 100,
    minHeight: 100,
    title: "S3 часы",
  });
  // macOS может выставить окну другую высоту: ширина подгоняется под 16:9 по фактической
  const real = clock.getBounds();
  if (real.height !== clockH)
    clock.setBounds({
      x: wa.x,
      y: wa.y,
      width: Math.min(wa.width - 240, Math.round((real.height * 16) / 9)),
      height: real.height,
    });
  const clockRight = clock.getBounds().width;
  const viewerW = Math.max(240, Math.min(wa.width - clockRight, 960));
  const viewer = makeWindow("viewer.html", port, {
    x: wa.x + clockRight,
    y: wa.y,
    width: viewerW,
    height: Math.round((viewerW * 9) / 16) + 28,
    title: "S3 зритель",
  });
  const streamer = makeWindow("streamer.html", port, {
    x: wa.x,
    y: wa.y + clock.getBounds().height,
    width: clockRight,
    height: Math.max(200, wa.height - clock.getBounds().height),
    title: "S3 стример",
  });
  await Promise.all(
    [clock, viewer, streamer].map(
      (w) => new Promise<void>((r) => w.webContents.once("did-finish-load", () => r())),
    ),
  );

  const roles = new Map<number, string>([
    [clock.webContents.getOSProcessId(), "clock"],
    [viewer.webContents.getOSProcessId(), "viewer"],
    [streamer.webContents.getOSProcessId(), "streamer"],
  ]);

  const permAtStart = permissions();
  log(`запись экрана до первого обращения: ${permAtStart.screen}`);
  // без разрешения «Запись экрана» getSources на macOS отклоняется («Failed to get sources.»)
  const screens = WAYLAND
    ? []
    : await desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
        .catch((e: unknown) => {
          log(`список экранов недоступен: ${String(e)}`);
          return [];
        });
  const primary = screens.find((s) => s.display_id === String(disp.id)) ?? screens[0];
  const cb = clock.getBounds();
  log(
    `экран ${disp.bounds.width}×${disp.bounds.height} pt ×${disp.scaleFactor}, ${disp.displayFrequency} Гц; часы ${cb.width}×${cb.height} pt; зритель ${viewer.getBounds().width}×${viewer.getBounds().height} pt`,
  );
  const stripScreen: StripRect = {
    x: (cb.x - disp.bounds.x) / disp.bounds.width,
    y: (cb.y - disp.bounds.y) / disp.bounds.height,
    w: cb.width / disp.bounds.width,
    h: (cb.height * STRIP_HEIGHT) / disp.bounds.height,
  };
  const env: Env = {
    livekitUrl: `ws://127.0.0.1:${LIVEKIT_PORT}`,
    mode: MODE,
    clockSourceId: clock.getMediaSourceId(),
    screenSourceId: primary?.id ?? "",
    clockStripWindow: { x: 0, y: 0, w: 1, h: STRIP_HEIGHT },
    clockStripScreen: stripScreen,
  };

  envReady(env);
  ipcMain.handle("sources:list", (_e, types: ("window" | "screen")[], thumb: number) =>
    listSources(types, thumb),
  );
  ipcMain.handle("capture:select", (_e, req: SelectRequest) => {
    const pickerChanged = req.systemPicker !== pending.systemPicker;
    pending = req;
    if (pickerChanged) installDisplayMediaHandler();
  });
  ipcMain.handle("perm:status", () => permissions());
  ipcMain.handle("perm:open-settings", () =>
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    ),
  );
  ipcMain.handle("token", (_e, room: string, identity: string) => accessToken(room, identity));
  ipcMain.on("log", (_e, msg: string) => log(String(msg)));

  const ctx: Ctx = {
    streamer,
    clock,
    viewer,
    env,
    outDir: OUT_DIR,
    log,
    listSources,
    permissions,
    permAtStart,
    relaunched,
    sfuReady,
    handlerCalls: () => handlerCalls,
    persistEnv(on) {
      if (on) {
        const keep = Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k.startsWith("S3_")),
        );
        writeFileSync(ENV_FILE, JSON.stringify(keep));
      } else rmSync(ENV_FILE, { force: true });
    },
    async refreshScreenSource() {
      const list = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      env.screenSourceId =
        (list.find((x) => x.display_id === String(disp.id)) ?? list[0])?.id ?? "";
    },
    async sample() {
      const metrics = app.getAppMetrics();
      const pids = metrics.map((m) => m.pid);
      if (sfu?.pid) pids.push(sfu.pid);
      const [gpu, times] = await Promise.all([gpuUtil(), cpuTimes(pids)]);
      return {
        t: Date.now(),
        gpuUtil: gpu,
        sfuCpu: null,
        sfuCpuTimeS: sfu?.pid ? (times.get(sfu.pid) ?? null) : null,
        procs: metrics.map((m) => ({
          type: m.type,
          role: roles.get(m.pid) ?? m.name ?? m.serviceName ?? "",
          pid: m.pid,
          cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
          memKB: m.memory.workingSetSize,
          cpuTimeS: times.get(m.pid) ?? null,
        })),
      };
    },
    write(name, data) {
      const file = join(OUT_DIR, name);
      writeFileSync(file, JSON.stringify(data, null, 1));
      return file;
    },
    async shot(win, name) {
      const file = join(OUT_DIR, name);
      writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      return file;
    },
    call<T>(win: BrowserWindow, expr: string): Promise<T> {
      // userGesture = true: getDisplayMedia требует жеста пользователя
      return win.webContents.executeJavaScript(expr, true) as Promise<T>;
    },
  };

  if (MODE === "interactive") return;
  let code = 0;
  try {
    if (MODE === "matrix") await runMatrix(ctx);
    else if (MODE === "probe") await runProbe(ctx);
    else if (MODE === "audio") await runAudio(ctx);
    else if (MODE === "permwait") await runPermWait(ctx);
    else if (MODE === "linux") await runLinux(ctx);
    else throw new Error(`неизвестный S3_MODE=${MODE}`);
  } catch (e) {
    log(`сценарий упал: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    code = 1;
  }
  shutdown();
  app.exit(code);
}

function shutdown(): void {
  sfu?.kill("SIGTERM");
  staticServer?.close();
}

app.on("window-all-closed", () => {
  shutdown();
  app.quit();
});
app.on("before-quit", shutdown);

void main().catch((e) => {
  console.error(e);
  shutdown();
  app.exit(1);
});
