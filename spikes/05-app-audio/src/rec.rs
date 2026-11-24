// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Приёмники захвата: WAV со звуком и журналы меток.
//!
//! Файлы в каталоге прогона:
//! - `audio.wav` — стерео 48 кГц float32, сэмплы в том порядке, в каком их отдала ОС;
//! - `audio-chunks.tsv` — по строке на буфер: метка первого кадра (нс), время прихода (нс),
//!   число кадров, флаги ОС;
//! - `video-marks.tsv` — по строке на кадр: метка кадра (нс), время прихода (нс), размер
//!   кадра в физических пикселях, яркость контрольной точки, метод захвата, масштаб
//!   экрана (1.25 — это 125 %; 0 — ОС масштаб не сообщила).

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::clock::now_ns;
use crate::model::{Res, CHANNELS, SAMPLE_RATE};

/// Флаг буфера: ОС сообщила о разрыве потока.
pub const FLAG_DISCONTINUITY: u32 = 1;
/// Флаг буфера: ОС пометила буфер как тишину.
pub const FLAG_SILENT: u32 = 2;
/// Флаг буфера: метка времени от ОС недостоверна, взято время прихода.
pub const FLAG_TIMESTAMP_FALLBACK: u32 = 4;

struct AudioInner {
    wav: Option<hound::WavWriter<BufWriter<File>>>,
    chunks: BufWriter<File>,
}

/// Приёмник звука.
pub struct AudioSink {
    inner: Mutex<AudioInner>,
    frames: AtomicU64,
    buffers: AtomicU64,
}

impl AudioSink {
    pub fn create(dir: &Path) -> Res<Self> {
        let spec = hound::WavSpec {
            channels: CHANNELS as u16,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let wav = hound::WavWriter::create(dir.join("audio.wav"), spec)?;
        let mut chunks = BufWriter::new(File::create(dir.join("audio-chunks.tsv"))?);
        writeln!(chunks, "t_ns\tarrival_ns\tframes\tflags")?;
        Ok(Self {
            inner: Mutex::new(AudioInner {
                wav: Some(wav),
                chunks,
            }),
            frames: AtomicU64::new(0),
            buffers: AtomicU64::new(0),
        })
    }

    /// Принять буфер: `t_ns` — метка первого кадра по монотонной шкале,
    /// `interleaved` — стерео float32 вперемежку.
    pub fn push(&self, t_ns: u64, interleaved: &[f32], flags: u32) {
        self.push_at(t_ns, now_ns(), interleaved, flags);
    }

    /// То же, но время прихода буфера в программу задаёт вызывающая сторона.
    pub fn push_at(&self, t_ns: u64, arrival: u64, interleaved: &[f32], flags: u32) {
        let frames = (interleaved.len() / CHANNELS) as u64;
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if let Some(wav) = inner.wav.as_mut() {
            for s in interleaved {
                let _ = wav.write_sample(*s);
            }
        }
        let _ = writeln!(inner.chunks, "{t_ns}\t{arrival}\t{frames}\t{flags}");
        self.frames.fetch_add(frames, Ordering::Relaxed);
        self.buffers.fetch_add(1, Ordering::Relaxed);
    }

    pub fn frames(&self) -> u64 {
        self.frames.load(Ordering::Relaxed)
    }

    pub fn buffers(&self) -> u64 {
        self.buffers.load(Ordering::Relaxed)
    }

    /// Дописать заголовок WAV и сбросить журналы на диск.
    pub fn finish(&self) -> Res<()> {
        let mut inner = self.inner.lock().map_err(|_| "приёмник звука отравлен")?;
        if let Some(wav) = inner.wav.take() {
            wav.finalize()?;
        }
        inner.chunks.flush()?;
        Ok(())
    }
}

/// Приёмник видео-меток.
pub struct VideoSink {
    log: Mutex<BufWriter<File>>,
    frames: AtomicU64,
    /// Масштаб экрана в сотых долях (125 — это 125 %); 0 — неизвестен.
    scale_percent: AtomicU64,
}

impl VideoSink {
    pub fn create(dir: &Path) -> Res<Self> {
        let mut log = BufWriter::new(File::create(dir.join("video-marks.tsv"))?);
        writeln!(log, "t_ns\tarrival_ns\twidth\theight\tluma\tmethod\tscale")?;
        Ok(Self {
            log: Mutex::new(log),
            frames: AtomicU64::new(0),
            scale_percent: AtomicU64::new(0),
        })
    }

    /// Запомнить масштаб экрана источника: он пишется в каждую строку журнала.
    pub fn set_scale(&self, scale: f32) {
        self.scale_percent
            .store((scale.max(0.0) * 100.0).round() as u64, Ordering::Relaxed);
    }

    /// Принять кадр: `t_ns` — метка кадра по монотонной шкале, `width` и `height` —
    /// размер кадра в физических пикселях, `luma` — яркость контрольной точки в центре
    /// кадра (0–255) или −1, если пиксели недоступны.
    pub fn frame(&self, t_ns: u64, width: u32, height: u32, luma: i32, method: &str) {
        let arrival = now_ns();
        let percent = self.scale_percent.load(Ordering::Relaxed);
        let scale = format!("{}.{:02}", percent / 100, percent % 100);
        if let Ok(mut log) = self.log.lock() {
            let _ = writeln!(
                log,
                "{t_ns}\t{arrival}\t{width}\t{height}\t{luma}\t{method}\t{scale}"
            );
        }
        self.frames.fetch_add(1, Ordering::Relaxed);
    }

    pub fn frames(&self) -> u64 {
        self.frames.load(Ordering::Relaxed)
    }

    pub fn finish(&self) -> Res<()> {
        self.log
            .lock()
            .map_err(|_| "приёмник видео отравлен")?
            .flush()?;
        Ok(())
    }
}

/// Яркость пикселя BGRA или BGRX (0–255).
pub fn luma_bgra(px: &[u8]) -> i32 {
    match px {
        [b, g, r, ..] => (*r as i32 * 299 + *g as i32 * 587 + *b as i32 * 114) / 1000,
        _ => -1,
    }
}

/// Яркость пикселя RGBA или RGBX (0–255).
pub fn luma_rgba(px: &[u8]) -> i32 {
    match px {
        [r, g, b, ..] => (*r as i32 * 299 + *g as i32 * 587 + *b as i32 * 114) / 1000,
        _ => -1,
    }
}
