// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Тестовый источник спайка S5.
//!
//! Роль `parent`: окно с бегущей полосой, непрерывный тон 440 Гц, раз в секунду —
//! вспышка окна и щелчок одновременно; запускает дочерний процесс с ролью `child`.
//! Роль `child`: тон 880 Гц без окна. Роль `foreign`: тон 1320 Гц без окна
//! (посторонний процесс, в звук приложения попасть не должен).
//!
//! В каталог прогона пишутся `source-<роль>.json` (PID и формат вывода),
//! `source-marks.tsv` (моменты вспышек и щелчков по монотонной шкале) и
//! `source-frames.tsv` (момент отрисовки каждого кадра окна). Работа
//! завершается по времени или когда в каталоге появляется файл `stop`.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

use clap::Parser;
use s5::clock::now_ns;
use s5::model::Res;
use s5::signal::{FLASH_MS, MARK_PERIOD_MS, TONE_CHILD_HZ, TONE_FOREIGN_HZ, TONE_PARENT_HZ};
use s5::tone::{self, ClickCtl, TonePlayer};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowId, WindowLevel};

#[derive(Parser, Debug)]
#[command(about = "Тестовый источник спайка S5: окно, тон, вспышка и щелчок")]
struct Args {
    /// Роль: parent, child или foreign.
    #[arg(long, default_value = "parent")]
    role: String,
    /// Каталог прогона.
    #[arg(long)]
    out: PathBuf,
    /// Сколько секунд работать.
    #[arg(long, default_value_t = 660)]
    duration: u64,
    /// Звуковой хост cpal (по умолчанию — хост ОС по умолчанию).
    #[arg(long)]
    audio_host: Option<String>,
    /// Заголовок окна: по нему программа захвата находит окно.
    #[arg(long, default_value = "S5 Source")]
    title: String,
    /// Не запускать дочерний процесс.
    #[arg(long)]
    no_child: bool,
    /// Не запускать дочерний процесс сразу, а управлять им файлами в каталоге прогона:
    /// `spawn-child` — запустить, `kill-child` — завершить (проверка, что звук нового
    /// процесса подхватывается на ходу).
    #[arg(long)]
    child_on_file: bool,
    /// Тишина: звуковой поток работает, но отдаёт нули (для прогонов без записи звука).
    #[arg(long)]
    silent: bool,
}

fn write_info(args: &Args, player: &TonePlayer, child_pid: Option<u32>) -> Res<()> {
    let info = serde_json::json!({
        "role": args.role,
        "pid": std::process::id(),
        "child_pid": child_pid,
        "title": args.title,
        "audio_host": player.host,
        "sample_rate": player.sample_rate,
        "channels": player.channels,
        "sample_format": player.format,
    });
    let tmp = args.out.join(format!("source-{}.json.tmp", args.role));
    fs::write(&tmp, serde_json::to_vec_pretty(&info)?)?;
    fs::rename(&tmp, args.out.join(format!("source-{}.json", args.role)))?;
    Ok(())
}

fn stop_requested(args: &Args) -> bool {
    args.out.join("stop").exists()
}

/// Роли без окна: играть тон, пока не попросят остановиться.
fn run_headless(args: &Args, tone_hz: f64) -> Res<()> {
    let player = tone::play(tone_hz, None, args.audio_host.as_deref())?;
    write_info(args, &player, None)?;
    let deadline = Instant::now() + Duration::from_secs(args.duration);
    while Instant::now() < deadline && !stop_requested(args) {
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(())
}

struct App {
    args: Args,
    window: Option<Rc<Window>>,
    surface: Option<softbuffer::Surface<Rc<Window>, Rc<Window>>>,
    marks: BufWriter<File>,
    /// Журнал отрисованных кадров: по строке на кадр, время после передачи кадра системе.
    frames: BufWriter<File>,
    /// Интервал между кадрами; меняется файлом-командой `set-fps`.
    frame_period: Duration,
    click_requests: Arc<AtomicU64>,
    click_marks: Receiver<(u64, u64)>,
    deadline: Instant,
    next_frame: Instant,
    next_mark_ns: u64,
    flash_from_ns: u64,
    flash_until_ns: u64,
    /// Выравнивать ли вспышку под задержку вывода звука (файл-команда `set-compensate`).
    compensate: bool,
    /// Последняя оценка задержки вывода звука от библиотеки вывода, нс.
    playback_delay_ns: u64,
    flash_logged: bool,
    last_stop_check: Instant,
    frame_no: u64,
    error: Option<String>,
    player: TonePlayer,
    child: Option<Child>,
}

impl App {
    /// Управление дочерним процессом файлами в каталоге прогона: `spawn-child` —
    /// запустить, `kill-child` — завершить. Файл-команда удаляется после выполнения.
    /// Сменить частоту перерисовки окна: файл `set-fps` с числом кадров в секунду.
    fn handle_fps_command(&mut self) {
        let file = self.args.out.join("set-fps");
        let Ok(text) = fs::read_to_string(&file) else {
            return;
        };
        if let Ok(fps) = text.trim().parse::<u64>() {
            if (1..=240).contains(&fps) {
                self.frame_period = Duration::from_micros(1_000_000 / fps);
            }
        }
        let _ = fs::remove_file(file);
    }

    /// Включить или выключить выравнивание вспышки под задержку вывода звука:
    /// файл `set-compensate` с `1` или `0`.
    fn handle_compensate_command(&mut self) {
        let file = self.args.out.join("set-compensate");
        let Ok(text) = fs::read_to_string(&file) else {
            return;
        };
        self.compensate = text.trim() == "1";
        let _ = fs::remove_file(file);
    }

    fn handle_child_commands(&mut self) {
        if !self.args.child_on_file {
            return;
        }
        let kill = self.args.out.join("kill-child");
        if kill.exists() {
            if let Some(mut child) = self.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let _ = fs::remove_file(self.args.out.join("source-child.json"));
            let _ = write_info(&self.args, &self.player, None);
            let _ = fs::remove_file(kill);
        }
        let spawn = self.args.out.join("spawn-child");
        if spawn.exists() {
            if self.child.is_none() {
                match spawn_child(&self.args) {
                    Ok(child) => {
                        let _ = write_info(&self.args, &self.player, Some(child.id()));
                        self.child = Some(child);
                    }
                    Err(e) => self.error = Some(format!("дочерний процесс не запущен: {e}")),
                }
            }
            let _ = fs::remove_file(spawn);
        }
    }

    fn drain_click_marks(&mut self) {
        while let Ok((t_ns, delay_ns)) = self.click_marks.try_recv() {
            let _ = writeln!(self.marks, "click\t{t_ns}\t{delay_ns}");
            self.playback_delay_ns = delay_ns;
        }
    }

    fn draw(&mut self) -> Res<()> {
        let (Some(window), Some(surface)) = (self.window.as_ref(), self.surface.as_mut()) else {
            return Ok(());
        };
        let size = window.inner_size();
        let (Some(w), Some(h)) = (NonZeroU32::new(size.width), NonZeroU32::new(size.height)) else {
            return Ok(());
        };
        surface.resize(w, h).map_err(|e| e.to_string())?;
        let now = now_ns();
        let lit = now >= self.flash_from_ns && now < self.flash_until_ns;
        let (width, height) = (size.width as usize, size.height as usize);
        let mut buffer = surface.buffer_mut().map_err(|e| e.to_string())?;
        let background = if lit { 0x00FF_FFFF } else { 0x0020_2020 };
        buffer.fill(background);
        // Бегущая полоса в верхней четверти: каждый кадр отличается от предыдущего,
        // а контрольная точка в центре окна показывает только фон или вспышку.
        let bar_w = (width / 16).max(1);
        let bar_x = (self.frame_no as usize * 8) % width.max(1);
        for y in 0..height / 4 {
            for x in bar_x..(bar_x + bar_w).min(width) {
                buffer[y * width + x] = 0x0040_A0FF;
            }
        }
        buffer.present().map_err(|e| e.to_string())?;
        let _ = writeln!(self.frames, "{}\t{}", now_ns(), self.frame_no);
        self.frame_no += 1;
        if lit && !self.flash_logged {
            self.flash_logged = true;
            let _ = writeln!(self.marks, "flash\t{}\t0", now_ns());
        }
        Ok(())
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title(self.args.title.clone())
            .with_inner_size(LogicalSize::new(640.0, 360.0))
            // Поверх других окон: методы, читающие экран, а не окно, должны видеть вспышку.
            .with_window_level(WindowLevel::AlwaysOnTop);
        let window = match event_loop.create_window(attrs) {
            Ok(w) => Rc::new(w),
            Err(e) => {
                self.error = Some(format!("окно не создано: {e}"));
                event_loop.exit();
                return;
            }
        };
        let surface = softbuffer::Context::new(window.clone())
            .and_then(|ctx| softbuffer::Surface::new(&ctx, window.clone()));
        match surface {
            Ok(s) => self.surface = Some(s),
            Err(e) => {
                self.error = Some(format!("поверхность окна не создана: {e}"));
                event_loop.exit();
                return;
            }
        }
        self.window = Some(window);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::RedrawRequested => {
                if let Err(e) = self.draw() {
                    self.error = Some(format!("отрисовка: {e}"));
                    event_loop.exit();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let now = Instant::now();
        if now >= self.deadline {
            event_loop.exit();
            return;
        }
        if now.duration_since(self.last_stop_check) > Duration::from_millis(200) {
            self.last_stop_check = now;
            if stop_requested(&self.args) {
                event_loop.exit();
                return;
            }
            // Журналы сбрасываются на диск каждые 0,2 с: программа захвата копирует их
            // сразу после записи сценария.
            let _ = self.frames.flush();
            let _ = self.marks.flush();
            self.handle_child_commands();
            self.handle_fps_command();
            self.handle_compensate_command();
        }
        self.drain_click_marks();
        let now_mono = now_ns();
        if now_mono >= self.next_mark_ns {
            // Вспышка и щелчок запрашиваются в один момент. С выравниванием вспышка
            // откладывается на задержку вывода звука — так делает программа, которая
            // сама следит за совпадением звука и картинки.
            self.next_mark_ns += MARK_PERIOD_MS * 1_000_000;
            let delay = if self.compensate {
                self.playback_delay_ns
            } else {
                0
            };
            self.flash_from_ns = now_mono + delay;
            self.flash_until_ns = self.flash_from_ns + FLASH_MS * 1_000_000;
            self.flash_logged = false;
            self.click_requests.fetch_add(1, Ordering::Relaxed);
            let _ = self.marks.flush();
            let _ = self.frames.flush();
        }
        if now >= self.next_frame {
            self.next_frame += self.frame_period;
            if self.next_frame < now {
                self.next_frame = now + self.frame_period;
            }
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_frame));
    }
}

fn spawn_child(args: &Args) -> Res<Child> {
    let mut cmd = Command::new(std::env::current_exe()?);
    cmd.arg("--role")
        .arg("child")
        .arg("--out")
        .arg(&args.out)
        .arg("--duration")
        .arg(args.duration.to_string());
    if let Some(host) = &args.audio_host {
        cmd.arg("--audio-host").arg(host);
    }
    if args.silent {
        cmd.arg("--silent");
    }
    Ok(cmd.spawn()?)
}

fn run_parent(args: Args) -> Res<()> {
    let mut marks = BufWriter::new(File::create(args.out.join("source-marks.tsv"))?);
    writeln!(marks, "kind\tt_ns\taux_ns")?;
    let mut frames = BufWriter::new(File::create(args.out.join("source-frames.tsv"))?);
    writeln!(frames, "t_ns\tframe")?;
    let click_requests = Arc::new(AtomicU64::new(0));
    let (tx, rx) = channel();
    let player = tone::play(
        TONE_PARENT_HZ,
        Some(ClickCtl {
            requests: click_requests.clone(),
            marks: tx,
        }),
        args.audio_host.as_deref(),
    )?;
    let child = if args.no_child || args.child_on_file {
        None
    } else {
        Some(spawn_child(&args)?)
    };
    write_info(&args, &player, child.as_ref().map(Child::id))?;

    let event_loop = EventLoop::new()?;
    let mut app = App {
        deadline: Instant::now() + Duration::from_secs(args.duration),
        args,
        window: None,
        surface: None,
        marks,
        frames,
        frame_period: Duration::from_micros(16_667),
        click_requests,
        click_marks: rx,
        next_frame: Instant::now(),
        next_mark_ns: now_ns() + 1_000_000_000,
        flash_from_ns: 0,
        flash_until_ns: 0,
        compensate: false,
        playback_delay_ns: 0,
        flash_logged: true,
        last_stop_check: Instant::now(),
        frame_no: 0,
        error: None,
        player,
        child,
    };
    let run = event_loop.run_app(&mut app);
    app.drain_click_marks();
    let _ = app.marks.flush();
    let _ = app.frames.flush();
    if let Some(child) = app.child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    run?;
    match app.error.take() {
        Some(e) => Err(e.into()),
        None => Ok(()),
    }
}

fn main() {
    let args = Args::parse();
    if let Err(e) = fs::create_dir_all(&args.out) {
        eprintln!("s5src: каталог прогона не создан: {e}");
        std::process::exit(2);
    }
    // Источник запускается без консоли: причина отказа остаётся в файле каталога прогона.
    let error_file = args.out.join(format!("source-{}.err", args.role));
    let _ = fs::remove_file(&error_file);
    // Паника (например, оконная библиотека не нашла системную библиотеку) тоже должна
    // оставить причину в файле: программа захвата по нему останавливает прогон. Место
    // паники в файл не идёт — в нём путь с домашним каталогом.
    let panic_file = error_file.clone();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let text = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "причина не текстовая".to_owned());
        let _ = fs::write(&panic_file, format!("паника: {text}"));
        default_hook(info);
    }));
    tone::set_silent(args.silent);
    let result = match args.role.as_str() {
        "parent" => run_parent(args),
        "child" => run_headless(&args, TONE_CHILD_HZ),
        "foreign" => run_headless(&args, TONE_FOREIGN_HZ),
        other => Err(format!("неизвестная роль: {other}").into()),
    };
    if let Err(e) = result {
        eprintln!("s5src: {e}");
        let _ = fs::write(&error_file, e.to_string());
        std::process::exit(1);
    }
}
