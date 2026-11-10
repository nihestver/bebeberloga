// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Окно-источник: в верхней полосе — метка времени и счётчик кадров чёрно-белыми ячейками,
// ниже — движущиеся фигуры, чтобы энкодеру была настоящая работа.
// Формат полосы — ../main/strip.ts.

import { encodeBits, STRIP_CELLS, STRIP_HEIGHT } from "../main/strip";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
let frame = 0;
let motion = true;

function resize(): void {
  canvas.width = Math.round(innerWidth * devicePixelRatio);
  canvas.height = Math.round(innerHeight * devicePixelRatio);
}
addEventListener("resize", resize);
resize();

interface Shape {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  hue: number;
}
const shapes: Shape[] = Array.from({ length: 28 }, (_, i) => ({
  x: Math.random(),
  y: Math.random(),
  vx: (Math.random() - 0.5) * 0.008,
  vy: (Math.random() - 0.5) * 0.008,
  s: 0.04 + Math.random() * 0.08,
  hue: (i * 37) % 360,
}));

function draw(): void {
  const w = canvas.width;
  const h = canvas.height;
  const stripH = Math.round(h * STRIP_HEIGHT);
  // время берётся в момент отрисовки; до стекла кадр дойдёт на следующем vsync
  const now = Math.round(performance.timeOrigin + performance.now());
  frame = (frame + 1) & 0xffff;

  ctx.fillStyle = "#101418";
  ctx.fillRect(0, stripH, w, h - stripH);
  if (motion) {
    for (const s of shapes) {
      s.x += s.vx;
      s.y += s.vy;
      if (s.x < 0 || s.x > 1) s.vx = -s.vx;
      if (s.y < 0 || s.y > 1) s.vy = -s.vy;
      ctx.fillStyle = `hsl(${s.hue} 60% 50%)`;
      ctx.fillRect(s.x * w, stripH + s.y * (h - stripH - s.s * h), s.s * w, s.s * h);
    }
  }
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(h * 0.09)}px monospace`;
  ctx.fillText(`${new Date(now).toISOString().slice(11, 23)}  #${frame}`, w * 0.03, h * 0.95);

  const bits = encodeBits(now, frame);
  const cell = w / STRIP_CELLS;
  for (let i = 0; i < bits.length; i++) {
    ctx.fillStyle = bits[i] ? "#fff" : "#000";
    ctx.fillRect(Math.floor(i * cell), 0, Math.ceil(cell), stripH);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// Тон 440 Гц — «звук самого приложения» для проверки системного звука.
let audio: AudioContext | undefined;
let osc: OscillatorNode | undefined;

window.__spike = {
  setTone(on: boolean): boolean {
    if (on && !osc) {
      audio ??= new AudioContext();
      void audio.resume();
      const gain = audio.createGain();
      gain.gain.value = 0.2;
      osc = audio.createOscillator();
      osc.frequency.value = 440;
      osc.connect(gain).connect(audio.destination);
      osc.start();
    } else if (!on && osc) {
      osc.stop();
      osc.disconnect();
      osc = undefined;
    }
    return on;
  },
  setMotion(on: boolean): boolean {
    motion = on;
    return on;
  },
};
