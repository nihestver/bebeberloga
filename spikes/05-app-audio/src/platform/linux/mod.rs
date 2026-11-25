// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Linux: PipeWire для звука; видео — портал ScreenCast в сеансе Wayland, Composite и
//! чтение экрана в сеансе X11; X11 — и для списка окон.

mod list;
mod portal_video;
mod pw_audio;
mod x11_video;

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub use list::{list_windows, process_tree, x11_session};
pub use x11_video::window_action;

use self::x11_video::X11Method;

use self::pw_audio::AudioMethod;
use super::Launched;
use crate::model::{
    AudioMode, AudioNodeInfo, CaptureRequest, EnvInfo, OutputState, Res, Running, StartInfo,
    VideoMode,
};
use crate::rec::{AudioSink, VideoSink};

/// Узлы PipeWire со звуком и PID, которые с ними связаны.
pub fn audio_nodes() -> Res<Vec<AudioNodeInfo>> {
    Ok(pw_audio::scan_nodes()?.0)
}

/// Сведения о стенде.
pub fn env_info() -> EnvInfo {
    let mut info = list::env_info();
    match pw_audio::scan_nodes() {
        Ok((_, version)) => info.details.push(("сервер PipeWire".to_owned(), version)),
        Err(e) => info
            .details
            .push(("сервер PipeWire".to_owned(), format!("недоступен: {e}"))),
    }
    // Есть ли в этом сеансе портал ScreenCast и что он объявляет: в сеансе X11 это
    // зависит от рабочего стола.
    info.details
        .push(("портал ScreenCast".to_owned(), portal_video::probe()));
    info
}

/// Запустить захват.
///
/// Звук: дерево процессов → линковка узлов этих процессов; система без собственного
/// процесса → линковка всех узлов, кроме своих; вся система → monitor устройства вывода.
/// Видео: в сеансе Wayland — портал ScreenCast; в сеансе X11 — окно через Composite,
/// затем весь экран, и только потом портал. Если видео запрошено как `auto` и ни один
/// метод не сработал, запись звука продолжается без видео.
pub fn start_capture(
    req: &CaptureRequest,
    audio: Option<Arc<AudioSink>>,
    video: Option<Arc<VideoSink>>,
) -> Res<Running> {
    let mut info = StartInfo::default();
    let notes = Arc::new(Mutex::new(Vec::new()));
    let mut audio_capture = None;
    let mut video_stop: Option<Box<dyn FnOnce() + Send>> = None;

    // Видео запускается первым: портал ждёт, пока человек выберет источник в системном
    // окне, и это ожидание не должно попасть в запись звука.
    let audio_method = match (&audio, req.audio) {
        (None, _) | (_, AudioMode::None) => None,
        (_, AudioMode::App) => Some(AudioMethod::Tree(
            req.root_pid().ok_or("для звука приложения нужен PID")?,
        )),
        (_, AudioMode::SystemExceptSelf) => Some(AudioMethod::AllExceptSelf),
        (_, AudioMode::SystemAll) => Some(AudioMethod::Monitor),
    };
    if let Some(sink) = video {
        let chain: Vec<VideoMode> = match req.video {
            VideoMode::None => Vec::new(),
            VideoMode::Auto if x11_session() => vec![
                VideoMode::X11Composite,
                VideoMode::X11Screen,
                VideoMode::Portal,
            ],
            VideoMode::Auto => vec![VideoMode::Portal],
            mode @ (VideoMode::Portal | VideoMode::X11Composite | VideoMode::X11Screen) => {
                vec![mode]
            }
            other => {
                return Err(format!("метод видео {} на Linux не существует", other.name()).into())
            }
        };
        for method in chain {
            let name = method.name();
            if req.video == VideoMode::Auto && req.fails(name) {
                info.attempts.push(format!("{name}: отказ сымитирован"));
                continue;
            }
            let started: Result<Box<dyn FnOnce() + Send>, String> =
                match method {
                    VideoMode::Portal => portal_video::start(req.fps, sink.clone(), notes.clone())
                        .map(|mut capture| {
                            Box::new(move || capture.stop()) as Box<dyn FnOnce() + Send>
                        }),
                    _ => {
                        let x11 = if method == VideoMode::X11Composite {
                            X11Method::Composite
                        } else {
                            X11Method::Screen
                        };
                        match req.window.as_ref() {
                            None => Err("для захвата X11 нужно окно".to_owned()),
                            Some(window) => {
                                x11_video::start(x11, window, req.fps, sink.clone(), notes.clone())
                                    .map(|(stop, start_notes)| {
                                        info.notes.extend(
                                            start_notes.into_iter().map(|n| format!("{name}: {n}")),
                                        );
                                        stop
                                    })
                            }
                        }
                    }
                };
            match started {
                Ok(stop) => {
                    info.video_method = name.to_owned();
                    info.attempts.push(format!("{name}: запущен"));
                    video_stop = Some(stop);
                    break;
                }
                Err(e) => info.attempts.push(format!("{name}: {e}")),
            }
        }
        if video_stop.is_none()
            && req.video != VideoMode::None
            && (req.video != VideoMode::Auto || audio_method.is_none())
        {
            return Err(format!("видео не захвачено: {}", info.attempts.join("; ")).into());
        }
    }

    if let (Some(sink), Some(method)) = (audio, audio_method) {
        let capture = match pw_audio::start(method, sink, notes.clone()) {
            Ok(capture) => capture,
            Err(e) => {
                if let Some(stop) = video_stop.take() {
                    stop();
                }
                return Err(format!("звук не захвачен: {e}").into());
            }
        };
        info.audio_method = method.describe().to_owned();
        info.attempts
            .push("pipewire: узел захвата создан".to_owned());
        audio_capture = Some(capture);
    }

    Ok(Running::with_notes(
        info,
        Box::new(move || {
            if let Some(stop) = video_stop.take() {
                stop();
            }
            if let Some(mut a) = audio_capture.take() {
                a.stop();
            }
        }),
        notes,
    ))
}

/// Запустить тестовый источник потомком программы захвата.
///
/// Линковка узлов PipeWire исключает собственный процесс по точному PID, поэтому
/// выводить источник из дерева программы захвата не нужно.
pub fn launch_source(exe: &Path, _role: &str, _out: &Path, args: &[String]) -> Res<Launched> {
    let child = Command::new(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()?;
    Ok(Launched {
        child: Some(child),
        how: "потомок программы захвата".to_owned(),
    })
}

/// Подготовка процесса: на этой ОС ничего не требуется.
pub fn init() {}

/// Состояние устройства вывода: в спайке проверяется только на Windows.
pub fn output_state() -> Res<OutputState> {
    Err("на Linux проверка состояния устройства вывода не реализована".into())
}

/// Задать состояние устройства вывода: в спайке только на Windows.
pub fn set_output_state(_state: &OutputState) -> Res<()> {
    Err("на Linux проверка состояния устройства вывода не реализована".into())
}

/// Удержание экрана включённым на время прогона.
pub struct DisplayAwake {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for DisplayAwake {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Попросить систему не гасить экран (портал Inhibit).
pub fn keep_display_awake() -> DisplayAwake {
    let stop = Arc::new(AtomicBool::new(false));
    DisplayAwake {
        thread: portal_video::inhibit_idle(stop.clone()),
        stop,
    }
}
