// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0
//
// Полоса с меткой времени в кадре источника: чёрно-белые ячейки.
// [белая, чёрная] + 32 бита времени (мс, младшие) + 16 бит счётчика кадров + 8 бит контрольной суммы + [чёрная, белая].
// Файл без импортов: его же загружает тест (node --test).

/** Число ячеек полосы. */
export const STRIP_CELLS = 60;
/** Доля высоты окна часов, занятая полосой. */
export const STRIP_HEIGHT = 0.2;

function checksum(t: number, c: number): number {
  return (
    ((t & 0xff) ^
      ((t >>> 8) & 0xff) ^
      ((t >>> 16) & 0xff) ^
      ((t >>> 24) & 0xff) ^
      (c & 0xff) ^
      (c >>> 8) ^
      0xa5) &
    0xff
  );
}

export function encodeBits(ms: number, counter: number): number[] {
  const t = ms >>> 0;
  const c = counter & 0xffff;
  const sum = checksum(t, c);
  const bits: number[] = [1, 0];
  for (let i = 31; i >= 0; i--) bits.push((t >>> i) & 1);
  for (let i = 15; i >= 0; i--) bits.push((c >>> i) & 1);
  for (let i = 7; i >= 0; i--) bits.push((sum >>> i) & 1);
  bits.push(0, 1);
  return bits;
}

/** null, если маркеры или контрольная сумма не сошлись (смазанный, составной или чужой кадр). */
export function decodeBits(bit: (i: number) => number): { ms: number; n: number } | null {
  if (bit(0) !== 1 || bit(1) !== 0 || bit(STRIP_CELLS - 2) !== 0 || bit(STRIP_CELLS - 1) !== 1)
    return null;
  let t = 0;
  for (let i = 0; i < 32; i++) t = (t * 2 + bit(2 + i)) >>> 0;
  let c = 0;
  for (let i = 0; i < 16; i++) c = (c << 1) | bit(34 + i);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum = (sum << 1) | bit(50 + i);
  return sum === checksum(t, c) ? { ms: t, n: c } : null;
}

/** Разность «время показа − метка» в мс; метка — младшие 32 бита, поэтому по модулю 2^32. */
export function latencyMs(shownEpochMs: number, stampMs: number): number {
  const whole = Math.round(shownEpochMs);
  return (((whole >>> 0) - stampMs) | 0) + (shownEpochMs - whole);
}
