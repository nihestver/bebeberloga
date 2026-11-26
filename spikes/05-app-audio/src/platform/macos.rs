// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! macOS: ScreenCaptureKit для видео и звука, AppKit для иконок, libproc для дерева
//! процессов, CoreAudio для списка процессов со звуком.

use std::collections::HashMap;
use std::ffi::c_void;
use std::path::Path;
use std::process::Command;
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication, NSScreen};
use objc2_core_audio::{
    kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    kAudioProcessPropertyIsRunningOutput, kAudioProcessPropertyPID, AudioObjectGetPropertyData,
    AudioObjectGetPropertyDataSize, AudioObjectPropertyAddress,
};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMBlockBuffer, CMSampleBuffer, CMTime,
    CMTimeFlags,
};
use objc2_core_video::{
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight,
    CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
    CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSObject, NSObjectProtocol};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCShareableContent, SCStream, SCStreamConfiguration,
    SCStreamDelegate, SCStreamOutput, SCStreamOutputType, SCWindow,
};

use super::Launched;
use crate::model::{
    AudioMode, AudioNodeInfo, CaptureRequest, EnvInfo, Icon, OutputState, ProcInfo, Res, Running,
    StartInfo, VideoMode, WindowInfo, CHANNELS, SAMPLE_RATE,
};
use crate::rec::{luma_bgra, AudioSink, AudioSplicer, VideoSink, FLAG_TIMESTAMP_FALLBACK};

/// Обёртка для передачи объектов Objective-C между потоками спайка.
struct SendBox<T>(T);
// SAFETY: объекты ScreenCaptureKit, которые сюда кладутся, допускают вызовы с любого
// потока; спайк обращается к ним последовательно.
unsafe impl<T> Send for SendBox<T> {}

fn describe(error: *mut NSError) -> String {
    // SAFETY: указатель либо нулевой, либо действителен на время обратного вызова.
    match unsafe { error.as_ref() } {
        Some(e) => format!(
            "{} (домен {}, код {})",
            e.localizedDescription(),
            e.domain(),
            e.code()
        ),
        None => "ошибка без описания".to_owned(),
    }
}

fn shareable_content() -> Res<Retained<SCShareableContent>> {
    let (tx, rx) = channel();
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            // SAFETY: система передаёт действительный объект или нулевой указатель.
            let result = match unsafe { Retained::retain(content) } {
                Some(c) => Ok(SendBox(c)),
                None => Err(describe(error)),
            };
            let _ = tx.send(result);
        },
    );
    // SAFETY: блок живёт до конца вызова, система копирует его для отложенного ответа.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true, true, &block,
        );
    }
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(c)) => Ok(c.0),
        Ok(Err(e)) => Err(format!("список окон недоступен: {e}").into()),
        Err(RecvTimeoutError::Timeout) => Err("список окон: нет ответа за 15 с".into()),
        Err(RecvTimeoutError::Disconnected) => Err("список окон: ответ потерян".into()),
    }
}

fn app_icon(pid: u32) -> Option<Icon> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)?;
    let image = app.icon()?;
    let tiff = image.TIFFRepresentation()?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
    // Формат пикселей у иконок разный (8 и 16 бит, разный порядок каналов), поэтому
    // представление переводится в PNG средствами AppKit и разбирается как RGBA8.
    // SAFETY: пустой словарь свойств допустим для PNG.
    let png_data = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_data.to_vec()));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut buf).ok()?;
    let pixels = &buf[..frame.buffer_size()];
    let rgba: Vec<u8> = match frame.color_type {
        png::ColorType::Rgba => pixels.to_vec(),
        png::ColorType::Rgb => pixels
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => pixels
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => pixels.iter().flat_map(|p| [*p, *p, *p, 255]).collect(),
        png::ColorType::Indexed => return None,
    };
    Some(Icon {
        width: frame.width,
        height: frame.height,
        rgba,
    })
}

/// Окна верхнего уровня на экране.
pub fn list_windows(with_icons: bool) -> Res<Vec<WindowInfo>> {
    // У потока без цикла событий нет своего пула: без него временные объекты AppKit
    // (иконки по 1024×1024) не освобождаются.
    objc2::rc::autoreleasepool(|_| list_windows_inner(with_icons))
}

fn list_windows_inner(with_icons: bool) -> Res<Vec<WindowInfo>> {
    let content = shareable_content()?;
    let mut out = Vec::new();
    // SAFETY: методы чтения свойств неизменяемых объектов.
    unsafe {
        for w in content.windows().iter() {
            // Слой 0 — обычные окна, 3 — окна «поверх остальных», до 19 — панели и
            // служебные окна приложений; выше идут Dock, строка меню и системные слои.
            if !(0..=19).contains(&w.windowLayer()) || !w.isOnScreen() {
                continue;
            }
            let frame = w.frame();
            if frame.size.width < 40.0 || frame.size.height < 40.0 {
                continue;
            }
            let Some(app) = w.owningApplication() else {
                continue;
            };
            let pid = app.processID() as u32;
            let mut notes = Vec::new();
            if app.bundleIdentifier().is_empty() {
                notes.push("у приложения нет идентификатора бандла".to_owned());
            }
            out.push(WindowInfo {
                id: w.windowID() as u64,
                pid,
                title: w.title().map(|t| t.to_string()).unwrap_or_default(),
                app: app.applicationName().to_string(),
                width: frame.size.width as u32,
                height: frame.size.height as u32,
                // Масштаб система сообщает для фильтра потока, а не для окна в списке.
                scale: 0.0,
                icon: if with_icons { app_icon(pid) } else { None },
                notes,
            });
        }
    }
    Ok(out)
}

fn all_procs() -> HashMap<u32, (u32, String)> {
    let mut map = HashMap::new();
    // SAFETY: буфер pids принадлежит нам, размер передаётся в байтах.
    unsafe {
        let count = libc::proc_listallpids(ptr::null_mut(), 0);
        if count <= 0 {
            return map;
        }
        let mut pids = vec![0i32; count as usize + 64];
        let got = libc::proc_listallpids(
            pids.as_mut_ptr().cast(),
            (pids.len() * std::mem::size_of::<i32>()) as i32,
        );
        for pid in pids.into_iter().take(got.max(0) as usize) {
            if pid <= 0 {
                continue;
            }
            let mut info: libc::proc_bsdinfo = std::mem::zeroed();
            let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
            let n = libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            );
            if n != size {
                // Чужие процессы недоступны без прав; в дерево приложения они не входят.
                continue;
            }
            let raw = if info.pbi_name[0] != 0 {
                &info.pbi_name[..]
            } else {
                &info.pbi_comm[..]
            };
            let name: String = raw
                .iter()
                .take_while(|c| **c != 0)
                .map(|c| *c as u8 as char)
                .collect();
            map.insert(pid as u32, (info.pbi_ppid, name));
        }
    }
    map
}

/// Процесс `root` и все его потомки.
pub fn process_tree(root: u32) -> Res<Vec<ProcInfo>> {
    let procs = all_procs();
    let mut out = Vec::new();
    let mut queue = vec![(root, 0u32)];
    while let Some((pid, depth)) = queue.pop() {
        let Some((ppid, name)) = procs.get(&pid) else {
            continue;
        };
        out.push(ProcInfo {
            pid,
            ppid: *ppid,
            name: name.clone(),
            depth,
        });
        for (child, (parent, _)) in &procs {
            if *parent == pid && *child != pid && depth < 32 {
                queue.push((*child, depth + 1));
            }
        }
    }
    out.sort_by_key(|p| (p.depth, p.pid));
    Ok(out)
}

fn audio_prop<T: Copy + Default>(object: u32, selector: u32) -> Option<T> {
    let mut address = AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut value = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    // SAFETY: адрес, размер и буфер значения — корректные указатели на стеке.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&mut address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast(),
        )
    };
    (status == 0).then_some(value)
}

/// Процессы, которые система звука считает клиентами (CoreAudio, macOS 14.2+).
pub fn audio_nodes() -> Res<Vec<AudioNodeInfo>> {
    let mut address = AudioObjectPropertyAddress {
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let system = kAudioObjectSystemObject as u32;
    let mut size = 0u32;
    // SAFETY: корректные указатели на стеке.
    let status = unsafe {
        AudioObjectGetPropertyDataSize(
            system,
            NonNull::from(&mut address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
        )
    };
    if status != 0 {
        return Err(format!("CoreAudio: список процессов недоступен, код {status}").into());
    }
    let mut ids = vec![0u32; size as usize / 4];
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // SAFETY: буфер ids вмещает size байт.
    let status = unsafe {
        AudioObjectGetPropertyData(
            system,
            NonNull::from(&mut address),
            0,
            ptr::null(),
            NonNull::from(&mut size),
            NonNull::new_unchecked(ids.as_mut_ptr()).cast(),
        )
    };
    if status != 0 {
        return Err(format!("CoreAudio: список процессов не прочитан, код {status}").into());
    }
    let mut out = Vec::new();
    for id in ids.into_iter().take(size as usize / 4) {
        let Some(pid) = audio_prop::<i32>(id, kAudioProcessPropertyPID) else {
            continue;
        };
        let running = audio_prop::<u32>(id, kAudioProcessPropertyIsRunningOutput).unwrap_or(0);
        out.push(AudioNodeInfo {
            pid: pid.max(0) as u32,
            node_id: id as u64,
            kind: "процесс-объект CoreAudio".to_owned(),
            active: running != 0,
            extra: Vec::new(),
        });
    }
    Ok(out)
}

/// Куда поток отдаёт звук: склейщик и поколение потока.
type AudioOut = (Arc<AudioSplicer>, u32);

struct OutputIvars {
    audio: Option<AudioOut>,
    video: Option<Arc<VideoSink>>,
    idle_frames: AtomicU64,
    notes: Arc<Mutex<Vec<String>>>,
    audio_format_noted: Mutex<bool>,
}

define_class!(
    // SAFETY: NSObject не накладывает требований на подклассы; Drop не реализован.
    #[unsafe(super(NSObject))]
    #[ivars = OutputIvars]
    struct StreamOutput;

    unsafe impl NSObjectProtocol for StreamOutput {}

    unsafe impl SCStreamOutput for StreamOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(
            &self,
            _stream: &SCStream,
            sample: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind == SCStreamOutputType::Screen {
                self.on_video(sample);
            } else if kind == SCStreamOutputType::Audio {
                self.on_audio(sample);
            }
        }
    }

    unsafe impl SCStreamDelegate for StreamOutput {
        #[unsafe(method(stream:didStopWithError:))]
        fn did_stop(&self, _stream: &SCStream, error: &NSError) {
            self.note(format!(
                "поток остановлен системой: {} (код {})",
                error.localizedDescription(),
                error.code()
            ));
        }
    }
);

fn cmtime_ns(t: CMTime) -> Option<u64> {
    if t.timescale <= 0 || t.value < 0 || (t.flags.0 & CMTimeFlags::Valid.0) == 0 {
        return None;
    }
    Some(((t.value as u128) * 1_000_000_000u128 / (t.timescale as u128)) as u64)
}

impl StreamOutput {
    fn new(
        audio: Option<AudioOut>,
        video: Option<Arc<VideoSink>>,
        notes: Arc<Mutex<Vec<String>>>,
    ) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars {
            audio,
            video,
            idle_frames: AtomicU64::new(0),
            notes,
            audio_format_noted: Mutex::new(false),
        });
        // SAFETY: обычная инициализация NSObject.
        unsafe { msg_send![super(this), init] }
    }

    fn note(&self, text: String) {
        if let Ok(mut notes) = self.ivars().notes.lock() {
            notes.push(text);
        }
    }

    fn on_video(&self, sample: &CMSampleBuffer) {
        let Some(sink) = self.ivars().video.as_ref() else {
            return;
        };
        // SAFETY: буфер действителен на время обратного вызова.
        let Some(image) = (unsafe { sample.image_buffer() }) else {
            // Кадры без изображения система присылает, когда содержимое окна не менялось.
            self.ivars().idle_frames.fetch_add(1, Ordering::Relaxed);
            return;
        };
        // SAFETY: чтение метки времени буфера.
        let Some(t_ns) = cmtime_ns(unsafe { sample.presentation_time_stamp() }) else {
            return;
        };
        let mut luma = -1;
        let (mut width, mut height) = (0usize, 0usize);
        // SAFETY: адрес и размеры читаются между блокировкой и разблокировкой буфера;
        // контрольная точка лежит внутри кадра.
        unsafe {
            if CVPixelBufferLockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly) == 0 {
                width = CVPixelBufferGetWidth(&image);
                height = CVPixelBufferGetHeight(&image);
                let stride = CVPixelBufferGetBytesPerRow(&image);
                let base = CVPixelBufferGetBaseAddress(&image) as *const u8;
                if !base.is_null() && width > 0 && height > 0 && stride >= width * 4 {
                    let px = base.add((height / 2) * stride + (width / 2) * 4);
                    luma = luma_bgra(std::slice::from_raw_parts(px, 4));
                }
                CVPixelBufferUnlockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly);
            }
        }
        sink.frame(t_ns, width as u32, height as u32, luma, "sck");
    }

    fn on_audio(&self, sample: &CMSampleBuffer) {
        let Some((sink, generation)) = self.ivars().audio.as_ref() else {
            return;
        };
        // SAFETY: чтение свойств буфера, действительного на время обратного вызова.
        let frames = unsafe { sample.num_samples() } as usize;
        if frames == 0 {
            return;
        }
        let pts = cmtime_ns(unsafe { sample.presentation_time_stamp() });
        let Some(format) = (unsafe { sample.format_description() }) else {
            return;
        };
        // SAFETY: описание формата действительно, пока жив `format`.
        let Some(asbd) =
            (unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&format).as_ref() })
        else {
            return;
        };
        const FLAG_FLOAT: u32 = 1;
        const FLAG_NON_INTERLEAVED: u32 = 32;
        let planar = asbd.mFormatFlags & FLAG_NON_INTERLEAVED != 0;
        let channels = asbd.mChannelsPerFrame as usize;
        if let Ok(mut noted) = self.ivars().audio_format_noted.lock() {
            if !*noted {
                *noted = true;
                self.note(format!(
                    "формат звука от системы: {} Гц, каналов {}, {} бит, float: {}, каналы раздельно: {}, кадров в первом буфере: {}",
                    asbd.mSampleRate,
                    channels,
                    asbd.mBitsPerChannel,
                    asbd.mFormatFlags & FLAG_FLOAT != 0,
                    planar,
                    frames
                ));
            }
        }
        if asbd.mFormatFlags & FLAG_FLOAT == 0
            || asbd.mBitsPerChannel != 32
            || channels == 0
            || asbd.mSampleRate as u32 != SAMPLE_RATE
        {
            return;
        }

        // Список буферов: сначала узнаём нужный размер, затем читаем.
        let mut needed = 0usize;
        // SAFETY: запрос размера, выходные указатели кроме размера нулевые.
        unsafe {
            sample.audio_buffer_list_with_retained_block_buffer(
                &mut needed,
                ptr::null_mut(),
                0,
                None,
                None,
                0,
                ptr::null_mut(),
            );
        }
        if needed < std::mem::size_of::<AudioBufferList>() {
            return;
        }
        let mut storage = vec![0u64; needed.div_ceil(8)];
        let list = storage.as_mut_ptr().cast::<AudioBufferList>();
        let mut block: *mut CMBlockBuffer = ptr::null_mut();
        // SAFETY: storage выровнен как u64 и вмещает needed байт.
        let status = unsafe {
            sample.audio_buffer_list_with_retained_block_buffer(
                ptr::null_mut(),
                list,
                needed,
                None,
                None,
                0,
                &mut block,
            )
        };
        if status != 0 {
            return;
        }
        // SAFETY: функция вернула удержанный блок-буфер; CFRetained освободит его.
        let _keep = NonNull::new(block).map(|b| unsafe { CFRetained::from_raw(b) });

        let mut interleaved = vec![0f32; frames * CHANNELS];
        // SAFETY: система заполнила mNumberBuffers элементов; данные живы, пока жив блок-буфер.
        unsafe {
            let count = (*list).mNumberBuffers as usize;
            let buffers: &[AudioBuffer] =
                std::slice::from_raw_parts((*list).mBuffers.as_ptr(), count);
            if planar {
                for ch in 0..CHANNELS {
                    let Some(buf) = buffers.get(ch.min(count.saturating_sub(1))) else {
                        continue;
                    };
                    let n = (buf.mDataByteSize as usize / 4).min(frames);
                    if buf.mData.is_null() {
                        continue;
                    }
                    let data = std::slice::from_raw_parts(buf.mData as *const f32, n);
                    for (i, s) in data.iter().enumerate() {
                        interleaved[i * CHANNELS + ch] = *s;
                    }
                }
            } else if let Some(buf) = buffers.first() {
                if !buf.mData.is_null() {
                    let n = (buf.mDataByteSize as usize / 4).min(frames * channels);
                    let data = std::slice::from_raw_parts(buf.mData as *const f32, n);
                    for (i, frame) in data.chunks_exact(channels).enumerate() {
                        interleaved[i * CHANNELS] = frame[0];
                        interleaved[i * CHANNELS + 1] = frame[channels.min(2) - 1];
                    }
                }
            }
        }
        match pts {
            Some(t) => sink.push(*generation, t, &interleaved, 0),
            None => sink.push(
                *generation,
                crate::clock::now_ns(),
                &interleaved,
                FLAG_TIMESTAMP_FALLBACK,
            ),
        }
    }
}

/// Чем задан фильтр потока: по этим данным фильтр можно собрать заново.
#[derive(Clone, Copy)]
enum FilterKind {
    /// Одно окно.
    Window(u64),
    /// Дисплей, на котором видны только окна приложения с этим PID.
    App(u32),
    /// Весь дисплей.
    Display,
}

impl FilterKind {
    fn build(self, content: &SCShareableContent) -> Res<Retained<SCContentFilter>> {
        let no_windows = NSArray::<SCWindow>::new();
        // SAFETY: фильтры создаются по действительным объектам из свежего списка содержимого.
        unsafe {
            Ok(match self {
                FilterKind::Window(id) => {
                    let w = content
                        .windows()
                        .iter()
                        .find(|w| w.windowID() as u64 == id)
                        .ok_or("окна больше нет в списке ScreenCaptureKit")?;
                    SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &w)
                }
                FilterKind::App(pid) => {
                    let app = content
                        .applications()
                        .iter()
                        .find(|a| a.processID() as u32 == pid)
                        .ok_or("приложения с таким PID нет в списке ScreenCaptureKit")?;
                    let apps = NSArray::from_retained_slice(&[app]);
                    let display = first_display(content)?;
                    SCContentFilter::initWithDisplay_includingApplications_exceptingWindows(
                        SCContentFilter::alloc(),
                        &display,
                        &apps,
                        &no_windows,
                    )
                }
                FilterKind::Display => {
                    let display = first_display(content)?;
                    SCContentFilter::initWithDisplay_excludingWindows(
                        SCContentFilter::alloc(),
                        &display,
                        &no_windows,
                    )
                }
            })
        }
    }
}

struct ActiveStream {
    stream: Retained<SCStream>,
    output: Retained<StreamOutput>,
    kind: FilterKind,
    has_audio: bool,
    has_video: bool,
    exclude_self_audio: bool,
    _queues: Vec<dispatch2::DispatchRetained<DispatchQueue>>,
}

fn wait_block(what: &str, call: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Res<()> {
    let (tx, rx) = channel();
    let block = RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            Err(describe(error))
        };
        let _ = tx.send(result);
    });
    call(&block);
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(format!("{what}: {e}").into()),
        Err(_) => Err(format!("{what}: нет ответа за 15 с").into()),
    }
}

struct StreamPlan {
    kind: FilterKind,
    width: usize,
    height: usize,
    fps: u32,
    video: Option<Arc<VideoSink>>,
    audio: Option<AudioOut>,
    exclude_self_audio: bool,
}

fn start_stream(
    content: &SCShareableContent,
    plan: StreamPlan,
    notes: &Arc<Mutex<Vec<String>>>,
) -> Res<ActiveStream> {
    let filter = plan.kind.build(content)?;
    // Размер кадра в физических пикселях: область окна в точках × масштаб экрана.
    // Система сообщает их для фильтра начиная с macOS 14; на 13 остаётся оценка ×2.
    let (mut width, mut height) = (plan.width, plan.height);
    if let (FilterKind::Window(_), Some(video)) = (plan.kind, plan.video.as_ref()) {
        if objc2::available!(macos = 14.0) {
            // SAFETY: чтение свойств действительного фильтра.
            let (scale, rect) = unsafe {
                let info = SCShareableContent::infoForFilter(&filter);
                (info.pointPixelScale(), info.contentRect())
            };
            width = (rect.size.width * scale as f64).round() as usize;
            height = (rect.size.height * scale as f64).round() as usize;
            video.set_scale(scale);
            if let Ok(mut n) = notes.lock() {
                n.push(format!(
                    "масштаб экрана {:.0} %; окно {}×{} точек, кадр {width}×{height} физических пикселей",
                    scale * 100.0,
                    rect.size.width,
                    rect.size.height
                ));
            }
        }
    }
    // SAFETY: создание и настройка объектов ScreenCaptureKit по их документации;
    // все аргументы — действительные объекты.
    unsafe {
        let config = SCStreamConfiguration::new();
        config.setWidth(width.max(2));
        config.setHeight(height.max(2));
        config.setMinimumFrameInterval(CMTime {
            value: 1,
            timescale: plan.fps.max(1) as i32,
            flags: CMTimeFlags::Valid,
            epoch: 0,
        });
        config.setPixelFormat(u32::from_be_bytes(*b"BGRA"));
        config.setQueueDepth(6);
        config.setShowsCursor(false);
        let has_audio = plan.audio.is_some();
        if has_audio {
            config.setCapturesAudio(true);
            config.setSampleRate(SAMPLE_RATE as isize);
            config.setChannelCount(CHANNELS as isize);
            config.setExcludesCurrentProcessAudio(plan.exclude_self_audio);
        }
        let has_video = plan.video.is_some();
        let output = StreamOutput::new(plan.audio, plan.video, notes.clone());
        let stream = SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &config,
            Some(ProtocolObject::from_ref(&*output)),
        );
        let mut queues = Vec::new();
        // Видео-выход добавляется всегда: без него система пишет в журнал о потерянных кадрах.
        let vq = DispatchQueue::new("s5.capture.video", None);
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(&*output),
                SCStreamOutputType::Screen,
                Some(&vq),
            )
            .map_err(|e| format!("видео-выход не добавлен: {}", e.localizedDescription()))?;
        queues.push(vq);
        if has_audio {
            let aq = DispatchQueue::new("s5.capture.audio", None);
            stream
                .addStreamOutput_type_sampleHandlerQueue_error(
                    ProtocolObject::from_ref(&*output),
                    SCStreamOutputType::Audio,
                    Some(&aq),
                )
                .map_err(|e| format!("звуковой выход не добавлен: {}", e.localizedDescription()))?;
            queues.push(aq);
        }
        wait_block("запуск захвата", |block| {
            stream.startCaptureWithCompletionHandler(Some(block));
        })?;
        Ok(ActiveStream {
            stream,
            output,
            kind: plan.kind,
            has_audio,
            has_video,
            exclude_self_audio: plan.exclude_self_audio,
            _queues: queues,
        })
    }
}

fn first_display(content: &SCShareableContent) -> Res<Retained<SCDisplay>> {
    // SAFETY: чтение свойств неизменяемого объекта.
    unsafe { content.displays().iter().next() }.ok_or_else(|| "нет ни одного дисплея".into())
}

/// Запущенные потоки, общие для остановки и обновления.
struct Streams(Mutex<Vec<ActiveStream>>);
// SAFETY: объекты ScreenCaptureKit допускают вызовы с любого потока; список защищён
// мьютексом, обновление и остановка не пересекаются.
unsafe impl Send for Streams {}
unsafe impl Sync for Streams {}

fn stop_stream(stream: &ActiveStream, what: &str) -> Res<()> {
    wait_block(what, |block| {
        // SAFETY: остановка действительного потока.
        unsafe { stream.stream.stopCaptureWithCompletionHandler(Some(block)) };
    })
}

/// Запустить захват.
///
/// Признаки варианта (`req.variant`, через запятую):
/// - `app` — звук приложения отдельным потоком через фильтр «дисплей + приложение»
///   (без признака — один поток с фильтром по окну: видео окна и звук);
/// - что делать при обновлении состава захвата (`Running::refresh`):
///   без признака — передать потоку заново собранный фильтр;
///   `restart` — остановить поток и запустить его снова;
///   `splice` — запустить второй поток звука, не останавливая первый, и склеить их
///   по шкале времени.
pub fn start_capture(
    req: &CaptureRequest,
    audio: Option<Arc<AudioSink>>,
    video: Option<Arc<VideoSink>>,
) -> Res<Running> {
    let content = shareable_content()?;
    let notes = Arc::new(Mutex::new(Vec::new()));
    let mut info = StartInfo::default();
    let mut streams: Vec<ActiveStream> = Vec::new();
    let want_video = !matches!(req.video, VideoMode::None);
    if want_video && !matches!(req.video, VideoMode::Auto | VideoMode::Sck) {
        return Err(format!("метод видео {} на macOS не существует", req.video.name()).into());
    }
    // Размер кадра уточняется по данным системы в start_stream; это запасная оценка.
    let window_size = req
        .window
        .as_ref()
        .map(|w| (w.width as usize * 2, w.height as usize * 2))
        .unwrap_or((640, 360));
    let flags: Vec<&str> = req.variant.split(',').filter(|f| !f.is_empty()).collect();
    let variant = if flags.contains(&"app") {
        "app"
    } else {
        "window"
    };
    let restart = flags.contains(&"restart");
    let splice = flags.contains(&"splice");
    let splicer = audio.map(AudioSplicer::new);
    let first_generation = |s: &Option<Arc<AudioSplicer>>| s.clone().map(|s| (s, 0u32));
    let audio_only = |kind: FilterKind, exclude_self: bool| StreamPlan {
        kind,
        width: 16,
        height: 16,
        fps: 1,
        video: None,
        audio: first_generation(&splicer),
        exclude_self_audio: exclude_self,
    };

    match req.audio {
        AudioMode::App if variant == "window" => {
            let w = req
                .window
                .as_ref()
                .ok_or("для звука приложения через фильтр по окну нужно окно")?;
            streams.push(start_stream(
                &content,
                StreamPlan {
                    kind: FilterKind::Window(w.id),
                    width: window_size.0,
                    height: window_size.1,
                    fps: req.fps,
                    video: if want_video { video.clone() } else { None },
                    audio: first_generation(&splicer),
                    exclude_self_audio: true,
                },
                &notes,
            )?);
            info.audio_method = "sck: фильтр по окну, один поток".to_owned();
            if want_video {
                info.video_method = "sck".to_owned();
            }
        }
        AudioMode::App => {
            let pid = req.root_pid().ok_or("для звука приложения нужен PID")?;
            streams.push(start_stream(
                &content,
                audio_only(FilterKind::App(pid), true),
                &notes,
            )?);
            info.audio_method = "sck: фильтр «дисплей + приложение», отдельный поток".to_owned();
        }
        AudioMode::SystemExceptSelf => {
            streams.push(start_stream(
                &content,
                audio_only(FilterKind::Display, true),
                &notes,
            )?);
            info.audio_method = "sck: весь дисплей, без собственного процесса".to_owned();
        }
        AudioMode::SystemAll => {
            streams.push(start_stream(
                &content,
                audio_only(FilterKind::Display, false),
                &notes,
            )?);
            info.audio_method = "sck: весь дисплей, вместе с собственным процессом".to_owned();
        }
        AudioMode::None => {}
    }

    // Видео отдельным потоком, если звук шёл не через фильтр по окну.
    if want_video && info.video_method.is_empty() {
        let w = req.window.as_ref().ok_or("для видео нужно окно")?;
        streams.push(start_stream(
            &content,
            StreamPlan {
                kind: FilterKind::Window(w.id),
                width: window_size.0,
                height: window_size.1,
                fps: req.fps,
                video: video.clone(),
                audio: None,
                exclude_self_audio: true,
            },
            &notes,
        )?);
        info.video_method = "sck".to_owned();
    }
    info.attempts.push(format!(
        "sck: потоков запущено {}, вариант {variant}",
        streams.len()
    ));

    let shared = Arc::new(Streams(Mutex::new(streams)));
    let for_stop = shared.clone();
    let notes_out = notes.clone();
    let stopper = Box::new(move || {
        let Ok(list) = for_stop.0.lock() else {
            return;
        };
        for s in list.iter() {
            let _ = stop_stream(s, "остановка захвата");
            let idle = s.output.ivars().idle_frames.load(Ordering::Relaxed);
            if idle > 0 {
                if let Ok(mut n) = notes_out.lock() {
                    n.push(format!("кадров без изображения (окно не менялось): {idle}"));
                }
            }
        }
    });

    let for_refresh = shared;
    let refresh_notes = notes.clone();
    let generation = std::sync::atomic::AtomicU32::new(0);
    let refresher = Box::new(move || -> Res<String> {
        let mut list = for_refresh
            .0
            .lock()
            .map_err(|_| "список потоков недоступен")?;
        if splice {
            // Второй поток звука запускается, пока первый ещё работает; склейщик
            // дописывает первый до метки, с которой начинаются данные второго.
            let splicer = splicer
                .clone()
                .ok_or("склейка возможна только при записи звука")?;
            let old = list
                .iter()
                .position(|s| s.has_audio)
                .ok_or("нет потока со звуком")?;
            let (kind, exclude_self) = (list[old].kind, list[old].exclude_self_audio);
            let next = generation.fetch_add(1, Ordering::Relaxed) + 1;
            let started = std::time::Instant::now();
            splicer.begin_switch(next);
            let content = shareable_content()?;
            let fresh = start_stream(
                &content,
                StreamPlan {
                    kind,
                    width: 16,
                    height: 16,
                    fps: 1,
                    video: None,
                    audio: Some((splicer.clone(), next)),
                    exclude_self_audio: exclude_self,
                },
                &refresh_notes,
            )?;
            let ready_ms = started.elapsed().as_millis();
            let mut joined = None;
            while started.elapsed() < Duration::from_secs(3) {
                joined = splicer.switched(next);
                if joined.is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            let total_ms = started.elapsed().as_millis();
            // Прежний поток: если он только звуковой — остановить; если несёт видео —
            // оставить, его звук склейщик больше не принимает.
            let old_kept = list[old].has_video;
            if !old_kept {
                let stale = list.remove(old);
                let _ = stop_stream(&stale, "остановка прежнего потока звука");
            }
            list.push(fresh);
            return match joined {
                Some((_, trimmed)) => Ok(format!(
                    "второй поток звука запущен за {ready_ms} мс, стык состоялся через {total_ms} мс от начала; на стыке отброшено {trimmed} кадров второго потока как уже записанных; прежний поток {}",
                    if old_kept { "оставлен ради видео" } else { "остановлен" }
                )),
                None => Err("второй поток запущен, но стык не состоялся за 3 с".into()),
            };
        }
        if restart {
            for s in list.iter() {
                stop_stream(s, "остановка перед перезапуском")?;
                wait_block("повторный запуск", |block| {
                    // SAFETY: запуск действительного потока с прежними выходами.
                    unsafe { s.stream.startCaptureWithCompletionHandler(Some(block)) };
                })?;
            }
            return Ok(format!(
                "остановлено и запущено заново потоков: {}",
                list.len()
            ));
        }
        let content = shareable_content()?;
        for s in list.iter() {
            let filter = s.kind.build(&content)?;
            wait_block("обновление фильтра", |block| {
                // SAFETY: обновление фильтра действительного потока.
                unsafe {
                    s.stream
                        .updateContentFilter_completionHandler(&filter, Some(block))
                };
            })?;
        }
        Ok(format!(
            "фильтр обновлён без остановки у {} потоков",
            list.len()
        ))
    });
    Ok(Running::with_notes(info, stopper, notes).with_refresher(refresher))
}

/// Запустить тестовый источник отдельным приложением.
///
/// Бандл `.app` собирается в каталоге прогона из исполняемого файла: система
/// учитывает звук и окна по приложениям, и источник не должен считаться частью
/// программы захвата или терминала.
pub fn launch_source(exe: &Path, role: &str, out: &Path, args: &[String]) -> Res<Launched> {
    let bundle = out.join(format!("S5{role}.app"));
    let macos = bundle.join("Contents/MacOS");
    std::fs::create_dir_all(&macos)?;
    std::fs::copy(exe, macos.join("s5src"))?;
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>s5src</string>
  <key>CFBundleIdentifier</key><string>org.bebeberloga.spike.s5.{role}</string>
  <key>CFBundleName</key><string>S5 {role}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
"#
    );
    std::fs::write(bundle.join("Contents/Info.plist"), plist)?;
    let status = Command::new("/usr/bin/open")
        .arg("-n")
        .arg("-g")
        .arg("-a")
        .arg(&bundle)
        .arg("--args")
        .args(args)
        .status()?;
    if !status.success() {
        return Err(format!("open завершился с кодом {status}").into());
    }
    Ok(Launched {
        child: None,
        how: "отдельное приложение (.app, запуск через open)".to_owned(),
    })
}

/// Подготовка процесса: на этой ОС ничего не требуется.
pub fn init() {}

/// Состояние устройства вывода: в спайке проверяется только на Windows.
pub fn output_state() -> Res<OutputState> {
    Err("на macOS проверка состояния устройства вывода не реализована".into())
}

/// Задать состояние устройства вывода: в спайке только на Windows.
pub fn set_output_state(_state: &OutputState) -> Res<()> {
    Err("на macOS проверка состояния устройства вывода не реализована".into())
}

/// Удержание дисплея включённым на время прогона.
pub struct DisplayAwake(Option<std::process::Child>);

impl Drop for DisplayAwake {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Не дать дисплею погаснуть: пока он выключен, система не отдаёт кадры захвата.
/// Запрет держит штатная утилита `caffeinate`, привязанная к нашему процессу.
pub fn keep_display_awake() -> DisplayAwake {
    DisplayAwake(
        Command::new("/usr/bin/caffeinate")
            .args(["-d", "-w", &std::process::id().to_string()])
            .spawn()
            .ok(),
    )
}

fn sysctl_string(name: &str) -> Option<String> {
    let cname = std::ffi::CString::new(name).ok()?;
    let mut size = 0usize;
    // SAFETY: запрос размера, затем чтение в буфер этого размера.
    unsafe {
        if libc::sysctlbyname(
            cname.as_ptr(),
            ptr::null_mut(),
            &mut size,
            ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        let mut buf = vec![0u8; size];
        if libc::sysctlbyname(
            cname.as_ptr(),
            buf.as_mut_ptr() as *mut c_void,
            &mut size,
            ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        buf.truncate(size.saturating_sub(1));
        String::from_utf8(buf).ok()
    }
}

/// Сведения о стенде.
pub fn env_info() -> EnvInfo {
    let mut details = Vec::new();
    if let Some(model) = sysctl_string("hw.model") {
        details.push(("модель".to_owned(), model));
    }
    if let Some(cpu) = sysctl_string("machdep.cpu.brand_string") {
        details.push(("процессор".to_owned(), cpu));
    }
    if let Some(build) = sysctl_string("kern.osversion") {
        details.push(("сборка".to_owned(), build));
    }
    // Сведения об экране доступны только из главного потока.
    if let Some(screen) = objc2::MainThreadMarker::new().and_then(NSScreen::mainScreen) {
        details.push((
            "основной экран".to_owned(),
            format!(
                "до {} Гц, масштаб {:.0} %",
                screen.maximumFramesPerSecond(),
                screen.backingScaleFactor() * 100.0
            ),
        ));
    }
    EnvInfo {
        os: "macOS".to_owned(),
        os_version: sysctl_string("kern.osproductversion").unwrap_or_default(),
        arch: std::env::consts::ARCH.to_owned(),
        session: String::new(),
        details,
    }
}
