// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Windows: WASAPI для звука, WGC → DXGI → GDI для видео.

mod audio;
mod list;
mod video;

use std::path::Path;
use std::process::Command;
use std::sync::Arc;

pub use audio::{output_state, set_output_state};
pub use list::{audio_nodes, env_info, list_windows, process_tree};
use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

use self::audio::{AudioCapture, AudioMethod};
use self::video::{VideoCapture, VideoMethod};
use super::Launched;
use crate::model::{AudioMode, CaptureRequest, Res, Running, StartInfo, VideoMode};
use crate::rec::{AudioSink, VideoSink};

/// Запустить захват.
///
/// Звук идёт по цепочке с автоматическим переходом: process loopback по дереву
/// процессов → система без собственного процесса → loopback устройства вывода.
/// Видео — по цепочке WGC → DXGI Desktop Duplication → GDI. Отказ метода можно
/// сымитировать через `req.fail` (имена: `process-loopback`, `system-exclude-self`,
/// `wgc`, `dxgi`).
pub fn start_capture(
    req: &CaptureRequest,
    audio: Option<Arc<AudioSink>>,
    video: Option<Arc<VideoSink>>,
) -> Res<Running> {
    let mut info = StartInfo::default();
    let mut audio_capture: Option<AudioCapture> = None;
    let mut video_capture: Option<VideoCapture> = None;

    if let Some(sink) = audio {
        let chain: Vec<AudioMethod> = match req.audio {
            AudioMode::App => {
                let pid = req.root_pid().ok_or("для звука приложения нужен PID")?;
                vec![
                    AudioMethod::ProcessTree(pid),
                    AudioMethod::SystemExceptSelf,
                    AudioMethod::Endpoint,
                ]
            }
            AudioMode::SystemExceptSelf => {
                vec![AudioMethod::SystemExceptSelf, AudioMethod::Endpoint]
            }
            AudioMode::SystemAll => vec![AudioMethod::Endpoint],
            AudioMode::None => Vec::new(),
        };
        for method in chain {
            if req.fails(method.name()) {
                info.attempts
                    .push(format!("{}: отказ сымитирован", method.name()));
                continue;
            }
            match audio::start(method, sink.clone()) {
                Ok((capture, notes)) => {
                    info.attempts.push(format!("{}: запущен", method.name()));
                    info.audio_method = method.describe().to_owned();
                    info.notes.extend(notes);
                    audio_capture = Some(capture);
                    break;
                }
                Err(e) => info.attempts.push(format!("{}: {e}", method.name())),
            }
        }
        if audio_capture.is_none() && req.audio != AudioMode::None {
            return Err(format!("звук не захвачен: {}", info.attempts.join("; ")).into());
        }
    }

    if let Some(sink) = video {
        let chain: Vec<VideoMethod> = match req.video {
            VideoMode::Auto => vec![VideoMethod::Wgc, VideoMethod::Dxgi, VideoMethod::Gdi],
            VideoMode::Wgc => vec![VideoMethod::Wgc],
            VideoMode::Dxgi => vec![VideoMethod::Dxgi],
            VideoMode::Gdi => vec![VideoMethod::Gdi],
            VideoMode::None => Vec::new(),
            other => {
                return Err(format!("метод видео {} на Windows не существует", other.name()).into())
            }
        };
        let window = req.window.as_ref().ok_or("для видео нужно окно")?;
        for method in chain {
            if req.video == VideoMode::Auto && req.fails(method.name()) {
                info.attempts
                    .push(format!("{}: отказ сымитирован", method.name()));
                continue;
            }
            // Наименьший интервал обновления WGC в единицах по 100 нс: `wgc-fast` — 1 мс,
            // `wgc-limit-59` — период 59 к/с; без варианта остаётся значение системы.
            let min_interval_hns = req.variant.split(',').find_map(|f| match f {
                "wgc-fast" => Some(10_000),
                "wgc-limit-59" => Some(10_000_000 / 59),
                _ => None,
            });
            match video::start(method, window.id, req.fps, min_interval_hns, sink.clone()) {
                Ok((capture, notes)) => {
                    info.attempts.push(format!("{}: запущен", method.name()));
                    info.video_method = method.name().to_owned();
                    info.notes
                        .extend(notes.into_iter().map(|n| format!("{}: {n}", method.name())));
                    video_capture = Some(capture);
                    break;
                }
                Err(e) => info.attempts.push(format!("{}: {e}", method.name())),
            }
        }
        if video_capture.is_none() && req.video != VideoMode::None {
            if let Some(mut a) = audio_capture.take() {
                a.stop();
            }
            return Err(format!("видео не захвачено: {}", info.attempts.join("; ")).into());
        }
    }

    Ok(Running::new(
        info,
        Box::new(move || {
            if let Some(mut v) = video_capture.take() {
                v.stop();
            }
            if let Some(mut a) = audio_capture.take() {
                a.stop();
            }
        }),
    ))
}

/// Подготовка процесса: координаты окон и экрана — в физических пикселях.
///
/// Без этого на экране с масштабом больше 100 % система отдаёт процессу условные
/// координаты, и центр окна не совпадает с точкой кадра, снятого с монитора.
pub fn init() {
    // SAFETY: функция без указателей; повторный вызов возвращает ошибку, она не важна.
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

/// Удержание дисплея включённым на время прогона.
pub struct DisplayAwake;

impl Drop for DisplayAwake {
    fn drop(&mut self) {
        // SAFETY: возврат состояния потока к обычному.
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

/// Не дать дисплею погаснуть и системе уснуть, пока идёт прогон. Состояние
/// привязано к вызвавшему потоку и снимается при удалении возвращённого значения.
pub fn keep_display_awake() -> DisplayAwake {
    // SAFETY: функция без указателей.
    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
    }
    DisplayAwake
}

fn quote(arg: &str) -> String {
    if arg.is_empty() || arg.contains(' ') {
        format!("\"{arg}\"")
    } else {
        arg.to_owned()
    }
}

/// Запустить тестовый источник вне дерева процессов программы захвата.
///
/// Режим «система без собственного процесса» исключает всё дерево программы захвата,
/// поэтому источник нельзя запускать её потомком: процесс создаётся через
/// `Win32_Process.Create`, и его родителем становится служба WMI. Переменная
/// окружения `S5_LAUNCH=direct` включает прямой запуск потомком (на случай, если
/// окно процесса, созданного через WMI, не появляется на рабочем столе).
pub fn launch_source(exe: &Path, _role: &str, _out: &Path, args: &[String]) -> Res<Launched> {
    let direct = |reason: String| -> Res<Launched> {
        let child = Command::new(exe).args(args).spawn()?;
        Ok(Launched {
            child: Some(child),
            how: format!("потомок программы захвата ({reason})"),
        })
    };
    if std::env::var("S5_LAUNCH").is_ok_and(|v| v == "direct") {
        return direct("задано S5_LAUNCH=direct".to_owned());
    }
    let command_line = std::iter::once(quote(&exe.to_string_lossy()))
        .chain(args.iter().map(|a| quote(a)))
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{{CommandLine='{}'}}; exit [int]$r.ReturnValue",
        command_line.replace('\'', "''")
    );
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status();
    match status {
        Ok(s) if s.success() => Ok(Launched {
            child: None,
            how: "отдельный процесс вне дерева программы захвата (Win32_Process.Create)".to_owned(),
        }),
        Ok(s) => direct(format!("Win32_Process.Create вернул {s}")),
        Err(e) => direct(format!("PowerShell не запустился: {e}")),
    }
}
