// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Платформенные части спайка. У каждой ОС один и тот же набор функций:
//! `list_windows`, `process_tree`, `audio_nodes`, `start_capture`, `launch_source`,
//! `env_info`.

use std::path::Path;
use std::process::Child;

use crate::model::{Res, WindowInfo};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

/// Сеанс X11: только на Linux.
#[cfg(not(target_os = "linux"))]
pub fn x11_session() -> bool {
    false
}

/// Забыть выбор источника, запомненный системным окном: такое окно есть только на Linux.
#[cfg(not(target_os = "linux"))]
pub fn forget_video_choice() {}

/// Действие над окном источника (закрыть другим окном, свернуть, изменить размер):
/// в спайке — только в сеансе X11.
#[cfg(not(target_os = "linux"))]
pub fn window_action(_window: &WindowInfo, kind: &str, _on: bool) -> Res<String> {
    Err(format!("действие «{kind}» над окном на этой ОС не реализовано").into())
}

/// Запущенный процесс тестового источника.
pub struct Launched {
    /// Дескриптор процесса, если он запущен прямым потомком программы захвата.
    pub child: Option<Child>,
    /// Как запущен: «потомок программы захвата», «отдельное приложение» и т. п.
    pub how: String,
}

/// Собрать аргументы тестового источника.
pub fn source_args(role: &str, out: &Path, duration_s: u64, extra: &[String]) -> Vec<String> {
    let mut args = vec![
        "--role".to_owned(),
        role.to_owned(),
        "--out".to_owned(),
        out.to_string_lossy().into_owned(),
        "--duration".to_owned(),
        duration_s.to_string(),
    ];
    args.extend(extra.iter().cloned());
    args
}

/// Найти окно по точному заголовку.
pub fn find_window_by_title(title: &str, with_icon: bool) -> Res<Option<WindowInfo>> {
    Ok(list_windows(with_icon)?
        .into_iter()
        .find(|w| w.title == title))
}
