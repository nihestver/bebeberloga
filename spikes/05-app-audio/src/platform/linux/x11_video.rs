// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Linux, сеанс X11: захват видео без портала.
//!
//! Окно — через расширение Composite: содержимое окна X-сервер держит во внеэкранной
//! картинке, и она читается, даже когда окно перекрыто. Экран — чтением корневого окна.
//! Пиксели в обоих случаях забираются через разделяемую память (расширение MIT-SHM);
//! если сервер её не принял — обычным запросом картинки.
//!
//! У X11 нет события «пришёл кадр»: захват сам опрашивает сервер с заданной частотой,
//! как метод GDI на Windows. Метка кадра — момент перед запросом картинки.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use x11rb::connection::Connection;
use x11rb::protocol::composite::{ConnectionExt as _, Redirect};
use x11rb::protocol::shm::{ConnectionExt as _, Seg};
use x11rb::protocol::xproto::{
    ClientMessageEvent, ConfigureWindowAux, ConnectionExt as _, CreateWindowAux, Drawable,
    EventMask, ImageFormat, ImageOrder, MapState, Pixmap, StackMode, Window, WindowClass,
};
use x11rb::rust_connection::RustConnection;
use x11rb::{COPY_DEPTH_FROM_PARENT, COPY_FROM_PARENT};

use crate::clock::now_ns;
use crate::model::{Res, WindowInfo};
use crate::rec::{luma_bgra, VideoSink};

/// Чем снимать.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum X11Method {
    /// Содержимое окна через Composite: видно и под другими окнами.
    Composite,
    /// Весь экран: корневое окно, как его показывает X-сервер.
    Screen,
}

impl X11Method {
    pub fn name(self) -> &'static str {
        match self {
            X11Method::Composite => "x11-composite",
            X11Method::Screen => "x11-screen",
        }
    }
}

/// Сегмент разделяемой памяти System V, подключённый и к программе, и к X-серверу.
struct ShmSegment {
    seg: Seg,
    ptr: *mut u8,
    size: usize,
}

impl ShmSegment {
    fn create(conn: &RustConnection, size: usize) -> Res<Self> {
        // SAFETY: обычные вызовы System V shm; результат каждого проверяется.
        let (id, ptr) = unsafe {
            let id = libc::shmget(libc::IPC_PRIVATE, size, libc::IPC_CREAT | 0o600);
            if id < 0 {
                return Err("shmget не выделил сегмент".into());
            }
            let ptr = libc::shmat(id, std::ptr::null(), 0);
            if ptr as isize == -1 {
                libc::shmctl(id, libc::IPC_RMID, std::ptr::null_mut());
                return Err("shmat не подключил сегмент".into());
            }
            (id, ptr.cast::<u8>())
        };
        let seg = conn.generate_id()?;
        let attached = conn
            .shm_attach(seg, id as u32, false)
            .map_err(|e| e.to_string())
            .and_then(|c| c.check().map_err(|e| format!("{e:?}")));
        // Сегмент помечается к удалению сразу: он исчезнет, когда отключатся оба.
        // SAFETY: идентификатор получен выше от shmget.
        unsafe {
            libc::shmctl(id, libc::IPC_RMID, std::ptr::null_mut());
        }
        if let Err(e) = attached {
            // SAFETY: указатель получен от shmat выше.
            unsafe {
                libc::shmdt(ptr.cast());
            }
            return Err(format!("сервер не подключил сегмент: {e}").into());
        }
        Ok(Self { seg, ptr, size })
    }

    /// Четыре байта по смещению `offset`, если они внутри сегмента.
    fn pixel(&self, offset: usize) -> Option<[u8; 4]> {
        if offset.checked_add(4)? > self.size {
            return None;
        }
        let mut px = [0u8; 4];
        // SAFETY: смещение проверено выше; сегмент жив, пока жив `self`.
        unsafe {
            std::ptr::copy_nonoverlapping(self.ptr.add(offset), px.as_mut_ptr(), 4);
        }
        Some(px)
    }
}

impl Drop for ShmSegment {
    fn drop(&mut self) {
        // SAFETY: указатель получен от shmat и больше не используется.
        unsafe {
            libc::shmdt(self.ptr.cast());
        }
    }
}

/// Соединение с X-сервером и всё, что нужно для чтения картинок.
struct Grabber {
    conn: RustConnection,
    root: Window,
    screen_size: (u16, u16),
    lsb_first: bool,
    /// (глубина, бит на точку, выравнивание строки в битах) по данным сервера.
    formats: Vec<(u8, u8, u8)>,
    shm: Option<ShmSegment>,
    /// Картинка содержимого окна, полученная от Composite в прошлом кадре.
    pixmap: Option<Pixmap>,
}

impl Grabber {
    fn open() -> Res<(Self, Vec<String>)> {
        let (conn, screen_num) = x11rb::connect(None)?;
        let setup = conn.setup();
        let screen = setup
            .roots
            .get(screen_num)
            .ok_or("X-сервер не сообщил экран")?;
        let root = screen.root;
        let screen_size = (screen.width_in_pixels, screen.height_in_pixels);
        let lsb_first = setup.image_byte_order == ImageOrder::LSB_FIRST;
        let formats = setup
            .pixmap_formats
            .iter()
            .map(|f| (f.depth, f.bits_per_pixel, f.scanline_pad))
            .collect();
        let mut notes = Vec::new();
        // Сегмент — под целый экран в 32 бита на точку: хватит и на окно, и на экран.
        let size = screen_size.0 as usize * screen_size.1 as usize * 4;
        let shm = match conn
            .shm_query_version()
            .map_err(|e| e.to_string())
            .and_then(|c| c.reply().map_err(|e| format!("{e:?}")))
        {
            Ok(_) => match ShmSegment::create(&conn, size.max(4096)) {
                Ok(seg) => {
                    notes.push("пиксели — через разделяемую память (MIT-SHM)".to_owned());
                    Some(seg)
                }
                Err(e) => {
                    notes.push(format!(
                        "разделяемая память недоступна ({e}); пиксели — обычным запросом"
                    ));
                    None
                }
            },
            Err(e) => {
                notes.push(format!(
                    "расширения MIT-SHM нет ({e}); пиксели — обычным запросом"
                ));
                None
            }
        };
        Ok((
            Self {
                conn,
                root,
                screen_size,
                lsb_first,
                formats,
                shm,
                pixmap: None,
            },
            notes,
        ))
    }

    /// Яркость точки (px, py) картинки `drawable` размером w×h.
    fn luma(&self, drawable: Drawable, w: u16, h: u16, px: u32, py: u32) -> Res<i32> {
        let px = px.min(w.saturating_sub(1) as u32) as usize;
        let py = py.min(h.saturating_sub(1) as u32) as usize;
        let locate = |depth: u8| -> Res<usize> {
            let (_, bpp, pad) = self
                .formats
                .iter()
                .copied()
                .find(|f| f.0 == depth)
                .ok_or_else(|| format!("сервер не описал формат глубины {depth}"))?;
            if bpp != 32 {
                return Err(format!("{bpp} бит на точку спайк не разбирает").into());
            }
            let pad = pad.max(8) as usize;
            let stride = (w as usize * bpp as usize).div_ceil(pad) * pad / 8;
            Ok(py * stride + px * 4)
        };
        let bytes: [u8; 4] = match &self.shm {
            Some(shm) => {
                let reply = self
                    .conn
                    .shm_get_image(
                        drawable,
                        0,
                        0,
                        w,
                        h,
                        !0,
                        ImageFormat::Z_PIXMAP.into(),
                        shm.seg,
                        0,
                    )?
                    .reply()
                    .map_err(|e| format!("{e:?}"))?;
                shm.pixel(locate(reply.depth)?)
                    .ok_or("картинка не поместилась в сегмент")?
            }
            None => {
                let reply = self
                    .conn
                    .get_image(ImageFormat::Z_PIXMAP, drawable, 0, 0, w, h, !0)?
                    .reply()
                    .map_err(|e| format!("{e:?}"))?;
                let at = locate(reply.depth)?;
                let slice = reply
                    .data
                    .get(at..at + 4)
                    .ok_or("картинка короче ожидаемой")?;
                [slice[0], slice[1], slice[2], slice[3]]
            }
        };
        // Порядок байтов точки задаёт сервер: младший первым — B, G, R, заполнитель.
        let bgra = if self.lsb_first {
            bytes
        } else {
            [bytes[3], bytes[2], bytes[1], bytes[0]]
        };
        Ok(luma_bgra(&bgra))
    }

    /// Кадр окна через Composite: (ширина, высота, яркость центра).
    ///
    /// Картинка содержимого запрашивается заново на каждый кадр: после изменения
    /// размера, сворачивания и разворачивания сервер заводит новую, а старая остаётся
    /// с прежним содержимым и ошибки не даёт.
    fn window_frame(&mut self, window: Window) -> Res<(u32, u32, i32)> {
        if let Some(old) = self.pixmap.take() {
            let _ = self.conn.free_pixmap(old);
        }
        let geometry = self
            .conn
            .get_geometry(window)?
            .reply()
            .map_err(|e| format!("размер окна не получен: {e:?}"))?;
        let (w, h) = (geometry.width, geometry.height);
        let pixmap = self.conn.generate_id()?;
        self.conn
            .composite_name_window_pixmap(window, pixmap)?
            .check()
            .map_err(|e| format!("сервер не дал картинку окна: {e:?}"))?;
        self.pixmap = Some(pixmap);
        let luma = self.luma(pixmap, w, h, w as u32 / 2, h as u32 / 2)?;
        Ok((w as u32, h as u32, luma))
    }

    /// Кадр всего экрана: (ширина, высота, яркость в центре окна-источника).
    fn screen_frame(&mut self, window: Window) -> Res<(u32, u32, i32)> {
        let (sw, sh) = self.screen_size;
        // Где сейчас центр окна на экране: окно могли подвинуть или изменить.
        let centre = self
            .conn
            .get_geometry(window)?
            .reply()
            .ok()
            .and_then(|g| {
                self.conn
                    .translate_coordinates(
                        window,
                        self.root,
                        (g.width / 2) as i16,
                        (g.height / 2) as i16,
                    )
                    .ok()?
                    .reply()
                    .ok()
            })
            .map(|t| (t.dst_x.max(0) as u32, t.dst_y.max(0) as u32))
            .unwrap_or((sw as u32 / 2, sh as u32 / 2));
        let luma = self.luma(self.root, sw, sh, centre.0, centre.1)?;
        Ok((sw as u32, sh as u32, luma))
    }
}

type Ready = Sender<Result<Vec<String>, String>>;

/// Остановка работающего захвата.
pub type Stopper = Box<dyn FnOnce() + Send>;

fn run(
    method: X11Method,
    window: Window,
    fps: u32,
    sink: Arc<VideoSink>,
    live_notes: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    ready: Ready,
) {
    let name = method.name();
    let (mut grabber, mut notes) = match Grabber::open() {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(format!("нет соединения с X-сервером: {e}")));
            return;
        }
    };
    if method == X11Method::Composite {
        let redirected = grabber
            .conn
            .composite_query_version(0, 4)
            .map_err(|e| e.to_string())
            .and_then(|c| c.reply().map_err(|e| format!("{e:?}")))
            .and_then(|v| {
                notes.push(format!(
                    "расширение Composite {}.{}",
                    v.major_version, v.minor_version
                ));
                // Автоматическое перенаправление: сервер сам рисует окно на экран,
                // а его содержимое остаётся доступным и под другими окнами. Работает
                // и рядом с оконным менеджером, который сам составляет картинку.
                grabber
                    .conn
                    .composite_redirect_window(window, Redirect::AUTOMATIC)
                    .map_err(|e| e.to_string())?
                    .check()
                    .map_err(|e| format!("{e:?}"))
            });
        if let Err(e) = redirected {
            let _ = ready.send(Err(format!("Composite недоступен: {e}")));
            return;
        }
    } else {
        notes.push(format!(
            "снимается весь экран {}×{}; яркость — в центре окна источника",
            grabber.screen_size.0, grabber.screen_size.1
        ));
    }
    notes.push(format!(
        "сервер опрашивается {fps} раз в секунду; метка кадра — момент запроса"
    ));

    let note = |text: String| {
        if let Ok(mut list) = live_notes.lock() {
            if list.len() < 40 {
                list.push(format!("{name}: {text}"));
            }
        }
    };
    let period = Duration::from_micros(1_000_000 / fps.max(1) as u64);
    let started = Instant::now();
    let mut next = started;
    let mut ready = Some(ready);
    let mut frames = 0u64;
    let mut failed_run = 0u64;
    let mut size = (0u32, 0u32);
    let mut first_error: Option<String> = None;
    while !stop.load(Ordering::Relaxed) {
        let t_ns = now_ns();
        let frame = match method {
            X11Method::Composite => grabber.window_frame(window),
            X11Method::Screen => grabber.screen_frame(window),
        };
        match frame {
            Ok((w, h, luma)) => {
                if failed_run > 0 {
                    note(format!(
                        "кадры вернулись на {:.1}-й секунде после {failed_run} неудачных запросов",
                        started.elapsed().as_secs_f64()
                    ));
                    failed_run = 0;
                }
                if frames > 0 && (w, h) != size {
                    note(format!(
                        "размер кадра изменился на {:.1}-й секунде: {}×{} → {w}×{h}",
                        started.elapsed().as_secs_f64(),
                        size.0,
                        size.1
                    ));
                }
                size = (w, h);
                sink.frame(t_ns, w, h, luma, name);
                frames += 1;
                if let Some(tx) = ready.take() {
                    let _ = tx.send(Ok(std::mem::take(&mut notes)));
                }
            }
            Err(e) => {
                if failed_run == 0 && frames > 0 {
                    note(format!(
                        "кадр не получен на {:.1}-й секунде: {e}",
                        started.elapsed().as_secs_f64()
                    ));
                }
                failed_run += 1;
                first_error.get_or_insert_with(|| e.to_string());
                // Метод считается запущенным только после первого кадра.
                if frames == 0 && started.elapsed() > Duration::from_secs(3) {
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(Err(format!(
                            "за 3 с не получено ни одного кадра: {}",
                            first_error.clone().unwrap_or_default()
                        )));
                    }
                    break;
                }
            }
        }
        next += period;
        let now = Instant::now();
        if next > now {
            std::thread::sleep(next - now);
        } else if now - next > period * 4 {
            // Запрос занял больше нескольких периодов: не догонять очередью кадров.
            next = now;
        }
    }
    if method == X11Method::Composite {
        let _ = grabber
            .conn
            .composite_unredirect_window(window, Redirect::AUTOMATIC);
        let _ = grabber.conn.flush();
    }
}

/// Запустить захват. Возвращает функцию остановки и замечания о запуске.
pub fn start(
    method: X11Method,
    window: &WindowInfo,
    fps: u32,
    sink: Arc<VideoSink>,
    live_notes: Arc<Mutex<Vec<String>>>,
) -> Result<(Stopper, Vec<String>), String> {
    let window = window.id as Window;
    sink.set_scale(1.0);
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = channel();
    let thread_stop = stop.clone();
    let thread: JoinHandle<()> = std::thread::Builder::new()
        .name(format!("s5-video-{}", method.name()))
        .spawn(move || run(method, window, fps, sink, live_notes, thread_stop, tx))
        .map_err(|e| format!("поток видео не создан: {e}"))?;
    match rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(notes)) => Ok((
            Box::new(move || {
                stop.store(true, Ordering::Relaxed);
                let _ = thread.join();
            }),
            notes,
        )),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err("метод не ответил за 8 с".to_owned())
        }
    }
}

/// Что X-сервер говорит об окне через треть секунды после просьбы оконному менеджеру:
/// просьбу тот выполняет не сразу и может не выполнить вовсе.
fn map_state(conn: &RustConnection, window: Window) -> String {
    std::thread::sleep(Duration::from_millis(300));
    let state = conn
        .get_window_attributes(window)
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|a| a.map_state);
    match state {
        Some(MapState::VIEWABLE) => "по данным сервера окно показано".to_owned(),
        Some(MapState::UNMAPPED) => "по данным сервера окно скрыто".to_owned(),
        Some(MapState::UNVIEWABLE) => "по данным сервера окно скрыто вместе с рамкой".to_owned(),
        _ => "состояние окна сервер не сообщил".to_owned(),
    }
}

/// Состояние действий над окном между «включить» и «выключить».
struct ActionState {
    /// Окно-заслонка и соединение, которое его держит.
    cover: Option<(RustConnection, Window)>,
    /// Размер окна до изменения.
    size_before: Option<(u16, u16)>,
}

static ACTIONS: Mutex<ActionState> = Mutex::new(ActionState {
    cover: None,
    size_before: None,
});

/// Действие над окном источника для сценариев самотеста: `cover` — закрыть окно другим
/// окном, `minimize` — свернуть, `resize` — изменить размер. `on` включает, иначе возвращает.
pub fn window_action(window: &WindowInfo, kind: &str, on: bool) -> Res<String> {
    let target = window.id as Window;
    let mut state = ACTIONS
        .lock()
        .map_err(|_| "состояние действий недоступно")?;
    match (kind, on) {
        ("cover", true) => {
            let (conn, screen_num) = x11rb::connect(None)?;
            let screen = conn
                .setup()
                .roots
                .get(screen_num)
                .ok_or("X-сервер не сообщил экран")?;
            let (root, black) = (screen.root, screen.black_pixel);
            let g = conn.get_geometry(target)?.reply()?;
            let at = conn.translate_coordinates(target, root, 0, 0)?.reply()?;
            let cover = conn.generate_id()?;
            // Окно мимо оконного менеджера: он его не двигает и не украшает.
            conn.create_window(
                COPY_DEPTH_FROM_PARENT,
                cover,
                root,
                at.dst_x,
                at.dst_y,
                g.width,
                g.height,
                0,
                WindowClass::INPUT_OUTPUT,
                COPY_FROM_PARENT,
                &CreateWindowAux::new()
                    .override_redirect(1)
                    .background_pixel(black),
            )?
            .check()?;
            conn.map_window(cover)?;
            conn.configure_window(
                cover,
                &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE),
            )?;
            conn.flush()?;
            state.cover = Some((conn, cover));
            Ok(format!(
                "окно источника закрыто чёрным окном {}×{}",
                g.width, g.height
            ))
        }
        ("cover", false) => {
            if let Some((conn, cover)) = state.cover.take() {
                conn.destroy_window(cover)?;
                conn.flush()?;
            }
            Ok("закрывающее окно убрано".to_owned())
        }
        ("minimize", _) => {
            let (conn, screen_num) = x11rb::connect(None)?;
            let root = conn
                .setup()
                .roots
                .get(screen_num)
                .ok_or("X-сервер не сообщил экран")?
                .root;
            let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
            if on {
                // Просьба оконному менеджеру свернуть окно; 3 — состояние «значок».
                let atom = conn.intern_atom(false, b"WM_CHANGE_STATE")?.reply()?.atom;
                let event = ClientMessageEvent::new(32, target, atom, [3u32, 0, 0, 0, 0]);
                conn.send_event(false, root, mask, event)?;
                conn.flush()?;
                Ok(format!(
                    "окно источника свёрнуто ({})",
                    map_state(&conn, target)
                ))
            } else {
                conn.map_window(target)?;
                // Просьба оконному менеджеру показать окно; 1 — просит приложение.
                let atom = conn
                    .intern_atom(false, b"_NET_ACTIVE_WINDOW")?
                    .reply()?
                    .atom;
                let event = ClientMessageEvent::new(32, target, atom, [1u32, 0, 0, 0, 0]);
                conn.send_event(false, root, mask, event)?;
                conn.flush()?;
                Ok(format!(
                    "окно источника развёрнуто ({})",
                    map_state(&conn, target)
                ))
            }
        }
        ("resize", _) => {
            let (conn, _) = x11rb::connect(None)?;
            let g = conn.get_geometry(target)?.reply()?;
            let (w, h) = if on {
                state.size_before = Some((g.width, g.height));
                (g.width + 160, g.height + 90)
            } else {
                state.size_before.take().unwrap_or((g.width, g.height))
            };
            conn.configure_window(
                target,
                &ConfigureWindowAux::new().width(w as u32).height(h as u32),
            )?
            .check()?;
            conn.flush()?;
            Ok(format!(
                "размер окна источника: {}×{} → {w}×{h}",
                g.width, g.height
            ))
        }
        (other, _) => Err(format!("действие «{other}» над окном не существует").into()),
    }
}
