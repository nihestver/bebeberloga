// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Linux: PipeWire для звука, портал ScreenCast для видео, X11 для списка окон.

mod list;
mod portal_video;
mod pw_audio;

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub use list::{list_windows, process_tree};

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
/// Видео: портал ScreenCast. Если видео запрошено как `auto` и портал не дал источник,
/// запись звука продолжается без видео.
pub fn start_capture(
    req: &CaptureRequest,
    audio: Option<Arc<AudioSink>>,
    video: Option<Arc<VideoSink>>,
) -> Res<Running> {
    let mut info = StartInfo::default();
    let notes = Arc::new(Mutex::new(Vec::new()));
    let mut audio_capture = None;
    let mut video_capture = None;

    if let Some(sink) = audio {
        let method = match req.audio {
            AudioMode::App => Some(AudioMethod::Tree(
                req.root_pid().ok_or("для звука приложения нужен PID")?,
            )),
            AudioMode::SystemExceptSelf => Some(AudioMethod::AllExceptSelf),
            AudioMode::SystemAll => Some(AudioMethod::Monitor),
            AudioMode::None => None,
        };
        if let Some(method) = method {
            let capture = pw_audio::start(method, sink, notes.clone())
                .map_err(|e| format!("звук не захвачен: {e}"))?;
            info.audio_method = method.describe().to_owned();
            info.attempts
                .push("pipewire: узел захвата создан".to_owned());
            audio_capture = Some(capture);
        }
    }

    if let Some(sink) = video {
        match req.video {
            VideoMode::None => {}
            VideoMode::Auto | VideoMode::Portal => {
                match portal_video::start(req.fps, sink, notes.clone()) {
                    Ok(capture) => {
                        info.video_method = "portal".to_owned();
                        info.attempts.push("portal: запущен".to_owned());
                        video_capture = Some(capture);
                    }
                    Err(e) => {
                        info.attempts.push(format!("portal: {e}"));
                        if req.video == VideoMode::Portal || audio_capture.is_none() {
                            if let Some(mut a) = audio_capture.take() {
                                a.stop();
                            }
                            return Err(format!("видео не захвачено: {e}").into());
                        }
                    }
                }
            }
            other => {
                return Err(format!("метод видео {} на Linux не существует", other.name()).into())
            }
        }
    }

    Ok(Running::with_notes(
        info,
        Box::new(move || {
            if let Some(mut v) = video_capture.take() {
                v.stop();
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
