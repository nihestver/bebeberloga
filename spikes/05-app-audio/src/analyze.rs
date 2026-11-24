// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Анализ прогона: чей звук попал в запись, есть ли пропуски, каков рассинхрон
//! звука и видео по единой монотонной шкале.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::model::{Res, SAMPLE_RATE};
use crate::rec::{FLAG_DISCONTINUITY, FLAG_SILENT, FLAG_TIMESTAMP_FALLBACK};
use crate::signal::{
    CLICK_AMP, CLICK_HZ, TONE_AMP, TONE_CHILD_HZ, TONE_FOREIGN_HZ, TONE_PARENT_HZ, TONE_SELF_HZ,
};

/// Окно анализа тонов: 100 мс.
const WIN: usize = (SAMPLE_RATE / 10) as usize;
/// Окно и шаг поиска щелчка: 2 мс и 0,5 мс.
const CLICK_WIN: usize = 96;
const CLICK_HOP: usize = 24;
/// Разрыв шкалы времени звука: метка буфера ушла от ожидаемой дальше этого порога.
const TIMELINE_GAP_NS: f64 = 5_000_000.0;
/// Скачок фазы тона 440 Гц, который считается потерей сэмплов: 15° — это 4–5 сэмплов.
const PHASE_JUMP_DEG: f64 = 15.0;
/// Допуск рассинхрона звука и видео, мс.
pub const SYNC_TOLERANCE_MS: f64 = 40.0;

/// Буфер звука из `audio-chunks.tsv`.
#[derive(Clone, Debug)]
pub struct Chunk {
    pub t_ns: u64,
    pub arrival_ns: u64,
    pub frames: u64,
    pub flags: u32,
}

/// Кадр из `video-marks.tsv`.
#[derive(Clone, Debug)]
pub struct VideoMark {
    pub t_ns: u64,
    pub arrival_ns: u64,
    pub width: u32,
    pub height: u32,
    pub luma: i32,
    pub method: String,
    /// Масштаб экрана источника (1.25 — это 125 %); 0 — неизвестен.
    pub scale: f32,
}

/// Событие тестового источника из `source-marks.tsv`.
#[derive(Clone, Debug)]
pub struct SourceMark {
    /// `flash` или `click`.
    pub kind: String,
    /// Момент события по монотонной шкале источника (та же шкала, что у захвата).
    pub t_ns: u64,
}

/// Сводная статистика ряда.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Stats {
    pub n: usize,
    pub mean: f64,
    pub median: f64,
    pub min: f64,
    pub max: f64,
    pub std: f64,
    pub p95: f64,
    /// 95-й процентиль модуля.
    pub p95_abs: f64,
    pub max_abs: f64,
}

impl Stats {
    pub fn of(values: &[f64]) -> Self {
        if values.is_empty() {
            return Self::default();
        }
        let n = values.len();
        let mut sorted = values.to_vec();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let mean = values.iter().sum::<f64>() / n as f64;
        let var = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n as f64;
        let mut abs: Vec<f64> = values.iter().map(|v| v.abs()).collect();
        abs.sort_by(|a, b| a.total_cmp(b));
        Self {
            n,
            mean: round3(mean),
            median: round3(percentile(&sorted, 50.0)),
            min: round3(sorted[0]),
            max: round3(sorted[n - 1]),
            std: round3(var.sqrt()),
            p95: round3(percentile(&sorted, 95.0)),
            p95_abs: round3(percentile(&abs, 95.0)),
            max_abs: round3(abs[n - 1]),
        }
    }
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() - 1) as f64 * p / 100.0).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Уровни тонов в записи: медиана амплитуды по окнам 100 мс.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ToneLevels {
    /// 440 Гц — главный процесс источника.
    pub parent: f64,
    /// 880 Гц — дочерний процесс источника.
    pub child: f64,
    /// 1320 Гц — посторонний процесс.
    pub foreign: f64,
    /// 2000 Гц — сама программа захвата.
    pub own: f64,
}

/// Отчёт по звуку.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AudioReport {
    pub frames: u64,
    /// Длительность по числу сэмплов, с.
    pub duration_s: f64,
    /// Длительность по меткам времени ОС (от первого кадра до конца последнего буфера), с.
    pub span_s: f64,
    /// Расхождение двух длительностей, миллионные доли.
    pub clock_diff_ppm: f64,
    pub buffers: usize,
    pub buffer_frames_min: u64,
    pub buffer_frames_median: u64,
    pub buffer_frames_max: u64,
    /// Буферы, чья метка ушла вперёд от ожидаемой больше чем на 5 мс.
    pub timeline_gaps: usize,
    /// Суммарная длина таких разрывов, мс.
    pub timeline_gap_total_ms: f64,
    /// Буферы, чья метка ушла назад больше чем на 5 мс.
    pub timeline_overlaps: usize,
    /// Отклонение метки буфера от ожидаемой, мс (без учёта разрывов).
    pub timestamp_jitter_ms: Stats,
    /// Буферы с флагом разрыва от ОС.
    pub os_discontinuities: usize,
    /// Буферы, помеченные ОС как тишина.
    pub os_silent_buffers: usize,
    /// Буферы без достоверной метки ОС (взято время прихода).
    pub timestamp_fallbacks: usize,
    /// От конца буфера по метке до его прихода в программу, мс.
    pub delivery_ms: Stats,
    pub tones: ToneLevels,
    /// Окна 100 мс, где тон 440 Гц пропал или просел больше чем вдвое.
    pub dropout_windows: usize,
    /// Скачки фазы тона 440 Гц больше 15° — потерянные или лишние сэмплы.
    pub phase_jumps: usize,
    /// Наибольший скачок фазы, градусы.
    pub phase_jump_max_deg: f64,
    /// Набег фазы тона 440 Гц за окно 100 мс, градусы (расхождение часов источника и захвата).
    pub phase_drift_deg_per_window: f64,
    pub windows_analyzed: usize,
    pub clicks: usize,
    /// Когда в записи впервые появился тон дочернего процесса (880 Гц), с от начала записи.
    pub child_onset_s: Option<f64>,
}

/// Отчёт по видео-меткам.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct VideoReport {
    pub frames: usize,
    pub span_s: f64,
    pub fps: f64,
    /// Интервал между метками соседних кадров, мс.
    pub interval_ms: Stats,
    /// Интервалы длиннее двух медианных — пропущенные кадры.
    pub long_intervals: usize,
    /// Метки, которые не возрастают.
    pub non_monotonic: usize,
    /// Размер кадра в физических пикселях.
    pub width: u32,
    pub height: u32,
    /// Масштаб экрана источника (1.25 — это 125 %); 0 — ОС не сообщила.
    pub scale: f64,
    /// Методы захвата, встретившиеся в журнале.
    pub methods: Vec<String>,
    /// От метки кадра до его прихода в программу, мс.
    pub delivery_ms: Stats,
    /// Кадры, где пиксели не удалось прочитать.
    pub frames_without_pixels: usize,
    pub flashes: usize,
}

/// Отчёт по синхронизации.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SyncReport {
    /// Пар «вспышка — щелчок».
    pub pairs: usize,
    /// Метка щелчка минус метка первого кадра вспышки, мс. Положительное — звук позже видео.
    /// Сюда входит и собственный разнос событий в тестовом источнике.
    pub offset_ms: Stats,
    /// Тот же разнос за вычетом среднего: дрожание меток.
    pub offset_jitter_ms: Stats,
    /// 95 % пар укладываются в допуск 40 мс.
    pub within_tolerance: bool,
    /// Задержка «событие в источнике → метка захвата» для видео, мс (нужен журнал источника).
    pub video_latency_ms: Option<Stats>,
    /// То же для звука, мс.
    pub audio_latency_ms: Option<Stats>,
    /// Разнос «щелчок минус вспышка» в самом источнике, мс.
    pub source_skew_ms: Option<Stats>,
    /// Рассинхрон захвата без разноса источника: (задержка звука) − (задержка видео), мс.
    pub capture_only_offset_ms: Option<Stats>,
}

/// Полный разбор каталога прогона.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Analysis {
    pub audio: Option<AudioReport>,
    pub video: Option<VideoReport>,
    pub sync: Option<SyncReport>,
}

/// Прочитать WAV и свести каналы в моно.
pub fn read_wav_mono(path: &Path) -> Res<Vec<f32>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let ch = spec.channels.max(1) as usize;
    let mut mono = Vec::with_capacity(reader.len() as usize / ch);
    let mut acc = 0.0f32;
    let mut i = 0usize;
    for s in reader.samples::<f32>() {
        acc += s?;
        i += 1;
        if i == ch {
            mono.push(acc / ch as f32);
            acc = 0.0;
            i = 0;
        }
    }
    Ok(mono)
}

fn tsv_rows(path: &Path) -> Res<Vec<Vec<String>>> {
    let text = fs::read_to_string(path)?;
    Ok(text
        .lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.split('\t').map(str::to_owned).collect())
        .collect())
}

fn field<T: std::str::FromStr + Default>(row: &[String], i: usize) -> T {
    row.get(i).and_then(|s| s.parse().ok()).unwrap_or_default()
}

pub fn read_chunks(path: &Path) -> Res<Vec<Chunk>> {
    Ok(tsv_rows(path)?
        .iter()
        .map(|r| Chunk {
            t_ns: field(r, 0),
            arrival_ns: field(r, 1),
            frames: field(r, 2),
            flags: field(r, 3),
        })
        .collect())
}

pub fn read_video_marks(path: &Path) -> Res<Vec<VideoMark>> {
    Ok(tsv_rows(path)?
        .iter()
        .map(|r| VideoMark {
            t_ns: field(r, 0),
            arrival_ns: field(r, 1),
            width: field(r, 2),
            height: field(r, 3),
            luma: field(r, 4),
            method: r.get(5).cloned().unwrap_or_default(),
            scale: field(r, 6),
        })
        .collect())
}

pub fn read_source_marks(path: &Path) -> Res<Vec<SourceMark>> {
    Ok(tsv_rows(path)?
        .iter()
        .map(|r| SourceMark {
            kind: r.first().cloned().unwrap_or_default(),
            t_ns: field(r, 1),
        })
        .collect())
}

/// Таблицы cos и sin для тона в окне из `n` сэмплов.
fn tables(freq: f64, n: usize) -> (Vec<f32>, Vec<f32>) {
    let w = std::f64::consts::TAU * freq / SAMPLE_RATE as f64;
    let cos = (0..n).map(|i| (w * i as f64).cos() as f32).collect();
    let sin = (0..n).map(|i| (w * i as f64).sin() as f32).collect();
    (cos, sin)
}

/// Амплитуда и фаза (градусы) тона в окне.
fn correlate(win: &[f32], cos: &[f32], sin: &[f32]) -> (f64, f64) {
    let mut re = 0.0f64;
    let mut im = 0.0f64;
    for ((x, c), s) in win.iter().zip(cos).zip(sin) {
        re += (*x * *c) as f64;
        im += (*x * *s) as f64;
    }
    let n = win.len().max(1) as f64;
    let amp = 2.0 * (re * re + im * im).sqrt() / n;
    (amp, im.atan2(re).to_degrees())
}

fn wrap_deg(d: f64) -> f64 {
    let mut d = d % 360.0;
    if d > 180.0 {
        d -= 360.0;
    }
    if d < -180.0 {
        d += 360.0;
    }
    d
}

fn median_f64(values: &[f64]) -> f64 {
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    percentile(&v, 50.0)
}

/// Уровни четырёх тонов по секундам записи: главный, дочерний, посторонний, собственный.
pub fn tone_timeline(mono: &[f32]) -> Vec<[f64; 4]> {
    let tabs: Vec<(Vec<f32>, Vec<f32>)> =
        [TONE_PARENT_HZ, TONE_CHILD_HZ, TONE_FOREIGN_HZ, TONE_SELF_HZ]
            .iter()
            .map(|f| tables(*f, WIN))
            .collect();
    let per_second = SAMPLE_RATE as usize / WIN;
    let mut out = Vec::new();
    for second in mono.chunks(SAMPLE_RATE as usize) {
        let mut row = [0.0f64; 4];
        let mut count = 0usize;
        for win in second.as_chunks::<WIN>().0.iter().take(per_second) {
            for (i, (cos, sin)) in tabs.iter().enumerate() {
                row[i] += correlate(win, cos, sin).0;
            }
            count += 1;
        }
        if count > 0 {
            out.push(row.map(|v| (v / count as f64 * 1e5).round() / 1e5));
        }
    }
    out
}

/// Моменты начала щелчков: номера сэмплов.
pub fn find_clicks(mono: &[f32]) -> Vec<usize> {
    if mono.len() < CLICK_WIN * 4 {
        return Vec::new();
    }
    let (cos, sin) = tables(CLICK_HZ, CLICK_WIN);
    let count = (mono.len() - CLICK_WIN) / CLICK_HOP + 1;
    let amps: Vec<f64> = (0..count)
        .map(|j| correlate(&mono[j * CLICK_HOP..j * CLICK_HOP + CLICK_WIN], &cos, &sin).0)
        .collect();
    let mut sorted = amps.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = percentile(&sorted, 50.0);
    let peak = percentile(&sorted, 99.9);
    // Щелчок занимает 0,5 % времени: 99,9-й процентиль лежит внутри щелчков, если они есть.
    if peak < 10.0 * floor.max(1e-7) || peak < CLICK_AMP as f64 * 0.01 {
        return Vec::new();
    }
    let threshold = 0.4 * peak;
    let refractory = (SAMPLE_RATE as usize * 3 / 10) / CLICK_HOP;
    let mut out = Vec::new();
    let mut j = 0usize;
    while j < amps.len() {
        if amps[j] > threshold {
            // Окно перешло порог, когда щелчок занял около 40 % окна.
            out.push(j * CLICK_HOP + CLICK_WIN * 6 / 10);
            j += refractory;
        } else {
            j += 1;
        }
    }
    out
}

/// Перевод номера сэмпла в метку времени по журналу буферов.
pub fn sample_time_ns(chunks: &[Chunk], sample: u64) -> Option<u64> {
    let mut start = 0u64;
    for c in chunks {
        if sample < start + c.frames {
            let offset_ns = (sample - start) as f64 * 1e9 / SAMPLE_RATE as f64;
            return Some(c.t_ns + offset_ns as u64);
        }
        start += c.frames;
    }
    None
}

/// Разбор звука. Возвращает отчёт и метки щелчков (нс).
pub fn analyze_audio(mono: &[f32], chunks: &[Chunk]) -> (AudioReport, Vec<u64>) {
    let mut rep = AudioReport {
        frames: mono.len() as u64,
        duration_s: round3(mono.len() as f64 / SAMPLE_RATE as f64),
        buffers: chunks.len(),
        ..Default::default()
    };

    // Шкала времени по меткам ОС.
    let mut sizes: Vec<u64> = chunks.iter().map(|c| c.frames).collect();
    sizes.sort_unstable();
    if let (Some(min), Some(max)) = (sizes.first(), sizes.last()) {
        rep.buffer_frames_min = *min;
        rep.buffer_frames_max = *max;
        rep.buffer_frames_median = sizes[sizes.len() / 2];
    }
    let frame_ns = 1e9 / SAMPLE_RATE as f64;
    let mut expected: Option<f64> = None;
    let mut jitter = Vec::new();
    let mut delivery = Vec::new();
    for c in chunks {
        if c.flags & FLAG_DISCONTINUITY != 0 {
            rep.os_discontinuities += 1;
        }
        if c.flags & FLAG_SILENT != 0 {
            rep.os_silent_buffers += 1;
        }
        if c.flags & FLAG_TIMESTAMP_FALLBACK != 0 {
            rep.timestamp_fallbacks += 1;
        }
        let end = c.t_ns as f64 + c.frames as f64 * frame_ns;
        if let Some(e) = expected {
            let d = c.t_ns as f64 - e;
            if d > TIMELINE_GAP_NS {
                rep.timeline_gaps += 1;
                rep.timeline_gap_total_ms += d / 1e6;
            } else if d < -TIMELINE_GAP_NS {
                rep.timeline_overlaps += 1;
            } else {
                jitter.push(d / 1e6);
            }
        }
        expected = Some(end);
        delivery.push((c.arrival_ns as f64 - end) / 1e6);
    }
    rep.timeline_gap_total_ms = round3(rep.timeline_gap_total_ms);
    rep.timestamp_jitter_ms = Stats::of(&jitter);
    rep.delivery_ms = Stats::of(&delivery);
    if let (Some(first), Some(last)) = (chunks.first(), chunks.last()) {
        let span = (last.t_ns as f64 + last.frames as f64 * frame_ns - first.t_ns as f64) / 1e9;
        rep.span_s = round3(span);
        if span > 0.0 {
            let by_samples = mono.len() as f64 / SAMPLE_RATE as f64;
            rep.clock_diff_ppm = ((by_samples - span) / span * 1e6).round();
        }
    }

    // Тоны по окнам 100 мс.
    let windows = mono.len() / WIN;
    let tabs: Vec<(Vec<f32>, Vec<f32>)> =
        [TONE_PARENT_HZ, TONE_CHILD_HZ, TONE_FOREIGN_HZ, TONE_SELF_HZ]
            .iter()
            .map(|f| tables(*f, WIN))
            .collect();
    let mut amps: [Vec<f64>; 4] = Default::default();
    let mut phase440 = Vec::with_capacity(windows);
    for k in 0..windows {
        let win = &mono[k * WIN..(k + 1) * WIN];
        for (i, (cos, sin)) in tabs.iter().enumerate() {
            let (amp, phase) = correlate(win, cos, sin);
            amps[i].push(amp);
            if i == 0 {
                phase440.push(phase);
            }
        }
    }
    let level = |v: &Vec<f64>| {
        if v.is_empty() {
            0.0
        } else {
            (median_f64(v) * 1e6).round() / 1e6
        }
    };
    rep.tones = ToneLevels {
        parent: level(&amps[0]),
        child: level(&amps[1]),
        foreign: level(&amps[2]),
        own: level(&amps[3]),
    };

    // Провалы и скачки фазы тона 440 Гц; края записи (0,5 с и 0,2 с) не учитываются.
    let (skip_head, skip_tail) = (5usize, 2usize);
    if windows > skip_head + skip_tail + 3 && rep.tones.parent > TONE_AMP as f64 * 0.1 {
        let range = skip_head..windows - skip_tail;
        rep.windows_analyzed = range.len();
        let ok = |k: usize| amps[0][k] >= 0.5 * rep.tones.parent;
        rep.dropout_windows = range.clone().filter(|k| !ok(*k)).count();
        let mut diffs = Vec::new();
        for k in range.clone().skip(1) {
            if ok(k) && ok(k - 1) {
                diffs.push(wrap_deg(phase440[k] - phase440[k - 1]));
            }
        }
        if !diffs.is_empty() {
            let drift = median_f64(&diffs);
            rep.phase_drift_deg_per_window = round3(drift);
            for (i, d) in diffs.iter().enumerate() {
                // Локальная медиана: часы источника и захвата могут плавно расходиться.
                let lo = i.saturating_sub(10);
                let hi = (i + 11).min(diffs.len());
                let dev = wrap_deg(d - median_f64(&diffs[lo..hi])).abs();
                if dev > PHASE_JUMP_DEG {
                    rep.phase_jumps += 1;
                }
                if dev > rep.phase_jump_max_deg {
                    rep.phase_jump_max_deg = round3(dev);
                }
            }
        }
    }

    // Появление тона дочернего процесса: три окна подряд выше четверти номинала.
    let child_on = |k: usize| amps[1][k] >= 0.25 * TONE_AMP as f64;
    rep.child_onset_s = (0..windows.saturating_sub(2))
        .find(|k| child_on(*k) && child_on(k + 1) && child_on(k + 2))
        .map(|k| k as f64 / 10.0);

    let clicks: Vec<u64> = find_clicks(mono)
        .into_iter()
        .filter_map(|s| sample_time_ns(chunks, s as u64))
        .collect();
    rep.clicks = clicks.len();
    (rep, clicks)
}

/// Разбор видео-меток. Возвращает отчёт и метки первых кадров вспышек (нс).
pub fn analyze_video(marks: &[VideoMark]) -> (VideoReport, Vec<u64>) {
    let mut rep = VideoReport {
        frames: marks.len(),
        ..Default::default()
    };
    if marks.is_empty() {
        return (rep, Vec::new());
    }
    let mut intervals = Vec::new();
    for pair in marks.windows(2) {
        if pair[1].t_ns <= pair[0].t_ns {
            rep.non_monotonic += 1;
        } else {
            intervals.push((pair[1].t_ns - pair[0].t_ns) as f64 / 1e6);
        }
    }
    rep.interval_ms = Stats::of(&intervals);
    rep.long_intervals = intervals
        .iter()
        .filter(|d| **d > 2.0 * rep.interval_ms.median.max(0.001))
        .count();
    let span = (marks[marks.len() - 1].t_ns.saturating_sub(marks[0].t_ns)) as f64 / 1e9;
    rep.span_s = round3(span);
    if span > 0.0 {
        rep.fps = round3((marks.len() - 1) as f64 / span);
    }
    let last = &marks[marks.len() - 1];
    rep.width = last.width;
    rep.height = last.height;
    rep.scale = (last.scale as f64 * 100.0).round() / 100.0;
    for m in marks {
        if !rep.methods.contains(&m.method) {
            rep.methods.push(m.method.clone());
        }
    }
    let delivery: Vec<f64> = marks
        .iter()
        .map(|m| (m.arrival_ns as f64 - m.t_ns as f64) / 1e6)
        .collect();
    rep.delivery_ms = Stats::of(&delivery);
    rep.frames_without_pixels = marks.iter().filter(|m| m.luma < 0).count();

    // Вспышки: переход контрольной точки из тёмного в светлое.
    let lumas: Vec<i32> = marks.iter().map(|m| m.luma).filter(|l| *l >= 0).collect();
    let mut flashes = Vec::new();
    if let (Some(min), Some(max)) = (lumas.iter().min(), lumas.iter().max()) {
        if max - min >= 60 {
            let threshold = (min + max) / 2;
            let mut prev_dark = false;
            let mut last_flash: Option<u64> = None;
            for m in marks.iter().filter(|m| m.luma >= 0) {
                let bright = m.luma >= threshold;
                let far = last_flash.is_none_or(|t| m.t_ns.saturating_sub(t) > 500_000_000);
                if bright && prev_dark && far {
                    flashes.push(m.t_ns);
                    last_flash = Some(m.t_ns);
                }
                prev_dark = !bright;
            }
        }
    }
    rep.flashes = flashes.len();
    (rep, flashes)
}

/// Ближайшая к `t` метка из отсортированного списка, не дальше `max_ns`.
fn nearest(sorted: &[u64], t: u64, max_ns: u64) -> Option<u64> {
    let i = sorted.partition_point(|v| *v < t);
    let mut best: Option<u64> = None;
    for cand in [i.checked_sub(1), Some(i)].into_iter().flatten() {
        if let Some(v) = sorted.get(cand) {
            let d = v.abs_diff(t);
            if d <= max_ns && best.is_none_or(|b| d < b.abs_diff(t)) {
                best = Some(*v);
            }
        }
    }
    best
}

fn diff_ms(a: u64, b: u64) -> f64 {
    (a as f64 - b as f64) / 1e6
}

/// Синхронизация звука и видео по меткам захвата и, если есть, журналу источника.
pub fn analyze_sync(clicks: &[u64], flashes: &[u64], source: &[SourceMark]) -> SyncReport {
    const PAIR_NS: u64 = 400_000_000;
    let mut offsets = Vec::new();
    for f in flashes {
        if let Some(c) = nearest(clicks, *f, PAIR_NS) {
            offsets.push(diff_ms(c, *f));
        }
    }
    let offset = Stats::of(&offsets);
    let centered: Vec<f64> = offsets.iter().map(|o| o - offset.mean).collect();
    let mut rep = SyncReport {
        pairs: offsets.len(),
        within_tolerance: !offsets.is_empty() && offset.p95_abs <= SYNC_TOLERANCE_MS,
        offset_jitter_ms: Stats::of(&centered),
        offset_ms: offset,
        ..Default::default()
    };

    let src_flash: Vec<u64> = source
        .iter()
        .filter(|m| m.kind == "flash")
        .map(|m| m.t_ns)
        .collect();
    let src_click: Vec<u64> = source
        .iter()
        .filter(|m| m.kind == "click")
        .map(|m| m.t_ns)
        .collect();
    if src_flash.is_empty() || src_click.is_empty() {
        return rep;
    }
    let mut v_lat = Vec::new();
    let mut a_lat = Vec::new();
    let mut skew = Vec::new();
    let mut only = Vec::new();
    for sf in &src_flash {
        let Some(sc) = nearest(&src_click, *sf, PAIR_NS) else {
            continue;
        };
        skew.push(diff_ms(sc, *sf));
        let v = nearest(flashes, *sf + PAIR_NS / 2, PAIR_NS / 2 + 20_000_000);
        let a = nearest(clicks, sc + PAIR_NS / 2, PAIR_NS / 2 + 20_000_000);
        if let Some(v) = v {
            v_lat.push(diff_ms(v, *sf));
        }
        if let Some(a) = a {
            a_lat.push(diff_ms(a, sc));
        }
        if let (Some(v), Some(a)) = (v, a) {
            only.push(diff_ms(a, sc) - diff_ms(v, *sf));
        }
    }
    rep.video_latency_ms = Some(Stats::of(&v_lat));
    rep.audio_latency_ms = Some(Stats::of(&a_lat));
    rep.source_skew_ms = Some(Stats::of(&skew));
    rep.capture_only_offset_ms = Some(Stats::of(&only));
    rep
}

/// Разобрать каталог прогона: `audio.wav`, `audio-chunks.tsv`, `video-marks.tsv`,
/// `source-marks.tsv` — что есть.
pub fn analyze_dir(dir: &Path) -> Res<Analysis> {
    let mut out = Analysis::default();
    let mut clicks = Vec::new();
    let mut flashes = Vec::new();
    let wav = dir.join("audio.wav");
    if wav.exists() {
        let mono = read_wav_mono(&wav)?;
        let chunks = read_chunks(&dir.join("audio-chunks.tsv"))?;
        let (rep, c) = analyze_audio(&mono, &chunks);
        out.audio = Some(rep);
        clicks = c;
    }
    let marks = dir.join("video-marks.tsv");
    if marks.exists() {
        let (rep, f) = analyze_video(&read_video_marks(&marks)?);
        out.video = Some(rep);
        flashes = f;
    }
    if out.audio.is_some() && out.video.is_some() {
        let src = dir.join("source-marks.tsv");
        let source = if src.exists() {
            read_source_marks(&src)?
        } else {
            Vec::new()
        };
        out.sync = Some(analyze_sync(&clicks, &flashes, &source));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signal::ToneGen;

    const CHUNK: usize = 480;

    /// Пять секунд тона 440 Гц со щелчком каждую секунду, буферами по 10 мс.
    fn synth(seconds: usize) -> (Vec<f32>, Vec<Chunk>, Vec<u64>) {
        let mut gen = ToneGen::new(SAMPLE_RATE, TONE_PARENT_HZ);
        let total = seconds * SAMPLE_RATE as usize;
        let mut mono = Vec::with_capacity(total);
        let mut click_ns = Vec::new();
        for i in 0..total {
            if i % SAMPLE_RATE as usize == SAMPLE_RATE as usize / 2 {
                gen.start_click();
                click_ns.push(1_000_000_000 + (i as f64 * 1e9 / SAMPLE_RATE as f64) as u64);
            }
            mono.push(gen.next_sample());
        }
        let chunks = (0..total / CHUNK)
            .map(|k| {
                let t = 1_000_000_000 + (k * CHUNK) as u64 * 1_000_000_000 / SAMPLE_RATE as u64;
                Chunk {
                    t_ns: t,
                    arrival_ns: t + 12_000_000,
                    frames: CHUNK as u64,
                    flags: 0,
                }
            })
            .collect();
        (mono, chunks, click_ns)
    }

    #[test]
    fn clean_recording_has_no_gaps() {
        let (mono, chunks, click_ns) = synth(5);
        let (rep, clicks) = analyze_audio(&mono, &chunks);
        assert_eq!(rep.timeline_gaps, 0);
        assert_eq!(rep.phase_jumps, 0);
        assert_eq!(rep.dropout_windows, 0);
        assert!((rep.tones.parent - TONE_AMP as f64).abs() < 0.002);
        assert!(rep.tones.child < 0.0005);
        assert!(rep.tones.foreign < 0.0005);
        assert!(rep.tones.own < 0.0005);
        assert_eq!(clicks.len(), click_ns.len());
        for (found, truth) in clicks.iter().zip(&click_ns) {
            assert!(
                found.abs_diff(*truth) < 1_000_000,
                "щелчок найден с ошибкой > 1 мс"
            );
        }
    }

    #[test]
    fn dropped_samples_show_as_phase_jump() {
        let (mut mono, chunks, _) = synth(5);
        // Потеря 100 сэмплов на третьей секунде: фаза 440 Гц сдвигается на 330°.
        mono.drain(120_000..120_100);
        let (rep, _) = analyze_audio(&mono, &chunks);
        assert!(rep.phase_jumps >= 1);
    }

    #[test]
    fn silence_shows_as_dropout() {
        let (mut mono, chunks, _) = synth(5);
        for s in &mut mono[96_000..110_400] {
            *s = 0.0;
        }
        let (rep, _) = analyze_audio(&mono, &chunks);
        assert!(rep.dropout_windows >= 2);
    }

    #[test]
    fn timeline_gap_is_counted() {
        let (mono, mut chunks, _) = synth(5);
        for c in chunks.iter_mut().skip(200) {
            c.t_ns += 30_000_000;
        }
        let (rep, _) = analyze_audio(&mono, &chunks);
        assert_eq!(rep.timeline_gaps, 1);
        assert!((rep.timeline_gap_total_ms - 30.0).abs() < 0.1);
    }

    #[test]
    fn sync_offset_is_measured() {
        let (mono, chunks, click_ns) = synth(5);
        let (_, clicks) = analyze_audio(&mono, &chunks);
        // Кадры 60 к/с; вспышка начинается за 25 мс до щелчка и длится 150 мс.
        let mut marks = Vec::new();
        let frame = 1_000_000_000u64 / 60;
        let mut t = 1_000_000_000u64;
        while t < 6_000_000_000 {
            let lit = click_ns
                .iter()
                .any(|c| t + 25_000_000 >= *c && t + 25_000_000 < *c + 150_000_000);
            marks.push(VideoMark {
                t_ns: t,
                arrival_ns: t + 5_000_000,
                width: 640,
                height: 360,
                luma: if lit { 250 } else { 30 },
                method: "test".into(),
                scale: 1.25,
            });
            t += frame;
        }
        let (video, flashes) = analyze_video(&marks);
        assert_eq!(video.flashes, click_ns.len());
        assert!((video.fps - 60.0).abs() < 0.5);
        let sync = analyze_sync(&clicks, &flashes, &[]);
        assert_eq!(sync.pairs, click_ns.len());
        // Щелчок на 25 мс позже начала вспышки; первый кадр вспышки — с опозданием до 16,7 мс.
        assert!(sync.offset_ms.mean > 7.0 && sync.offset_ms.mean < 26.0);
        assert!(sync.within_tolerance);
    }
}
