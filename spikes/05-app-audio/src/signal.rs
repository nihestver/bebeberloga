// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Тестовый сигнал: какие тоны кто издаёт и как выглядит щелчок.
//!
//! Все частоты кратны 10 Гц, поэтому в окне анализа 100 мс укладывается целое число
//! периодов каждого тона: тоны не мешают друг другу, а фаза тона от окна к окну
//! постоянна, пока в записи нет пропавших или лишних сэмплов.

/// Тон главного процесса тестового источника.
pub const TONE_PARENT_HZ: f64 = 440.0;
/// Тон дочернего процесса тестового источника.
pub const TONE_CHILD_HZ: f64 = 880.0;
/// Тон постороннего процесса: в звук приложения попасть не должен.
pub const TONE_FOREIGN_HZ: f64 = 1320.0;
/// Тон самой программы захвата: не должен попасть ни в один режим, кроме «вся система как есть».
pub const TONE_SELF_HZ: f64 = 2000.0;
/// Частота заполнения щелчка.
pub const CLICK_HZ: f64 = 6000.0;

/// Амплитуда тонов. Тихо (−34 дБ полной шкалы), чтобы десять минут прогона не мешали;
/// для записи в float32 этого с большим запасом достаточно.
pub const TONE_AMP: f32 = 0.02;
/// Амплитуда щелчка.
pub const CLICK_AMP: f32 = 0.1;
/// Длительность щелчка, мс.
pub const CLICK_MS: u32 = 5;
/// Период «вспышка + щелчок», мс.
pub const MARK_PERIOD_MS: u64 = 1000;
/// Длительность вспышки, мс.
pub const FLASH_MS: u64 = 150;

/// Генератор тона с непрерывной фазой и необязательным щелчком.
pub struct ToneGen {
    rate: f64,
    tone_hz: f64,
    tone_phase: f64,
    click_left: u32,
    click_pos: u32,
}

impl ToneGen {
    pub fn new(rate: u32, tone_hz: f64) -> Self {
        Self {
            rate: rate as f64,
            tone_hz,
            tone_phase: 0.0,
            click_left: 0,
            click_pos: 0,
        }
    }

    /// Начать щелчок со следующего сэмпла.
    pub fn start_click(&mut self) {
        self.click_left = (self.rate * CLICK_MS as f64 / 1000.0) as u32;
        self.click_pos = 0;
    }

    /// Следующий сэмпл (одинаковый для всех каналов).
    pub fn next_sample(&mut self) -> f32 {
        let two_pi = std::f64::consts::TAU;
        let mut v = (self.tone_phase * two_pi).sin() as f32 * TONE_AMP;
        self.tone_phase += self.tone_hz / self.rate;
        if self.tone_phase >= 1.0 {
            self.tone_phase -= 1.0;
        }
        if self.click_left > 0 {
            let t = self.click_pos as f64 / self.rate;
            v += (t * CLICK_HZ * two_pi).sin() as f32 * CLICK_AMP;
            self.click_pos += 1;
            self.click_left -= 1;
        }
        v
    }
}
