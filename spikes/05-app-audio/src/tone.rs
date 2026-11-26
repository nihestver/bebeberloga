// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Воспроизведение тестового тона через звуковую подсистему ОС (cpal).
//!
//! Используется тестовым источником (тон, щелчки) и самой программой захвата
//! («собственный» тон, который в запись попасть не должен).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, OutputCallbackInfo, SampleFormat, SizedSample, StreamConfig};

use crate::clock::now_ns;
use crate::model::Res;
use crate::signal::ToneGen;

/// Режим тишины: звуковой поток работает как обычно, но отдаёт нули.
static SILENT: AtomicBool = AtomicBool::new(false);

/// Включить режим тишины для всех тонов этого процесса. Поток вывода, его таймеры и
/// метки щелчков остаются теми же — меняются только сэмплы. Для прогонов, где звук
/// не записывается.
pub fn set_silent(silent: bool) {
    SILENT.store(silent, Ordering::Relaxed);
}

/// Управление щелчками: счётчик запросов и канал для меток.
pub struct ClickCtl {
    /// Основной поток увеличивает счётчик — звуковой поток начинает щелчок в ближайшем буфере.
    pub requests: Arc<AtomicU64>,
    /// Метка щелчка: (время вызова звукового обратного вызова, нс; оценка задержки
    /// до воспроизведения по данным cpal, нс).
    pub marks: Sender<(u64, u64)>,
}

/// Играющий тон. Поток звука живёт, пока жив этот объект.
pub struct TonePlayer {
    _stream: cpal::Stream,
    pub host: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub format: String,
}

fn pick_host(name: Option<&str>) -> Res<cpal::Host> {
    let Some(name) = name else {
        return Ok(cpal::default_host());
    };
    for id in cpal::available_hosts() {
        if id.name().eq_ignore_ascii_case(name) {
            return Ok(cpal::host_from_id(id)?);
        }
    }
    let known: Vec<&str> = cpal::available_hosts().iter().map(|h| h.name()).collect();
    Err(format!("звуковой хост «{name}» недоступен; есть: {known:?}").into())
}

/// Запустить тон `tone_hz` на устройстве вывода по умолчанию.
pub fn play(tone_hz: f64, click: Option<ClickCtl>, host: Option<&str>) -> Res<TonePlayer> {
    let host = pick_host(host)?;
    let device = host
        .default_output_device()
        .ok_or("нет устройства вывода по умолчанию")?;
    let supported = device.default_output_config()?;
    let format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let sample_rate = config.sample_rate;
    let channels = config.channels;
    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, config, tone_hz, click)?,
        SampleFormat::I16 => build::<i16>(&device, config, tone_hz, click)?,
        SampleFormat::I32 => build::<i32>(&device, config, tone_hz, click)?,
        SampleFormat::U16 => build::<u16>(&device, config, tone_hz, click)?,
        SampleFormat::U8 => build::<u8>(&device, config, tone_hz, click)?,
        other => return Err(format!("формат сэмплов {other} не поддержан спайком").into()),
    };
    stream.play()?;
    Ok(TonePlayer {
        _stream: stream,
        host: host.id().name().to_owned(),
        sample_rate,
        channels,
        format: format.to_string(),
    })
}

fn build<T>(
    device: &cpal::Device,
    config: StreamConfig,
    tone_hz: f64,
    click: Option<ClickCtl>,
) -> Res<cpal::Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = config.channels.max(1) as usize;
    let mut gen = ToneGen::new(config.sample_rate, tone_hz);
    let mut seen = 0u64;
    let stream = device.build_output_stream(
        config,
        move |data: &mut [T], info: &OutputCallbackInfo| {
            if let Some(ctl) = &click {
                let want = ctl.requests.load(Ordering::Relaxed);
                if want != seen {
                    seen = want;
                    gen.start_click();
                    let ts = info.timestamp();
                    let delay = ts
                        .playback
                        .checked_duration_since(ts.callback)
                        .map(|d| d.as_nanos() as u64)
                        .unwrap_or(0);
                    let _ = ctl.marks.send((now_ns(), delay));
                }
            }
            let silent = SILENT.load(Ordering::Relaxed);
            for frame in data.chunks_mut(channels) {
                let sample = gen.next_sample();
                let v = T::from_sample(if silent { 0.0 } else { sample });
                for s in frame.iter_mut() {
                    *s = v;
                }
            }
        },
        |err| eprintln!("s5: ошибка звукового потока: {err}"),
        None,
    )?;
    Ok(stream)
}
