// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Программа захвата спайка S5.
//!
//! Команды: `list` (окна с PID и иконкой), `tree` (дерево процессов и его аудиоузлы),
//! `nodes` (все аудиоузлы), `record` (запись звука в WAV и видео-меток в журнал),
//! `analyze` (разбор каталога прогона), `selftest` (весь сценарий без участия
//! человека), `env` (сведения о стенде).

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};
use s5::analyze::{self, Analysis, SYNC_TOLERANCE_MS};
use s5::model::{
    AudioMode, CaptureRequest, EnvInfo, Icon, OutputState, ProcInfo, Res, StartInfo, VideoMode,
    WindowInfo,
};
use s5::platform::{self, Launched};
use s5::rec::{AudioSink, VideoSink};
use s5::signal::{TONE_AMP, TONE_SELF_HZ};
use s5::tone;
use serde::Serialize;

#[derive(Parser, Debug)]
#[command(about = "Спайк S5: звук приложения и захват видео")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Окна верхнего уровня: идентификатор, PID, размер, приложение, заголовок, иконка.
    List {
        /// Каталог, куда сохранить иконки приложений в PNG.
        #[arg(long)]
        icons: Option<PathBuf>,
    },
    /// Дерево процессов и аудиоузлы, которые ОС связывает с его процессами.
    Tree {
        #[arg(long)]
        pid: u32,
    },
    /// Все аудиоузлы ОС с их PID.
    Nodes,
    /// Запись звука в WAV и видео-меток в журнал.
    Record {
        /// Заголовок окна-источника (точное совпадение).
        #[arg(long)]
        title: Option<String>,
        /// Идентификатор окна из `list`.
        #[arg(long)]
        window: Option<u64>,
        /// Корень дерева процессов для звука, если окно не задано.
        #[arg(long)]
        pid: Option<u32>,
        /// Звук: app, system, system-all, none.
        #[arg(long, default_value = "app")]
        audio: String,
        /// Видео: auto, wgc, dxgi, gdi, sck, portal, none.
        #[arg(long, default_value = "auto")]
        video: String,
        #[arg(long, default_value_t = 600)]
        seconds: u64,
        #[arg(long)]
        out: PathBuf,
        /// Методы, отказ которых сымитировать, через запятую.
        #[arg(long, default_value = "")]
        fail: String,
        /// Вариант реализации внутри ОС.
        #[arg(long, default_value = "")]
        variant: String,
        #[arg(long, default_value_t = 60)]
        fps: u32,
        /// Играть «собственный» тон программы захвата (2000 Гц) на время записи.
        #[arg(long)]
        own_tone: bool,
    },
    /// Разбор каталога прогона.
    Analyze {
        dir: PathBuf,
        /// Показать уровни тонов по секундам записи.
        #[arg(long)]
        timeline: bool,
    },
    /// Весь сценарий: запуск тестового источника, запись, разбор, сводка.
    Selftest {
        /// Длительность основного прогона, с.
        #[arg(long, default_value_t = 600)]
        seconds: u64,
        /// Длительность коротких прогонов, с.
        #[arg(long, default_value_t = 12)]
        short_seconds: u64,
        #[arg(long)]
        out: PathBuf,
        /// Только эти сценарии, через запятую (по умолчанию — все для этой ОС).
        #[arg(long, default_value = "")]
        only: String,
        /// Звуковой хост cpal для тестового источника (Linux: alsa, pulseaudio, pipewire).
        #[arg(long)]
        audio_host: Option<String>,
    },
    /// Вернуть устройству вывода состояние, сохранённое перед сценарием с выключенным
    /// звуком (нужно, только если прогон был прерван посреди такого сценария).
    RestoreOutput {
        /// Каталог прогона.
        #[arg(long)]
        out: PathBuf,
    },
    /// Сведения о стенде.
    Env,
}

fn parse_audio(s: &str) -> Res<AudioMode> {
    Ok(match s {
        "app" => AudioMode::App,
        "system" | "system-except-self" => AudioMode::SystemExceptSelf,
        "system-all" => AudioMode::SystemAll,
        "none" => AudioMode::None,
        other => return Err(format!("неизвестный режим звука: {other}").into()),
    })
}

fn parse_video(s: &str) -> Res<VideoMode> {
    Ok(match s {
        "auto" => VideoMode::Auto,
        "wgc" => VideoMode::Wgc,
        "dxgi" => VideoMode::Dxgi,
        "gdi" => VideoMode::Gdi,
        "sck" => VideoMode::Sck,
        "portal" => VideoMode::Portal,
        "none" => VideoMode::None,
        other => return Err(format!("неизвестный метод видео: {other}").into()),
    })
}

fn write_png(path: &Path, icon: &Icon) -> Res<()> {
    let mut enc = png::Encoder::new(BufWriter::new(File::create(path)?), icon.width, icon.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut writer = enc.write_header()?;
    writer.write_image_data(&icon.rgba)?;
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Res<()> {
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

fn cmd_list(icons: Option<PathBuf>) -> Res<()> {
    let windows = platform::list_windows(true)?;
    if let Some(dir) = &icons {
        fs::create_dir_all(dir)?;
    }
    println!("id\tpid\tразмер\tиконка\tприложение\tзаголовок\tзамечания");
    for w in &windows {
        let icon = match &w.icon {
            Some(i) => format!("{}×{}", i.width, i.height),
            None => "нет".to_owned(),
        };
        println!(
            "{}\t{}\t{}×{}\t{}\t{}\t{}\t{}",
            w.id,
            w.pid,
            w.width,
            w.height,
            icon,
            w.app,
            w.title,
            w.notes.join("; ")
        );
        if let (Some(dir), Some(i)) = (&icons, &w.icon) {
            write_png(&dir.join(format!("{}-{}.png", w.pid, w.id)), i)?;
        }
    }
    println!("окон: {}", windows.len());
    Ok(())
}

fn cmd_tree(pid: u32) -> Res<()> {
    let tree = platform::process_tree(pid)?;
    let nodes = platform::audio_nodes()?;
    for p in &tree {
        let mine: Vec<String> = nodes
            .iter()
            .filter(|n| n.pid == p.pid)
            .map(|n| {
                format!(
                    "узел {} ({}{})",
                    n.node_id,
                    n.kind,
                    if n.active { ", звучит" } else { "" }
                )
            })
            .collect();
        println!(
            "{}{} {} [{}]",
            "  ".repeat(p.depth as usize),
            p.pid,
            p.name,
            if mine.is_empty() {
                "без аудиоузлов".to_owned()
            } else {
                mine.join(", ")
            }
        );
    }
    Ok(())
}

fn cmd_nodes() -> Res<()> {
    for n in platform::audio_nodes()? {
        let extra: Vec<String> = n.extra.iter().map(|(k, v)| format!("{k}={v}")).collect();
        println!(
            "pid {}\tузел {}\t{}\t{}\t{}",
            n.pid,
            n.node_id,
            n.kind,
            if n.active {
                "звучит"
            } else {
                "молчит"
            },
            extra.join(" ")
        );
    }
    Ok(())
}

/// Один прогон захвата в каталог `dir`.
fn run_capture(
    req: &CaptureRequest,
    dir: &Path,
    seconds: u64,
    refresh_at: Option<u64>,
) -> Res<StartInfo> {
    fs::create_dir_all(dir)?;
    let audio = match req.audio {
        AudioMode::None => None,
        _ => Some(Arc::new(AudioSink::create(dir)?)),
    };
    let video = match req.video {
        VideoMode::None => None,
        _ => Some(Arc::new(VideoSink::create(dir)?)),
    };
    let running = platform::start_capture(req, audio.clone(), video.clone())?;
    let started = Instant::now();
    let deadline = started + Duration::from_secs(seconds);
    let mut next_report = started + Duration::from_secs(60);
    let mut refresh_note = None;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(at) = refresh_at {
            if refresh_note.is_none() && started.elapsed() >= Duration::from_secs(at) {
                refresh_note = Some(match running.refresh() {
                    Ok(what) => format!("обновление на {at}-й секунде: {what}"),
                    Err(e) => format!("обновление на {at}-й секунде не удалось: {e}"),
                });
            }
        }
        if Instant::now() >= next_report {
            next_report += Duration::from_secs(60);
            eprintln!(
                "s5cap: {} с из {}: звук {} кадров, видео {} кадров",
                started.elapsed().as_secs(),
                seconds,
                audio.as_ref().map(|a| a.frames()).unwrap_or(0),
                video.as_ref().map(|v| v.frames()).unwrap_or(0)
            );
        }
    }
    let mut info = running.stop();
    info.notes.extend(refresh_note);
    if let Some(a) = &audio {
        a.finish()?;
    }
    if let Some(v) = &video {
        v.finish()?;
    }
    Ok(info)
}

fn resolve_window(title: &Option<String>, id: Option<u64>) -> Res<Option<WindowInfo>> {
    if let Some(id) = id {
        return Ok(platform::list_windows(false)?
            .into_iter()
            .find(|w| w.id == id));
    }
    if let Some(title) = title {
        return platform::find_window_by_title(title, false);
    }
    Ok(None)
}

/// Проверка одного утверждения о прогоне.
#[derive(Clone, Debug, Serialize)]
struct Check {
    name: String,
    /// true — выполнено, false — нет, null — данных для вывода нет.
    pass: Option<bool>,
    detail: String,
    /// Наблюдение, а не требование: в итог «выполнено / не выполнено» не входит.
    observation: bool,
}

fn check(name: &str, pass: Option<bool>, detail: String) -> Check {
    Check {
        name: name.to_owned(),
        pass,
        detail,
        observation: false,
    }
}

/// Наблюдение: ответ на вопрос «как ведёт себя ОС», а не проверка требования.
fn observe(name: &str, value: bool, detail: String) -> Check {
    Check {
        name: name.to_owned(),
        pass: Some(value),
        detail,
        observation: true,
    }
}

/// Что сделать с устройством вывода на время сценария.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputTweak {
    /// Выключить звук (mute).
    Muted,
    /// Громкость 0, звук не выключен.
    VolumeZero,
}

/// Ожидание по тону: должен быть в записи или не должен.
fn tone_check(name: &str, level: f64, expect_present: bool) -> Check {
    let nominal = TONE_AMP as f64;
    let present = level >= 0.25 * nominal;
    let absent = level <= 0.02 * nominal;
    let pass = if expect_present {
        if present {
            Some(true)
        } else if absent {
            Some(false)
        } else {
            None
        }
    } else if absent {
        Some(true)
    } else if present {
        Some(false)
    } else {
        None
    };
    let want = if expect_present {
        "должен быть"
    } else {
        "не должен быть"
    };
    check(
        name,
        pass,
        format!("уровень {level:.5} при номинале {nominal:.3}; {want}"),
    )
}

#[derive(Clone, Debug)]
struct Scenario {
    name: &'static str,
    audio: AudioMode,
    video: VideoMode,
    seconds: u64,
    fail: &'static [&'static str],
    variant: &'static str,
    /// Какой метод видео должен сработать (пусто — не проверяется).
    expect_video: &'static str,
    /// Запустить дочерний процесс источника через столько секунд после старта записи.
    spawn_child_at: Option<u64>,
    /// Обновить состав захвата (пересобрать фильтр) через столько секунд после старта.
    refresh_at: Option<u64>,
    /// Часть названия метода звука, который должен сработать (пусто — не проверяется).
    expect_audio: &'static str,
    /// Чей звук ожидается в записи, если из-за сымитированного отказа сработает запасной метод.
    tones_as: Option<AudioMode>,
    /// Состояние устройства вывода на время сценария; после сценария возвращается прежнее.
    output: Option<OutputTweak>,
    /// Частота кадров, которую просим у захвата.
    fps: u32,
}

impl Scenario {
    fn new(name: &'static str, audio: AudioMode, video: VideoMode, seconds: u64) -> Self {
        Self {
            name,
            audio,
            video,
            seconds,
            fail: &[],
            variant: "",
            expect_video: "",
            spawn_child_at: None,
            refresh_at: None,
            expect_audio: "",
            tones_as: None,
            output: None,
            fps: 60,
        }
    }
}

fn scenarios(main_s: u64, short_s: u64) -> Vec<Scenario> {
    use AudioMode::{App, None as NoAudio, SystemAll, SystemExceptSelf};
    let mut list = vec![
        Scenario {
            spawn_child_at: Some(short_s / 2),
            ..Scenario::new("late-child", App, VideoMode::None, short_s + 4)
        },
        Scenario::new("main", App, VideoMode::Auto, main_s),
        Scenario::new(
            "system-except-self",
            SystemExceptSelf,
            VideoMode::None,
            short_s,
        ),
        Scenario::new("system-all", SystemAll, VideoMode::None, short_s),
    ];
    if cfg!(target_os = "macos") {
        list.push(Scenario {
            variant: "app",
            ..Scenario::new("app-two-streams", App, VideoMode::Auto, short_s)
        });
        // Процесс, запущенный во время записи: фильтр по приложению и обновление фильтра.
        list.push(Scenario {
            variant: "app",
            spawn_child_at: Some(4),
            ..Scenario::new("late-child-app", App, VideoMode::None, 12)
        });
        list.push(Scenario {
            spawn_child_at: Some(4),
            refresh_at: Some(8),
            ..Scenario::new("late-child-refresh", App, VideoMode::None, 16)
        });
        list.push(Scenario {
            variant: "app",
            spawn_child_at: Some(4),
            refresh_at: Some(8),
            ..Scenario::new("late-child-app-refresh", App, VideoMode::None, 16)
        });
        list.push(Scenario {
            variant: "restart",
            spawn_child_at: Some(4),
            refresh_at: Some(8),
            ..Scenario::new("late-child-restart", App, VideoMode::None, 16)
        });
        // Кто теряет кадры: тот же захват окна, но с разрешённой частотой 120 к/с
        // при источнике 60 к/с.
        list.push(Scenario {
            fps: 120,
            ..Scenario::new("video-limit-120", NoAudio, VideoMode::Auto, short_s)
        });
        list.push(Scenario::new(
            "video-limit-60",
            NoAudio,
            VideoMode::Auto,
            short_s,
        ));
        // Второй поток звука до остановки первого и склейка по шкале времени.
        list.push(Scenario {
            variant: "splice",
            spawn_child_at: Some(4),
            refresh_at: Some(8),
            ..Scenario::new("late-child-splice", App, VideoMode::Auto, 16)
        });
        list.push(Scenario {
            variant: "app,splice",
            spawn_child_at: Some(4),
            refresh_at: Some(8),
            ..Scenario::new("late-child-app-splice", App, VideoMode::None, 16)
        });
    }
    if cfg!(windows) {
        // Отказ process loopback: по цепочке должен сработать режим «система без своего процесса».
        list.push(Scenario {
            fail: &["process-loopback"],
            expect_audio: "система без собственного процесса",
            tones_as: Some(SystemExceptSelf),
            ..Scenario::new(
                "audio-without-process-loopback",
                App,
                VideoMode::None,
                short_s,
            )
        });
        list.push(Scenario {
            fail: &["process-loopback", "system-exclude-self"],
            expect_audio: "loopback устройства вывода",
            tones_as: Some(SystemAll),
            ..Scenario::new("audio-endpoint-only", App, VideoMode::None, short_s)
        });
        // Пишется ли звук, когда устройство вывода заглушено или громкость нулевая.
        for (name, audio, tweak) in [
            ("app-audio-output-muted", App, OutputTweak::Muted),
            ("app-audio-output-volume-zero", App, OutputTweak::VolumeZero),
            ("endpoint-audio-output-muted", SystemAll, OutputTweak::Muted),
            (
                "endpoint-audio-output-volume-zero",
                SystemAll,
                OutputTweak::VolumeZero,
            ),
        ] {
            list.push(Scenario {
                output: Some(tweak),
                ..Scenario::new(name, audio, VideoMode::None, 6)
            });
        }
        for (name, mode) in [
            ("video-wgc", VideoMode::Wgc),
            ("video-dxgi", VideoMode::Dxgi),
            ("video-gdi", VideoMode::Gdi),
        ] {
            list.push(Scenario {
                expect_video: mode.name(),
                ..Scenario::new(name, NoAudio, mode, short_s)
            });
        }
        list.push(Scenario {
            fail: &["wgc"],
            expect_video: "dxgi",
            ..Scenario::new("auto-without-wgc", NoAudio, VideoMode::Auto, short_s)
        });
        list.push(Scenario {
            fail: &["wgc", "dxgi"],
            expect_video: "gdi",
            ..Scenario::new("auto-without-wgc-dxgi", NoAudio, VideoMode::Auto, short_s)
        });
    }
    list
}

#[derive(Debug, Serialize)]
struct ScenarioResult {
    name: String,
    audio: AudioMode,
    video: VideoMode,
    seconds: u64,
    error: Option<String>,
    start: StartInfo,
    analysis: Analysis,
    checks: Vec<Check>,
}

fn evaluate(sc: &Scenario, start: &StartInfo, an: &Analysis) -> Vec<Check> {
    let mut out = Vec::new();
    if let Some(tweak) = sc.output {
        let state = match tweak {
            OutputTweak::Muted => "звук устройства вывода выключен (mute)",
            OutputTweak::VolumeZero => "громкость устройства вывода 0",
        };
        let what = match sc.audio {
            AudioMode::App => "звук приложения",
            _ => "звук системы через loopback устройства",
        };
        let nominal = TONE_AMP as f64;
        match &an.audio {
            Some(a) => {
                out.push(observe(
                    &format!("{what} пишется, когда {state}"),
                    a.tones.parent >= 0.25 * nominal,
                    format!(
                        "уровень тона 440 Гц {:.5} при номинале {nominal:.3} ({:.0} % номинала); буферов {}, из них помечено тишиной {}; записано {} с из {}",
                        a.tones.parent,
                        a.tones.parent / nominal * 100.0,
                        a.buffers,
                        a.os_silent_buffers,
                        a.duration_s,
                        sc.seconds
                    ),
                ));
            }
            None => out.push(observe(
                &format!("{what} пишется, когда {state}"),
                false,
                "записи нет".to_owned(),
            )),
        }
        return out;
    }
    if let Some(a) = &an.audio {
        if !sc.expect_audio.is_empty() {
            out.push(check(
                "сработал ожидаемый метод звука",
                Some(start.audio_method.contains(sc.expect_audio)),
                format!(
                    "ожидался «{}», сработал «{}»",
                    sc.expect_audio, start.audio_method
                ),
            ));
        }
        let (parent, child, foreign, own) = match sc.tones_as.unwrap_or(sc.audio) {
            AudioMode::App => (true, true, false, false),
            AudioMode::SystemExceptSelf => (true, true, true, false),
            AudioMode::SystemAll => (true, true, true, true),
            AudioMode::None => (false, false, false, false),
        };
        out.push(tone_check(
            "тон главного процесса (440 Гц)",
            a.tones.parent,
            parent,
        ));
        if sc.spawn_child_at.is_none() {
            out.push(tone_check(
                "тон дочернего процесса (880 Гц)",
                a.tones.child,
                child,
            ));
        }
        out.push(tone_check(
            "тон постороннего процесса (1320 Гц)",
            a.tones.foreign,
            foreign,
        ));
        out.push(tone_check(
            "тон программы захвата (2000 Гц)",
            a.tones.own,
            own,
        ));
        if let Some(at) = sc.spawn_child_at {
            let onset = a
                .child_onset_s
                .map(|t| format!("на {t:.1} с"))
                .unwrap_or_else(|| "не появился".to_owned());
            match sc.refresh_at {
                None => out.push(check(
                    "звук процесса, запущенного во время записи",
                    Some(
                        a.child_onset_s
                            .is_some_and(|t| t >= at as f64 - 1.0 && t <= at as f64 + 5.0),
                    ),
                    format!("процесс запущен на {at}-й секунде; тон 880 Гц появился: {onset}"),
                )),
                Some(refresh) => out.push(check(
                    "звук процесса, запущенного во время записи, после обновления захвата",
                    Some(
                        a.child_onset_s
                            .is_some_and(|t| t >= at as f64 - 1.0 && t <= refresh as f64 + 4.0),
                    ),
                    format!(
                        "процесс запущен на {at}-й секунде, захват обновлён на {refresh}-й; тон 880 Гц появился: {onset}"
                    ),
                )),
            }
        }
        if sc.variant.contains("restart") {
            // Перезапуск потока рвёт звук по построению: разрыв ожидаем, важна его длина.
            out.push(check(
                "разрыв звука при перезапуске потока короче полусекунды",
                Some(a.timeline_gaps >= 1 && a.timeline_gap_total_ms < 500.0),
                format!(
                    "разрывов {}, суммарно {} мс",
                    a.timeline_gaps, a.timeline_gap_total_ms
                ),
            ));
        } else {
            out.push(check(
                "шкала времени звука без разрывов",
                Some(a.timeline_gaps == 0 && a.timeline_overlaps == 0 && a.os_discontinuities == 0),
                format!(
                    "разрывов вперёд {}, назад {}, флагов разрыва от ОС {}, суммарно {} мс",
                    a.timeline_gaps,
                    a.timeline_overlaps,
                    a.os_discontinuities,
                    a.timeline_gap_total_ms
                ),
            ));
            if a.windows_analyzed > 0 {
                out.push(check(
                    "сэмплы без потерь (фаза тона 440 Гц)",
                    Some(a.phase_jumps == 0 && a.dropout_windows == 0),
                    format!(
                        "скачков фазы {}, наибольший {}°, окон с провалом {} из {}",
                        a.phase_jumps, a.phase_jump_max_deg, a.dropout_windows, a.windows_analyzed
                    ),
                ));
            }
        }
        out.push(check(
            "длительность записи",
            Some((a.duration_s - sc.seconds as f64).abs() <= 1.5),
            format!(
                "записано {} с при запросе {} с; по меткам ОС {} с",
                a.duration_s, sc.seconds, a.span_s
            ),
        ));
    } else if sc.audio != AudioMode::None {
        out.push(check(
            "звук записан",
            Some(false),
            "файла записи нет".to_owned(),
        ));
    }
    if let Some(v) = &an.video {
        out.push(check(
            "видео-метки есть",
            Some(v.frames > 0 && v.non_monotonic == 0),
            format!(
                "кадров {}, {} к/с, интервал p95 {} мс, длинных интервалов {}, неубывающих меток {}",
                v.frames, v.fps, v.interval_ms.p95, v.long_intervals, v.non_monotonic
            ),
        ));
        out.push(check(
            "вспышки видны в кадрах",
            Some(v.flashes as u64 + 2 >= sc.seconds),
            format!("вспышек {} за {} с", v.flashes, sc.seconds),
        ));
        if !sc.expect_video.is_empty() {
            out.push(check(
                "сработал ожидаемый метод видео",
                Some(start.video_method == sc.expect_video),
                format!(
                    "ожидался {}, сработал {}",
                    sc.expect_video, start.video_method
                ),
            ));
        }
    } else if sc.video != VideoMode::None {
        out.push(check(
            "видео-метки есть",
            Some(false),
            "журнала нет".to_owned(),
        ));
    }
    if let Some(f) = &an.frame_loss {
        // Наблюдение: захват должен получить не меньше 99 % отрисованных кадров и не
        // иметь пропусков, которых не было у источника.
        let share = if f.source_frames > 0 {
            f.captured_frames as f64 / f.source_frames as f64 * 100.0
        } else {
            0.0
        };
        out.push(observe(
            "захват отдаёт все кадры, которые отрисовал источник",
            share >= 99.0 && f.long_only_in_capture == 0,
            format!(
                "источник отрисовал {} кадров ({} к/с), захват получил {} ({share:.1} %); длинных интервалов у источника {}, у захвата {}, из них без причины в источнике {}",
                f.source_frames,
                f.source_fps,
                f.captured_frames,
                f.source_long_intervals,
                f.captured_long_intervals,
                f.long_only_in_capture
            ),
        ));
    }
    if let Some(s) = &an.sync {
        out.push(check(
            "рассинхрон звука и видео: p95 модуля не больше 40 мс",
            if s.pairs == 0 {
                None
            } else {
                Some(s.within_tolerance)
            },
            format!(
                "пар {}, среднее {} мс, p95 модуля {} мс, максимум модуля {} мс; критерий — p95 ≤ {} мс",
                s.pairs,
                s.offset_ms.mean,
                s.offset_ms.p95_abs,
                s.offset_ms.max_abs,
                SYNC_TOLERANCE_MS
            ),
        ));
    }
    out
}

/// Файл в каталоге прогона с состоянием устройства вывода до его изменения.
const OUTPUT_STATE_FILE: &str = "output-state-before.json";

/// Вернуть устройству вывода состояние из файла и удалить файл.
fn restore_output(out: &Path) -> Res<()> {
    let file = out.join(OUTPUT_STATE_FILE);
    let state: OutputState = serde_json::from_slice(&fs::read(&file)?)?;
    platform::set_output_state(&state)?;
    fs::remove_file(&file)?;
    eprintln!(
        "s5cap: устройство вывода возвращено: звук {}, громкость {:.0} %",
        if state.muted {
            "выключен"
        } else {
            "включён"
        },
        state.volume * 100.0
    );
    Ok(())
}

/// Выполнить `run` с изменённым устройством вывода и вернуть прежнее состояние.
///
/// Прежнее состояние сначала пишется в файл: если прогон прервут, его вернёт
/// следующий запуск самотеста или команда `restore-output`.
fn with_output_tweak(
    out: &Path,
    tweak: OutputTweak,
    run: impl FnOnce() -> Res<StartInfo>,
) -> Res<StartInfo> {
    let before = platform::output_state()?;
    write_json(&out.join(OUTPUT_STATE_FILE), &before)?;
    let during = match tweak {
        OutputTweak::Muted => OutputState {
            muted: true,
            volume: before.volume,
        },
        OutputTweak::VolumeZero => OutputState {
            muted: false,
            volume: 0.0,
        },
    };
    let applied = platform::set_output_state(&during);
    if applied.is_ok() {
        // Дать звуковой подсистеме применить состояние до начала записи.
        std::thread::sleep(Duration::from_millis(500));
    }
    let result = applied.and_then(|()| run());
    let restored = restore_output(out);
    let mut info = result?;
    info.notes.push(format!(
        "устройство вывода до сценария: звук {}, громкость {:.0} %; на время сценария: звук {}, громкость {:.0} %",
        if before.muted { "выключен" } else { "включён" },
        before.volume * 100.0,
        if during.muted { "выключен" } else { "включён" },
        during.volume * 100.0
    ));
    if let Err(e) = restored {
        info.notes
            .push(format!("состояние устройства вывода НЕ возвращено: {e}"));
    }
    Ok(info)
}

/// Убрать префикс расширенного пути Windows (`\\?\`): он мешает передавать путь
/// в командной строке другим программам.
fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path,
    }
}

fn wait_for_file(path: &Path, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    path.exists()
}

fn read_pid(path: &Path, key: &str) -> Option<u32> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    value.get(key)?.as_u64().map(|v| v as u32)
}

#[derive(Debug, Serialize)]
struct WindowCheck {
    found: bool,
    pid_matches_source: bool,
    /// Размер окна в единицах ОС: Windows — физические пиксели, macOS — точки.
    width: u32,
    height: u32,
    /// Масштаб экрана окна (1.25 — это 125 %); 0 — список окон его не сообщает.
    scale: f32,
    icon: Option<(u32, u32)>,
    notes: Vec<String>,
    windows_total: usize,
}

#[derive(Debug, Serialize)]
struct Mapping {
    /// Дерево процессов тестового источника.
    tree: Vec<ProcInfo>,
    /// PID дочернего процесса источника есть в дереве.
    child_in_tree: bool,
    /// PID постороннего процесса в дерево не попал.
    foreign_outside_tree: bool,
    /// Аудиоузлы ОС, которые принадлежат процессам дерева.
    nodes_in_tree: Vec<s5::model::AudioNodeInfo>,
    /// У постороннего процесса есть свой аудиоузел.
    foreign_has_node: bool,
    /// Всего аудиоузлов в системе на момент проверки.
    nodes_total: usize,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct SelftestReport {
    env: EnvInfo,
    source_launch: Vec<String>,
    source_audio: serde_json::Value,
    window: Option<WindowCheck>,
    mapping: Option<Mapping>,
    own_tone: String,
    scenarios: Vec<ScenarioResult>,
    passed: usize,
    failed: usize,
    unclear: usize,
}

fn cmd_selftest(
    main_s: u64,
    short_s: u64,
    out: PathBuf,
    only: String,
    audio_host: Option<String>,
) -> Res<()> {
    fs::create_dir_all(&out)?;
    let out = plain_path(fs::canonicalize(&out)?);
    // Экран не должен погаснуть: при выключенном экране система не отдаёт кадры.
    let _awake = platform::keep_display_awake();
    if out.join(OUTPUT_STATE_FILE).exists() {
        eprintln!(
            "s5cap: прошлый прогон прерван с изменённым устройством вывода — возвращаю состояние"
        );
        restore_output(&out)?;
    }
    for stale in [
        "stop",
        "spawn-child",
        "source-parent.json",
        "source-child.json",
        "source-foreign.json",
    ] {
        let _ = fs::remove_file(out.join(stale));
    }
    let only: Vec<&str> = only.split(',').filter(|s| !s.is_empty()).collect();
    let plan: Vec<Scenario> = scenarios(main_s, short_s)
        .into_iter()
        .filter(|s| only.is_empty() || only.contains(&s.name))
        .collect();
    let total: u64 = plan.iter().map(|s| s.seconds + 3).sum::<u64>() + 30;
    eprintln!(
        "s5cap: сценариев {}, ожидаемая длительность около {} с",
        plan.len(),
        total
    );

    let exe = std::env::current_exe()?;
    let src_exe = exe.with_file_name(if cfg!(windows) { "s5src.exe" } else { "s5src" });
    if !src_exe.exists() {
        return Err(format!("рядом с s5cap нет {}", src_exe.display()).into());
    }
    let title = format!("S5 Source {}", std::process::id());
    let mut extra = vec![
        "--title".to_owned(),
        title.clone(),
        "--child-on-file".to_owned(),
    ];
    if let Some(host) = &audio_host {
        extra.push("--audio-host".to_owned());
        extra.push(host.clone());
    }
    let mut launched: Vec<Launched> = Vec::new();
    let mut source_launch = Vec::new();
    let result = (|| -> Res<SelftestReport> {
        let l = platform::launch_source(
            &src_exe,
            "parent",
            &out,
            &platform::source_args("parent", &out, total + 60, &extra),
        )?;
        source_launch.push(format!("источник: {}", l.how));
        launched.push(l);
        let foreign_extra: Vec<String> = audio_host
            .iter()
            .flat_map(|h| ["--audio-host".to_owned(), h.clone()])
            .collect();
        let l = platform::launch_source(
            &src_exe,
            "foreign",
            &out,
            &platform::source_args("foreign", &out, total + 60, &foreign_extra),
        )?;
        source_launch.push(format!("посторонний процесс: {}", l.how));
        launched.push(l);

        for role in ["parent", "foreign"] {
            if !wait_for_file(
                &out.join(format!("source-{role}.json")),
                Duration::from_secs(20),
            ) {
                let reason = fs::read_to_string(out.join(format!("source-{role}.err")))
                    .unwrap_or_else(|_| "причина не записана".to_owned());
                return Err(
                    format!("тестовый источник ({role}) не запустился за 20 с: {reason}").into(),
                );
            }
        }
        let parent_pid =
            read_pid(&out.join("source-parent.json"), "pid").ok_or("нет PID источника")?;
        let foreign_pid =
            read_pid(&out.join("source-foreign.json"), "pid").ok_or("нет PID постороннего")?;
        let source_audio: serde_json::Value =
            serde_json::from_slice(&fs::read(out.join("source-parent.json"))?)?;

        // Окно источника: ждём, пока оно появится в списке ОС.
        let mut window: Option<WindowInfo> = None;
        let mut windows_total = 0;
        let mut list_error = None;
        let deadline = Instant::now() + Duration::from_secs(20);
        while window.is_none() && Instant::now() < deadline {
            match platform::list_windows(true) {
                Ok(all) => {
                    windows_total = all.len();
                    window = all.into_iter().find(|w| w.title == title);
                }
                Err(e) => list_error = Some(e.to_string()),
            }
            if window.is_none() {
                std::thread::sleep(Duration::from_millis(500));
            }
        }
        let window_check = Some(match &window {
            Some(w) => {
                if let Some(icon) = &w.icon {
                    let _ = write_png(&out.join("source-icon.png"), icon);
                }
                WindowCheck {
                    found: true,
                    pid_matches_source: w.pid == parent_pid,
                    width: w.width,
                    height: w.height,
                    scale: w.scale,
                    icon: w.icon.as_ref().map(|i| (i.width, i.height)),
                    notes: w.notes.clone(),
                    windows_total,
                }
            }
            None => WindowCheck {
                found: false,
                pid_matches_source: false,
                width: 0,
                height: 0,
                scale: 0.0,
                icon: None,
                notes: list_error.into_iter().collect(),
                windows_total,
            },
        });

        let own = tone::play(TONE_SELF_HZ, None, None);
        let own_tone = match &own {
            Ok(p) => format!(
                "играет: {} Гц, каналов {}, {}",
                p.sample_rate, p.channels, p.format
            ),
            Err(e) => format!("не запущен: {e}"),
        };

        let mut results = Vec::new();
        let mut mapping: Option<Mapping> = None;
        for sc in &plan {
            eprintln!("s5cap: сценарий {} ({} с)", sc.name, sc.seconds);
            let dir = out.join(sc.name);
            let req = CaptureRequest {
                window: window.clone(),
                pid: Some(parent_pid),
                audio: sc.audio,
                video: sc.video,
                fail: sc.fail.iter().map(|s| (*s).to_owned()).collect(),
                fps: sc.fps,
                variant: sc.variant.to_owned(),
            };
            let spawn_at = sc.spawn_child_at;
            let trigger = out.join("spawn-child");
            if spawn_at.is_none() && !out.join("source-child.json").exists() {
                // Сценарию нужен дочерний процесс источника, а его ещё нет: запустить заранее.
                let _ = fs::write(&trigger, b"1");
                wait_for_file(&out.join("source-child.json"), Duration::from_secs(10));
                std::thread::sleep(Duration::from_millis(500));
            }
            if spawn_at.is_some() && out.join("source-child.json").exists() {
                // Дочерний процесс уже работает: завершить, чтобы запустить заново во время записи.
                let _ = fs::write(out.join("kill-child"), b"1");
                let gone = Instant::now() + Duration::from_secs(5);
                while out.join("source-child.json").exists() && Instant::now() < gone {
                    std::thread::sleep(Duration::from_millis(100));
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            let spawner = spawn_at.map(|at| {
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(at));
                    let _ = fs::write(trigger, b"1");
                })
            });
            let run = match sc.output {
                None => run_capture(&req, &dir, sc.seconds, sc.refresh_at),
                Some(tweak) => with_output_tweak(&out, tweak, || {
                    run_capture(&req, &dir, sc.seconds, sc.refresh_at)
                }),
            };
            if let Some(h) = spawner {
                let _ = h.join();
            }
            let (start, error) = match run {
                Ok(info) => (info, None),
                Err(e) => (StartInfo::default(), Some(e.to_string())),
            };
            // Журнал источника общий для всех сценариев: копия нужна разбору.
            let _ = fs::copy(out.join("source-marks.tsv"), dir.join("source-marks.tsv"));
            let _ = fs::copy(out.join("source-frames.tsv"), dir.join("source-frames.tsv"));
            let analysis = if error.is_none() {
                analyze::analyze_dir(&dir).unwrap_or_default()
            } else {
                Analysis::default()
            };
            let mut checks = evaluate(sc, &start, &analysis);
            if let Some(e) = &error {
                checks.push(check("захват запущен", Some(false), e.clone()));
            }
            results.push(ScenarioResult {
                name: sc.name.to_owned(),
                audio: sc.audio,
                video: sc.video,
                seconds: sc.seconds,
                error,
                start,
                analysis,
                checks,
            });

            // После первого сценария с дочерним процессом: дерево процессов и аудиоузлы.
            if mapping.is_none()
                && wait_for_file(&out.join("source-child.json"), Duration::from_secs(1))
            {
                let child_pid = read_pid(&out.join("source-child.json"), "pid");
                mapping = Some(build_mapping(parent_pid, child_pid, foreign_pid));
            }
        }
        if mapping.is_none() {
            // Сценария с поздним запуском не было: попросим источник запустить потомка сейчас.
            let _ = fs::write(out.join("spawn-child"), b"1");
            wait_for_file(&out.join("source-child.json"), Duration::from_secs(10));
            let child_pid = read_pid(&out.join("source-child.json"), "pid");
            mapping = Some(build_mapping(parent_pid, child_pid, foreign_pid));
        }
        drop(own);

        let (mut passed, mut failed, mut unclear) = (0, 0, 0);
        for c in results
            .iter()
            .flat_map(|r| r.checks.iter())
            .filter(|c| !c.observation)
        {
            match c.pass {
                Some(true) => passed += 1,
                Some(false) => failed += 1,
                None => unclear += 1,
            }
        }
        Ok(SelftestReport {
            env: platform::env_info(),
            source_launch: source_launch.clone(),
            source_audio,
            window: window_check,
            mapping,
            own_tone,
            scenarios: results,
            passed,
            failed,
            unclear,
        })
    })();

    // Остановить источники в любом случае.
    let _ = fs::write(out.join("stop"), b"1");
    std::thread::sleep(Duration::from_millis(1200));
    for l in &mut launched {
        if let Some(child) = l.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    let report = result?;
    write_json(&out.join("selftest.json"), &report)?;
    println!("сценарий\tпроверка\tитог\tподробности");
    for r in &report.scenarios {
        for c in &r.checks {
            let verdict = match (c.pass, c.observation) {
                (Some(true), false) => "да",
                (Some(false), false) => "НЕТ",
                (Some(true), true) => "да (наблюдение)",
                (Some(false), true) => "нет (наблюдение)",
                (None, _) => "неясно",
            };
            println!("{}\t{}\t{}\t{}", r.name, c.name, verdict, c.detail);
        }
        for n in &r.start.notes {
            println!("{}\tзамечание\t—\t{}", r.name, n);
        }
    }
    println!(
        "итого: выполнено {}, не выполнено {}, неясно {}; сводка — {}",
        report.passed,
        report.failed,
        report.unclear,
        out.join("selftest.json").display()
    );
    if report.failed > 0 {
        std::process::exit(3);
    }
    Ok(())
}

fn build_mapping(parent_pid: u32, child_pid: Option<u32>, foreign_pid: u32) -> Mapping {
    let tree = platform::process_tree(parent_pid);
    let nodes = platform::audio_nodes();
    let mut error = None;
    let tree = tree.unwrap_or_else(|e| {
        error = Some(format!("дерево процессов: {e}"));
        Vec::new()
    });
    let nodes = nodes.unwrap_or_else(|e| {
        error = Some(format!("аудиоузлы: {e}"));
        Vec::new()
    });
    let in_tree = |pid: u32| tree.iter().any(|p| p.pid == pid);
    Mapping {
        child_in_tree: child_pid.is_some_and(in_tree),
        foreign_outside_tree: !in_tree(foreign_pid),
        nodes_in_tree: nodes.iter().filter(|n| in_tree(n.pid)).cloned().collect(),
        foreign_has_node: nodes.iter().any(|n| n.pid == foreign_pid),
        nodes_total: nodes.len(),
        tree,
        error,
    }
}

fn main() {
    let cli = Cli::parse();
    platform::init();
    let result: Res<()> = match cli.cmd {
        Cmd::List { icons } => cmd_list(icons),
        Cmd::Tree { pid } => cmd_tree(pid),
        Cmd::Nodes => cmd_nodes(),
        Cmd::Record {
            title,
            window,
            pid,
            audio,
            video,
            seconds,
            out,
            fail,
            variant,
            fps,
            own_tone,
        } => (|| {
            let window = resolve_window(&title, window)?;
            if window.is_none() && (title.is_some()) {
                return Err("окно с таким заголовком не найдено".into());
            }
            let req = CaptureRequest {
                window,
                pid,
                audio: parse_audio(&audio)?,
                video: parse_video(&video)?,
                fail: fail
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .collect(),
                fps,
                variant,
            };
            let _awake = platform::keep_display_awake();
            let _own = if own_tone {
                Some(tone::play(TONE_SELF_HZ, None, None)?)
            } else {
                None
            };
            let info = run_capture(&req, &out, seconds, None)?;
            write_json(&out.join("run.json"), &info)?;
            let analysis = analyze::analyze_dir(&out)?;
            write_json(&out.join("summary.json"), &analysis)?;
            println!("{}", serde_json::to_string_pretty(&info)?);
            println!("{}", serde_json::to_string_pretty(&analysis)?);
            Ok(())
        })(),
        Cmd::Analyze { dir, timeline } => (|| {
            let analysis = analyze::analyze_dir(&dir)?;
            write_json(&dir.join("summary.json"), &analysis)?;
            println!("{}", serde_json::to_string_pretty(&analysis)?);
            if timeline {
                let mono = analyze::read_wav_mono(&dir.join("audio.wav"))?;
                println!("секунда\t440 Гц\t880 Гц\t1320 Гц\t2000 Гц");
                for (i, row) in analyze::tone_timeline(&mono).iter().enumerate() {
                    println!("{i}\t{}\t{}\t{}\t{}", row[0], row[1], row[2], row[3]);
                }
            }
            Ok(())
        })(),
        Cmd::Selftest {
            seconds,
            short_seconds,
            out,
            only,
            audio_host,
        } => cmd_selftest(seconds, short_seconds, out, only, audio_host),
        Cmd::RestoreOutput { out } => restore_output(&out),
        Cmd::Env => (|| {
            println!("{}", serde_json::to_string_pretty(&platform::env_info())?);
            Ok(())
        })(),
    };
    if let Err(e) = result {
        eprintln!("s5cap: {e}");
        std::process::exit(1);
    }
}
