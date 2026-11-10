// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Полоса с меткой времени: кодирование ↔ декодирование. Запуск: just test

import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeBits, encodeBits, latencyMs, STRIP_CELLS } from "../src/main/strip.ts";

test("метка и счётчик переживают кодирование", () => {
  for (const [ms, n] of [
    [0, 0],
    [1, 65535],
    [1_788_888_888_123, 4242],
    [2 ** 32 - 1, 1],
    [2 ** 41 + 12345, 77],
  ]) {
    const bits = encodeBits(ms, n);
    assert.equal(bits.length, STRIP_CELLS);
    assert.deepEqual(
      decodeBits((i) => bits[i]),
      { ms: ms % 2 ** 32, n },
    );
  }
});

test("испорченный бит или маркер отвергается", () => {
  const bits = encodeBits(1_788_888_888_123, 9);
  for (let i = 0; i < STRIP_CELLS; i++) {
    const bad = bits.slice();
    bad[i] ^= 1;
    assert.equal(
      decodeBits((k) => bad[k]),
      null,
      `бит ${i}`,
    );
  }
});

test("задержка считается по модулю 2^32", () => {
  const stamp = 1_788_888_888_123;
  assert.equal(latencyMs(stamp + 87.5, stamp % 2 ** 32), 87.5);
  // метка перед переполнением младших 32 бит, показ — после
  const edge = 2 ** 32 * 416 - 20;
  assert.equal(latencyMs(edge + 50, (edge % 2 ** 32) >>> 0), 50);
});
