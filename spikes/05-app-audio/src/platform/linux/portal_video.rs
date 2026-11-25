// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Linux: видео через портал ScreenCast и PipeWire.
//!
//! Источник выбирает пользователь в системном окне; приложение получает от портала
//! только номер узла PipeWire и размер, без заголовка окна и без PID. Портал умеет
//! запоминать выбор: полученный знак восстановления сохраняется в каталоге сеанса,
//! и следующий запуск обходится без системного окна, если портал это поддерживает.

use std::future::Future;
use std::os::fd::OwnedFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ashpd::desktop::inhibit::{InhibitFlags, InhibitOptions, InhibitProxy};
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use ashpd::desktop::PersistMode;
use pipewire as pw;
use pw::spa;

use crate::clock::now_ns;
use crate::model::Res;
use crate::rec::{luma_bgra, luma_rgba, VideoSink};

struct ThreadWaker(std::thread::Thread);

impl Wake for ThreadWaker {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

/// Дождаться результата асинхронной операции в текущем потоке.
pub fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(ThreadWaker(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(value) => return value,
            Poll::Pending => std::thread::park(),
        }
    }
}

fn token_file() -> PathBuf {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    dir.join("s5-portal-restore-token")
}

/// Попросить систему не гасить экран, пока жив возвращённый поток.
///
/// Запрет держится, пока открыто соединение с порталом, поэтому поток спит до флага.
pub fn inhibit_idle(stop: Arc<AtomicBool>) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("s5-inhibit".to_owned())
        .spawn(move || {
            let held = block_on(async {
                let proxy = InhibitProxy::new().await?;
                let request = proxy
                    .inhibit(
                        None,
                        InhibitFlags::IDLE,
                        InhibitOptions::default().set_reason("идёт замер захвата экрана"),
                    )
                    .await?;
                Ok::<_, ashpd::Error>((proxy, request))
            });
            if let Err(e) = &held {
                eprintln!("s5cap: запрет гашения экрана не получен: {e}");
            }
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(200));
            }
            drop(held);
        })
        .ok()
}

/// Что портал ScreenCast объявляет о себе в этом сеансе: версия интерфейса, виды
/// источников и режимы курсора. Сеанс захвата не создаётся и окно выбора не
/// показывается — это ответ на вопрос «есть ли портал в сеансе», а не «отдаёт ли он кадры».
pub fn probe() -> String {
    let outcome = block_on(async {
        let proxy = Screencast::new().await?;
        let sources = proxy.available_source_types().await?;
        let cursors = proxy.available_cursor_modes().await?;
        Ok::<_, ashpd::Error>((proxy.version(), sources, cursors))
    });
    match outcome {
        Ok((version, sources, cursors)) => {
            let mut kinds = Vec::new();
            if sources.contains(SourceType::MONITOR) {
                kinds.push("монитор");
            }
            if sources.contains(SourceType::WINDOW) {
                kinds.push("окно");
            }
            if sources.contains(SourceType::VIRTUAL) {
                kinds.push("виртуальный");
            }
            let mut modes = Vec::new();
            if cursors.contains(CursorMode::HIDDEN) {
                modes.push("скрыт");
            }
            if cursors.contains(CursorMode::EMBEDDED) {
                modes.push("в кадре");
            }
            if cursors.contains(CursorMode::METADATA) {
                modes.push("отдельно");
            }
            format!(
                "версия {version}; источники: {}; курсор: {}",
                if kinds.is_empty() {
                    "нет".to_owned()
                } else {
                    kinds.join(", ")
                },
                if modes.is_empty() {
                    "нет".to_owned()
                } else {
                    modes.join(", ")
                }
            )
        }
        Err(e) => format!("недоступен: {e}"),
    }
}

struct PortalStream {
    node_id: u32,
    fd: OwnedFd,
    size: Option<(i32, i32)>,
    source: String,
    restored: bool,
}

/// Переговоры с порталом: выбор источника и доступ к PipeWire.
fn open_portal(notes: &Arc<Mutex<Vec<String>>>) -> Res<(PortalStream, Box<dyn FnOnce() + Send>)> {
    let saved = std::fs::read_to_string(token_file()).ok();
    let saved = saved.as_deref().map(str::trim).filter(|t| !t.is_empty());
    let started = Instant::now();
    let outcome = block_on(async {
        let proxy = Screencast::new().await?;
        // Портал отклоняет запрос с видом источника, которого его бэкенд не умеет:
        // просим только то, что он сам объявил доступным.
        let available = proxy
            .available_source_types()
            .await
            .unwrap_or(SourceType::MONITOR);
        let mut wanted = (SourceType::WINDOW | SourceType::MONITOR) & available;
        if wanted.is_empty() {
            wanted = SourceType::MONITOR;
        }
        let cursors = proxy
            .available_cursor_modes()
            .await
            .unwrap_or(CursorMode::HIDDEN);
        let cursor = if cursors.contains(CursorMode::HIDDEN) {
            CursorMode::HIDDEN
        } else {
            CursorMode::EMBEDDED
        };
        let version = proxy.version();
        let session = proxy.create_session(Default::default()).await?;
        let mut options = SelectSourcesOptions::default()
            .set_cursor_mode(cursor)
            .set_sources(wanted)
            .set_multiple(false);
        // Запоминание выбора появилось в четвёртой версии интерфейса портала.
        if version >= 4 {
            options = options
                .set_persist_mode(PersistMode::ExplicitlyRevoked)
                .set_restore_token(saved);
        }
        proxy.select_sources(&session, options).await?;
        let response = proxy
            .start(&session, None, Default::default())
            .await?
            .response()?;
        let stream = response
            .streams()
            .first()
            .cloned()
            .ok_or_else(|| ashpd::Error::NoResponse)?;
        let token = response.restore_token().map(str::to_owned);
        let fd = proxy
            .open_pipe_wire_remote(&session, Default::default())
            .await?;
        let offered = format!(
            "версия интерфейса портала {version}; доступно: окно — {}, монитор — {}",
            available.contains(SourceType::WINDOW),
            available.contains(SourceType::MONITOR)
        );
        Ok::<_, ashpd::Error>((proxy, session, stream, token, fd, offered))
    });
    let (proxy, session, stream, token, fd, offered) =
        outcome.map_err(|e| format!("портал ScreenCast: {e}"))?;
    let waited = started.elapsed();
    if let Some(token) = &token {
        let _ = std::fs::write(token_file(), token);
    }
    let source = match stream.source_type() {
        Some(t) if t.contains(SourceType::WINDOW) => "окно",
        Some(t) if t.contains(SourceType::MONITOR) => "монитор",
        Some(_) => "другое",
        None => "портал не сообщил",
    };
    if let Ok(mut n) = notes.lock() {
        n.push(format!("портал: {offered}"));
        n.push(format!(
            "портал: источник — {source}, размер {:?}, выбор занял {:.1} с, знак восстановления был: {}, получен: {}",
            stream.size(),
            waited.as_secs_f64(),
            saved.is_some(),
            token.is_some()
        ));
        n.push(
            "портал отдаёт номер узла PipeWire, размер и вид источника; PID и заголовка окна в ответе нет"
                .to_owned(),
        );
    }
    let closer = Box::new(move || {
        let _ = block_on(session.close());
        drop(proxy);
    });
    Ok((
        PortalStream {
            node_id: stream.pipe_wire_node_id(),
            fd,
            size: stream.size(),
            source: source.to_owned(),
            // Системное окно пользователь не успеет пройти быстрее секунды.
            restored: saved.is_some() && waited < Duration::from_secs(1),
        },
        closer,
    ))
}

#[derive(Default)]
struct VideoFormat {
    width: u32,
    height: u32,
    /// Порядок каналов: true — синий первым (BGRx, BGRA, BGR), false — красный первым.
    bgr: bool,
    /// Байт на пиксель: 4 или 3.
    bytes_per_pixel: usize,
}

fn serialize(object: spa::pod::Object) -> Res<Vec<u8>> {
    Ok(spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .map_err(|e| format!("параметр не собран: {e:?}"))?
    .0
    .into_inner())
}

/// Поток PipeWire: чтение кадров узла, выданного порталом.
fn video_thread(
    fps: u32,
    sink: Arc<VideoSink>,
    stop: Arc<AtomicBool>,
    ready: Sender<Result<(), String>>,
    notes: Arc<Mutex<Vec<String>>>,
) -> Res<()> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    // Источник кадров: узел, выданный порталом, либо (для отладки без портала) узел
    // общего сервера PipeWire, номер которого задан переменной S5_PW_VIDEO_NODE.
    let debug_node = std::env::var("S5_PW_VIDEO_NODE")
        .ok()
        .and_then(|v| v.parse::<u32>().ok());
    type Closer = Option<Box<dyn FnOnce() + Send>>;
    let (core, node_id, method, described, close_session): (_, u32, &'static str, String, Closer) =
        match debug_node {
            Some(node) => {
                if let Ok(mut n) = notes.lock() {
                    n.push(format!(
                        "видео берётся из узла PipeWire {node} без портала (отладочный режим)"
                    ));
                }
                (
                    context.connect_rc(None)?,
                    node,
                    "pipewire-node",
                    format!("узел {node}"),
                    None,
                )
            }
            None => {
                let (portal, close) = open_portal(&notes)?;
                let method = if portal.restored {
                    "portal(restored)"
                } else {
                    "portal"
                };
                let described = format!("{} {:?}", portal.source, portal.size);
                (
                    context.connect_fd_rc(portal.fd, None)?,
                    portal.node_id,
                    method,
                    described,
                    Some(close),
                )
            }
        };
    let stream = pw::stream::StreamRc::new(
        core,
        "s5cap-video",
        pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )?;
    let frames = Arc::new(AtomicU64::new(0));
    let with_pts = Arc::new(AtomicU64::new(0));
    let without_pixels = Arc::new(AtomicU64::new(0));
    let (count, count_pts, count_blind) =
        (frames.clone(), with_pts.clone(), without_pixels.clone());
    let format_notes = notes.clone();
    let state_notes = notes.clone();
    let _listener = stream
        .add_local_listener_with_user_data(VideoFormat::default())
        .state_changed(move |_, _, _old, new| {
            if let pw::stream::StreamState::Error(text) = new {
                if let Ok(mut n) = state_notes.lock() {
                    n.push(format!("поток видео в состоянии ошибки: {text}"));
                }
            }
        })
        .param_changed(move |stream, format, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let mut info = spa::param::video::VideoInfoRaw::new();
            if info.parse(param).is_err() {
                return;
            }
            format.width = info.size().width;
            format.height = info.size().height;
            format.bgr = matches!(
                info.format(),
                spa::param::video::VideoFormat::BGRx
                    | spa::param::video::VideoFormat::BGRA
                    | spa::param::video::VideoFormat::BGR
            );
            format.bytes_per_pixel = match info.format() {
                spa::param::video::VideoFormat::RGB | spa::param::video::VideoFormat::BGR => 3,
                _ => 4,
            };
            // Просим источник прикладывать к кадрам заголовок с меткой времени.
            let meta = spa::pod::Object {
                type_: spa::utils::SpaTypes::ObjectParamMeta.as_raw(),
                id: spa::param::ParamType::Meta.as_raw(),
                properties: vec![
                    spa::pod::Property {
                        key: spa::sys::SPA_PARAM_META_type,
                        flags: spa::pod::PropertyFlags::empty(),
                        value: spa::pod::Value::Id(spa::utils::Id(spa::sys::SPA_META_Header)),
                    },
                    spa::pod::Property {
                        key: spa::sys::SPA_PARAM_META_size,
                        flags: spa::pod::PropertyFlags::empty(),
                        value: spa::pod::Value::Int(
                            std::mem::size_of::<spa::sys::spa_meta_header>() as i32,
                        ),
                    },
                ],
            };
            if let Ok(bytes) = serialize(meta) {
                if let Some(pod) = spa::pod::Pod::from_bytes(&bytes) {
                    let _ = stream.update_params(&mut [pod]);
                }
            }
            if let Ok(mut n) = format_notes.lock() {
                n.push(format!(
                    "формат видео: {:?}, {}×{}, частота {}/{}",
                    info.format(),
                    format.width,
                    format.height,
                    info.framerate().num,
                    info.framerate().denom
                ));
            }
        })
        .process(move |stream, format| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let arrival = now_ns();
            // Метка кадра от источника (CLOCK_MONOTONIC), если она есть.
            let pts = buffer
                .find_meta::<spa::buffer::meta::MetaHeader>()
                .map(|h| h.pts())
                .filter(|p| *p > 0);
            let t_ns = match pts {
                Some(p) => {
                    count_pts.fetch_add(1, Ordering::Relaxed);
                    p as u64
                }
                None => arrival,
            };
            let mut luma = -1;
            if let Some(data) = buffer.datas_mut().first_mut() {
                let stride = data.chunk().stride().max(0) as usize;
                let (w, h) = (format.width as usize, format.height as usize);
                let (bgr, bpp) = (format.bgr, format.bytes_per_pixel.max(3));
                if let Some(bytes) = data.data() {
                    let at = (h / 2) * stride + (w / 2) * bpp;
                    if let Some(px) = bytes.get(at..at + bpp) {
                        luma = if bgr { luma_bgra(px) } else { luma_rgba(px) };
                    }
                }
            }
            if luma < 0 {
                count_blind.fetch_add(1, Ordering::Relaxed);
            }
            sink.frame(t_ns, format.width, format.height, luma, method);
            count.fetch_add(1, Ordering::Relaxed);
        })
        .register()?;

    let object = spa::pod::object!(
        spa::utils::SpaTypes::ObjectParamFormat,
        spa::param::ParamType::EnumFormat,
        spa::pod::property!(
            spa::param::format::FormatProperties::MediaType,
            Id,
            spa::param::format::MediaType::Video
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::MediaSubtype,
            Id,
            spa::param::format::MediaSubtype::Raw
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            spa::param::video::VideoFormat::BGRx,
            spa::param::video::VideoFormat::BGRx,
            spa::param::video::VideoFormat::BGRA,
            spa::param::video::VideoFormat::RGBx,
            spa::param::video::VideoFormat::RGBA,
            spa::param::video::VideoFormat::RGB,
            spa::param::video::VideoFormat::BGR,
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            spa::utils::Rectangle {
                width: 1280,
                height: 720
            },
            spa::utils::Rectangle {
                width: 1,
                height: 1
            },
            spa::utils::Rectangle {
                width: 8192,
                height: 8192
            }
        ),
        spa::pod::property!(
            spa::param::format::FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            spa::utils::Fraction {
                num: fps.max(1),
                denom: 1
            },
            spa::utils::Fraction { num: 0, denom: 1 },
            spa::utils::Fraction { num: 240, denom: 1 }
        ),
    );
    let format_bytes = serialize(object)?;
    let format_pod =
        spa::pod::Pod::from_bytes(&format_bytes).ok_or("параметр формата не разобран")?;
    stream.connect(
        spa::utils::Direction::Input,
        Some(node_id),
        pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
        &mut [format_pod],
    )?;

    // Метод считается запущенным после первого кадра; дальше таймер следит за флагом остановки.
    let timer_loop = mainloop.clone();
    let timer_frames = frames.clone();
    let started = Instant::now();
    let ready = Mutex::new(Some(ready));
    let timer = mainloop.loop_().add_timer(move |_| {
        if let Ok(mut slot) = ready.lock() {
            if slot.is_some() {
                if timer_frames.load(Ordering::Relaxed) > 0 {
                    if let Some(r) = slot.take() {
                        let _ = r.send(Ok(()));
                    }
                } else if started.elapsed() > Duration::from_secs(5) {
                    if let Some(r) = slot.take() {
                        let _ = r.send(Err(
                            "за 5 с после выбора источника не пришло ни одного кадра".to_owned(),
                        ));
                    }
                    timer_loop.quit();
                }
            }
        }
        if stop.load(Ordering::Relaxed) {
            timer_loop.quit();
        }
    });
    let _ = timer.update_timer(
        Some(Duration::from_millis(50)),
        Some(Duration::from_millis(50)),
    );
    mainloop.run();
    let _ = stream.disconnect();
    if let Ok(mut n) = notes.lock() {
        n.push(format!(
            "источник видео — {described}; кадров {}, из них с меткой времени от источника {}, без доступа к пикселям {}",
            frames.load(Ordering::Relaxed),
            with_pts.load(Ordering::Relaxed),
            without_pixels.load(Ordering::Relaxed)
        ));
    }
    if let Some(close) = close_session {
        close();
    }
    Ok(())
}

/// Работающий захват видео.
pub struct VideoCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl VideoCapture {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Запустить захват. Ждёт, пока пользователь выберет источник в системном окне (до 2 минут).
pub fn start(
    fps: u32,
    sink: Arc<VideoSink>,
    notes: Arc<Mutex<Vec<String>>>,
) -> Result<VideoCapture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = channel();
    let thread_stop = stop.clone();
    let thread = std::thread::Builder::new()
        .name("s5-video-portal".to_owned())
        .spawn(move || {
            let fallback = tx.clone();
            if let Err(e) = video_thread(fps, sink, thread_stop, tx, notes) {
                let _ = fallback.send(Err(e.to_string()));
            }
        })
        .map_err(|e| format!("поток видео не создан: {e}"))?;
    let mut capture = VideoCapture {
        stop,
        thread: Some(thread),
    };
    match rx.recv_timeout(Duration::from_secs(125)) {
        Ok(Ok(())) => Ok(capture),
        Ok(Err(e)) => {
            capture.stop();
            Err(e)
        }
        Err(_) => {
            // Поток может ждать ответа портала: не присоединяемся, чтобы не зависнуть.
            capture.stop.store(true, Ordering::Relaxed);
            capture.thread.take();
            Err("источник не выбран в системном окне за 2 минуты".to_owned())
        }
    }
}
