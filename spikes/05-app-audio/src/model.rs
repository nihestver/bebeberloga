// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Общие типы спайка: окна, процессы, аудиоузлы, запрос захвата.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// Результат с текстовой ошибкой: спайку достаточно сообщения.
pub type Res<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Частота дискретизации записи. Формат записи — стерео, float32.
pub const SAMPLE_RATE: u32 = 48_000;
/// Число каналов записи.
pub const CHANNELS: usize = 2;

/// Иконка приложения: RGBA, 8 бит на канал.
#[derive(Clone, Debug)]
pub struct Icon {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Окно верхнего уровня.
#[derive(Clone, Debug)]
pub struct WindowInfo {
    /// Идентификатор окна в ОС: HWND, CGWindowID или XID.
    pub id: u64,
    /// Процесс-владелец окна.
    pub pid: u32,
    /// Заголовок. В сводки и в git не попадает.
    pub title: String,
    /// Имя приложения или исполняемого файла. В сводки и в git не попадает.
    pub app: String,
    pub width: u32,
    pub height: u32,
    /// Масштаб экрана, на котором находится окно (1.25 — это 125 %); 0 — неизвестен.
    /// Размеры окна — в тех единицах, в которых их отдаёт ОС: Windows — физические
    /// пиксели, macOS — точки, X11 — пиксели.
    pub scale: f32,
    pub icon: Option<Icon>,
    /// Особенности, найденные при перечислении (например, окно-рамка чужого процесса).
    pub notes: Vec<String>,
}

/// Процесс в дереве.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    /// Короткое имя исполняемого файла.
    pub name: String,
    /// Глубина от корня дерева (корень — 0).
    pub depth: u32,
}

/// Аудиоузел ОС: сессия WASAPI, процесс-объект CoreAudio или узел PipeWire.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioNodeInfo {
    /// PID, который ОС связывает с узлом.
    pub pid: u32,
    /// Идентификатор узла в ОС (id узла PipeWire, номер сессии и т. п.).
    pub node_id: u64,
    /// Вид узла, как его называет ОС.
    pub kind: String,
    /// Узел сейчас воспроизводит звук.
    pub active: bool,
    /// Дополнительные свойства для отчёта (без имён и путей).
    pub extra: Vec<(String, String)>,
}

/// Что захватывать как звук.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioMode {
    /// Без звука.
    None,
    /// Приложение: процесс и все его дочерние процессы.
    App,
    /// Вся система, кроме собственного процесса.
    SystemExceptSelf,
    /// Вся система как есть (monitor-источник, обычный loopback устройства).
    SystemAll,
}

/// Способ захвата видео.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VideoMode {
    /// Без видео.
    None,
    /// Цепочка методов ОС с автоматическим переходом на запасной.
    Auto,
    /// Windows Graphics Capture.
    Wgc,
    /// DXGI Desktop Duplication.
    Dxgi,
    /// GDI BitBlt.
    Gdi,
    /// ScreenCaptureKit.
    Sck,
    /// Портал ScreenCast и PipeWire.
    Portal,
}

impl VideoMode {
    pub fn name(self) -> &'static str {
        match self {
            VideoMode::None => "none",
            VideoMode::Auto => "auto",
            VideoMode::Wgc => "wgc",
            VideoMode::Dxgi => "dxgi",
            VideoMode::Gdi => "gdi",
            VideoMode::Sck => "sck",
            VideoMode::Portal => "portal",
        }
    }
}

/// Запрос на захват.
#[derive(Clone, Debug)]
pub struct CaptureRequest {
    /// Окно-источник видео; его PID — корень дерева процессов для звука.
    pub window: Option<WindowInfo>,
    /// Корень дерева процессов для звука, если окно не задано.
    pub pid: Option<u32>,
    pub audio: AudioMode,
    pub video: VideoMode,
    /// Методы, отказ которых нужно сымитировать (проверка автоматического перехода).
    pub fail: Vec<String>,
    /// Желаемая частота кадров.
    pub fps: u32,
    /// Вариант реализации внутри ОС (например, один или два потока на macOS).
    pub variant: String,
}

impl CaptureRequest {
    /// PID корня дерева процессов для звука.
    pub fn root_pid(&self) -> Option<u32> {
        self.pid.or(self.window.as_ref().map(|w| w.pid))
    }

    pub fn fails(&self, method: &str) -> bool {
        self.fail.iter().any(|m| m == method)
    }
}

/// Что получилось при запуске захвата.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct StartInfo {
    /// Сработавший метод звука.
    pub audio_method: String,
    /// Сработавший метод видео.
    pub video_method: String,
    /// Попытки по цепочке: «метод: результат».
    pub attempts: Vec<String>,
    /// Наблюдения для отчёта.
    pub notes: Vec<String>,
}

/// Работающий захват. Останавливается вызовом `stop` или при удалении.
pub struct Running {
    pub info: StartInfo,
    stopper: Option<Box<dyn FnOnce() + Send>>,
    /// Наблюдения, которые захват дописывает по ходу работы.
    live_notes: Option<Arc<Mutex<Vec<String>>>>,
    /// Обновление состава захвата на ходу, если ОС это умеет.
    refresher: Option<Refresher>,
}

/// Обновление состава захвата на ходу: возвращает описание сделанного.
pub type Refresher = Box<dyn Fn() -> Res<String> + Send>;

impl Running {
    pub fn new(info: StartInfo, stopper: Box<dyn FnOnce() + Send>) -> Self {
        Self {
            info,
            stopper: Some(stopper),
            live_notes: None,
            refresher: None,
        }
    }

    pub fn with_refresher(mut self, refresher: Refresher) -> Self {
        self.refresher = Some(refresher);
        self
    }

    /// Обновить состав захвата (например, пересобрать фильтр потока). Если ОС сама
    /// следит за составом, функция ничего не делает.
    pub fn refresh(&self) -> Res<String> {
        match &self.refresher {
            Some(f) => f(),
            None => Ok("обновление не требуется или не поддержано".to_owned()),
        }
    }

    pub fn with_notes(
        info: StartInfo,
        stopper: Box<dyn FnOnce() + Send>,
        notes: Arc<Mutex<Vec<String>>>,
    ) -> Self {
        Self {
            info,
            stopper: Some(stopper),
            live_notes: Some(notes),
            refresher: None,
        }
    }

    /// Остановить захват и вернуть итоговые сведения о запуске.
    pub fn stop(mut self) -> StartInfo {
        if let Some(stop) = self.stopper.take() {
            stop();
        }
        let mut info = std::mem::take(&mut self.info);
        if let Some(notes) = self.live_notes.take() {
            if let Ok(notes) = notes.lock() {
                for n in notes.iter() {
                    if !info.notes.contains(n) {
                        info.notes.push(n.clone());
                    }
                }
            }
        }
        info
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(stop) = self.stopper.take() {
            stop();
        }
    }
}

/// Состояние устройства вывода по умолчанию.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct OutputState {
    /// Звук выключен (mute).
    pub muted: bool,
    /// Громкость от 0 до 1.
    pub volume: f32,
}

/// Сведения о стенде для отчёта: без имён пользователя и машины, без путей.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EnvInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    /// Сеанс рабочего стола (Linux: wayland или x11), иначе пусто.
    pub session: String,
    /// Версии звуковой подсистемы и другие сведения: «ключ: значение».
    pub details: Vec<(String, String)>,
}
