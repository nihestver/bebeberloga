// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Windows: захват видео тремя методами — Windows Graphics Capture, DXGI Desktop
//! Duplication, GDI BitBlt. Каждый метод отдаёт метку времени кадра по шкале QPC и
//! яркость контрольной точки в центре окна; сами кадры спайк не сохраняет.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::{IInspectable, Interface};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, HWND, POINT, RECT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D,
    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, IDXGIOutput,
    IDXGIOutput1, IDXGIResource, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Gdi::{
    BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    GetDC, GetPixel, MonitorFromWindow, ReleaseDC, SelectObject, CAPTUREBLT, HGDIOBJ,
    MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

use super::list::{com_init, window_scale};
use crate::clock::{hns_to_ns, now_ns, qpc_ticks_to_ns};
use crate::model::Res;
use crate::rec::{luma_bgra, VideoSink};

/// Метод захвата видео.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VideoMethod {
    Wgc,
    Dxgi,
    Gdi,
}

impl VideoMethod {
    pub fn name(self) -> &'static str {
        match self {
            VideoMethod::Wgc => "wgc",
            VideoMethod::Dxgi => "dxgi",
            VideoMethod::Gdi => "gdi",
        }
    }
}

/// Значение HWND, которое можно передать в другой поток.
#[derive(Clone, Copy)]
struct WindowHandle(isize);

impl WindowHandle {
    fn hwnd(self) -> HWND {
        HWND(self.0 as *mut core::ffi::c_void)
    }
}

/// Устройство D3D11 с текстурой 1×1 для чтения одной точки кадра.
struct Readback {
    context: ID3D11DeviceContext,
    staging: ID3D11Texture2D,
}

// SAFETY: после создания объектом пользуется только один поток (поток метода захвата
// или поток обратных вызовов пула кадров), одновременных обращений нет.
unsafe impl Send for Readback {}

impl Readback {
    fn new(device: &ID3D11Device, context: ID3D11DeviceContext) -> Res<Self> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: 1,
            Height: 1,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut staging: Option<ID3D11Texture2D> = None;
        // SAFETY: описание текстуры на стеке, выходной указатель действителен.
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging))? };
        Ok(Self {
            context,
            staging: staging.ok_or("текстура для чтения точки не создана")?,
        })
    }

    /// Яркость точки (x, y) текстуры кадра.
    fn luma_at(&self, texture: &ID3D11Texture2D, x: u32, y: u32) -> i32 {
        let region = D3D11_BOX {
            left: x,
            top: y,
            front: 0,
            right: x + 1,
            bottom: y + 1,
            back: 1,
        };
        // SAFETY: область лежит внутри текстуры кадра; отображённая память читается
        // до Unmap и содержит один пиксель BGRA.
        unsafe {
            self.context.CopySubresourceRegion(
                &self.staging,
                0,
                0,
                0,
                0,
                texture,
                0,
                Some(&region),
            );
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            if self
                .context
                .Map(&self.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                .is_err()
                || mapped.pData.is_null()
            {
                return -1;
            }
            let luma = luma_bgra(std::slice::from_raw_parts(mapped.pData.cast::<u8>(), 4));
            self.context.Unmap(&self.staging, 0);
            luma
        }
    }
}

fn create_device(adapter: Option<&IDXGIAdapter>) -> Res<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    // С явным адаптером тип драйвера обязан быть UNKNOWN.
    let driver = if adapter.is_some() {
        D3D_DRIVER_TYPE_UNKNOWN
    } else {
        D3D_DRIVER_TYPE_HARDWARE
    };
    // SAFETY: выходные указатели действительны на время вызова.
    unsafe {
        D3D11CreateDevice(
            adapter,
            driver,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let device = device.ok_or("устройство D3D11 не создано")?;
    let context = context.ok_or("контекст D3D11 не создан")?;
    // Пул кадров пользуется тем же устройством из своего потока: включаем защиту
    // контекста от одновременных обращений.
    if let Ok(guard) = context.cast::<ID3D11Multithread>() {
        // SAFETY: настройка действительного контекста.
        unsafe {
            let _ = guard.SetMultithreadProtected(true);
        }
    }
    Ok((device, context))
}

fn adapter_name(device: &ID3D11Device) -> String {
    // SAFETY: чтение описания адаптера устройства.
    unsafe {
        device
            .cast::<IDXGIDevice>()
            .and_then(|d| d.GetAdapter())
            .and_then(|a| a.GetDesc())
            .map(|d| {
                let len = d.Description.iter().position(|c| *c == 0).unwrap_or(0);
                String::from_utf16_lossy(&d.Description[..len])
            })
            .unwrap_or_default()
    }
}

type Ready = Sender<Result<Vec<String>, String>>;

/// Windows Graphics Capture: кадры окна приходят обратными вызовами пула кадров.
fn run_wgc(window: WindowHandle, sink: Arc<VideoSink>, stop: Arc<AtomicBool>, ready: Ready) {
    com_init();
    let frames = Arc::new(AtomicU64::new(0));
    let mut notes = Vec::new();
    let setup = (|| -> Res<(Direct3D11CaptureFramePool, GraphicsCaptureSession)> {
        if !GraphicsCaptureSession::IsSupported()? {
            return Err("система сообщает, что Windows Graphics Capture не поддержан".into());
        }
        let (device, context) = create_device(None)?;
        notes.push(format!("адаптер: {}", adapter_name(&device)));
        let readback = Readback::new(&device, context)?;
        let dxgi: IDXGIDevice = device.cast()?;
        // SAFETY: обёртка WinRT над действительным устройством DXGI.
        let d3d: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        // SAFETY: окно существует на момент вызова; при закрытии окна система вернёт ошибку.
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window.hwnd())? };
        let size = item.Size()?;
        notes.push(format!("размер источника: {}×{}", size.Width, size.Height));
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &d3d,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )?;
        let session = pool.CreateCaptureSession(&item)?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        match session.SetIsBorderRequired(false) {
            Ok(()) => notes.push("рамка захвата отключена".to_owned()),
            Err(e) => notes.push(format!("рамку захвата отключить нельзя: {e}")),
        }
        let counter = frames.clone();
        let handler_sink = sink.clone();
        pool.FrameArrived(
            &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(move |pool, _| {
                let Some(pool) = pool.as_ref() else {
                    return Ok(());
                };
                let frame = pool.TryGetNextFrame()?;
                // Время кадра — счётчик QPC на момент композиции, в единицах по 100 нс.
                let t_ns = hns_to_ns(frame.SystemRelativeTime()?.Duration);
                let size = frame.ContentSize()?;
                let surface = frame.Surface()?;
                let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
                // SAFETY: поверхность кадра — текстура D3D11 того же устройства.
                let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
                let (w, h) = (size.Width.max(1) as u32, size.Height.max(1) as u32);
                let luma = readback.luma_at(&texture, w / 2, h / 2);
                handler_sink.frame(t_ns, w, h, luma, "wgc");
                counter.fetch_add(1, Ordering::Relaxed);
                frame.Close()?;
                Ok(())
            }),
        )?;
        session.StartCapture()?;
        Ok((pool, session))
    })();
    let (pool, session) = match setup {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return;
        }
    };
    // Метод считается запущенным, когда пришёл первый кадр.
    let deadline = Instant::now() + Duration::from_secs(3);
    while frames.load(Ordering::Relaxed) == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    if frames.load(Ordering::Relaxed) == 0 {
        let _ = session.Close();
        let _ = pool.Close();
        let _ = ready.send(Err("за 3 с не пришло ни одного кадра".to_owned()));
        return;
    }
    let _ = ready.send(Ok(notes));
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = session.Close();
    let _ = pool.Close();
}

/// Адаптер и выход, на котором находится окно.
fn output_for_window(window: WindowHandle) -> Res<(IDXGIAdapter1, IDXGIOutput, RECT)> {
    // SAFETY: перечисление адаптеров и выходов DXGI.
    unsafe {
        let monitor = MonitorFromWindow(window.hwnd(), MONITOR_DEFAULTTONEAREST);
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let mut a = 0;
        while let Ok(adapter) = factory.EnumAdapters1(a) {
            let mut o = 0;
            while let Ok(output) = adapter.EnumOutputs(o) {
                let desc = output.GetDesc()?;
                if desc.Monitor == monitor {
                    return Ok((adapter, output, desc.DesktopCoordinates));
                }
                o += 1;
            }
            a += 1;
        }
    }
    Err("монитор окна не найден среди выходов DXGI".into())
}

/// Центр клиентской области окна в координатах экрана.
fn window_center(window: WindowHandle) -> Option<(i32, i32, i32, i32)> {
    // SAFETY: структуры на стеке; окно может исчезнуть — тогда вызовы вернут ошибку.
    unsafe {
        let mut rect = RECT::default();
        GetClientRect(window.hwnd(), &mut rect).ok()?;
        let mut origin = POINT { x: 0, y: 0 };
        if !ClientToScreen(window.hwnd(), &mut origin).as_bool() {
            return None;
        }
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        Some((origin.x, origin.y, w, h))
    }
}

/// DXGI Desktop Duplication: кадры всего монитора; контрольная точка — центр окна.
fn run_dxgi(window: WindowHandle, sink: Arc<VideoSink>, stop: Arc<AtomicBool>, ready: Ready) {
    com_init();
    let mut notes = Vec::new();
    let setup = (|| -> Res<_> {
        let (adapter, output, desktop) = output_for_window(window)?;
        let adapter: IDXGIAdapter = adapter.cast()?;
        let (device, context) = create_device(Some(&adapter))?;
        notes.push(format!("адаптер: {}", adapter_name(&device)));
        let readback = Readback::new(&device, context)?;
        let output1: IDXGIOutput1 = output.cast()?;
        // SAFETY: дублирование выхода действительным устройством того же адаптера.
        let duplication = unsafe { output1.DuplicateOutput(&device)? };
        Ok((duplication, readback, desktop))
    })();
    let (duplication, readback, desktop) = match setup {
        Ok(v) => v,
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return;
        }
    };
    let (out_w, out_h) = (
        (desktop.right - desktop.left).max(1) as u32,
        (desktop.bottom - desktop.top).max(1) as u32,
    );
    notes.push(format!("захватывается весь монитор {out_w}×{out_h}"));
    let mut announced = false;
    let started = Instant::now();
    let mut ready = Some(ready);
    while !stop.load(Ordering::Relaxed) {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        // SAFETY: выходные указатели действительны; кадр освобождается ReleaseFrame.
        let acquired = unsafe { duplication.AcquireNextFrame(100, &mut info, &mut resource) };
        match acquired {
            Ok(()) => {
                // Нулевое время показа — обновился только указатель мыши.
                if info.LastPresentTime != 0 {
                    let luma = match (
                        resource
                            .as_ref()
                            .and_then(|r| r.cast::<ID3D11Texture2D>().ok()),
                        window_center(window),
                    ) {
                        (Some(texture), Some((x, y, w, h))) => {
                            let px = (x + w / 2 - desktop.left).clamp(0, out_w as i32 - 1) as u32;
                            let py = (y + h / 2 - desktop.top).clamp(0, out_h as i32 - 1) as u32;
                            readback.luma_at(&texture, px, py)
                        }
                        _ => -1,
                    };
                    sink.frame(
                        qpc_ticks_to_ns(info.LastPresentTime),
                        out_w,
                        out_h,
                        luma,
                        "dxgi",
                    );
                    if !announced {
                        announced = true;
                        if let Some(r) = ready.take() {
                            let _ = r.send(Ok(notes.clone()));
                        }
                    }
                }
                drop(resource);
                // SAFETY: освобождение кадра, полученного выше.
                unsafe {
                    let _ = duplication.ReleaseFrame();
                }
            }
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => {}
            Err(e) => {
                let text = format!("дублирование экрана прервано: {e}");
                match ready.take() {
                    Some(r) => {
                        let _ = r.send(Err(text));
                    }
                    None => eprintln!("s5cap: {text}"),
                }
                return;
            }
        }
        if !announced && started.elapsed() > Duration::from_secs(3) {
            if let Some(r) = ready.take() {
                let _ = r.send(Err("за 3 с не пришло ни одного кадра".to_owned()));
            }
            return;
        }
    }
}

/// GDI BitBlt: копирование клиентской области окна с экрана с частотой `fps`.
fn run_gdi(
    window: WindowHandle,
    fps: u32,
    sink: Arc<VideoSink>,
    stop: Arc<AtomicBool>,
    ready: Ready,
) {
    let Some((_, _, w, h)) = window_center(window) else {
        let _ = ready.send(Err("окно недоступно".to_owned()));
        return;
    };
    if w <= 0 || h <= 0 {
        let _ = ready.send(Err("у окна нулевая клиентская область".to_owned()));
        return;
    }
    // SAFETY: объекты GDI создаются и освобождаются в этом потоке.
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        if screen.is_invalid() || memory.is_invalid() || bitmap.is_invalid() {
            let _ = ready.send(Err("контекст или растр GDI не создан".to_owned()));
            return;
        }
        let previous = SelectObject(memory, HGDIOBJ(bitmap.0));
        let period = Duration::from_micros(1_000_000 / fps.max(1) as u64);
        let mut next = Instant::now();
        let mut ready = Some(ready);
        while !stop.load(Ordering::Relaxed) {
            let Some((x, y, _, _)) = window_center(window) else {
                break;
            };
            // Метка — момент перед копированием: на экране в этот момент уже то, что скопируется.
            let t_ns = now_ns();
            let copied = BitBlt(memory, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
            match copied {
                Ok(()) => {
                    let color = GetPixel(memory, w / 2, h / 2).0;
                    // COLORREF: 0x00BBGGRR.
                    let bgr = [(color >> 16) as u8, (color >> 8) as u8, color as u8, 255];
                    sink.frame(t_ns, w as u32, h as u32, luma_bgra(&bgr), "gdi");
                    if let Some(r) = ready.take() {
                        let _ = r.send(Ok(vec![format!(
                            "копируется клиентская область {w}×{h} с экрана, {fps} раз в секунду"
                        )]));
                    }
                }
                Err(e) => {
                    if let Some(r) = ready.take() {
                        let _ = r.send(Err(format!("BitBlt: {e}")));
                    }
                    break;
                }
            }
            next += period;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                next = now;
            }
        }
        SelectObject(memory, previous);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
    }
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

/// Запустить захват одним методом. Метод считается запущенным после первого кадра.
pub fn start(
    method: VideoMethod,
    window_id: u64,
    fps: u32,
    sink: Arc<VideoSink>,
) -> Result<(VideoCapture, Vec<String>), String> {
    let window = WindowHandle(window_id as isize);
    // Кадры всех трёх методов — в физических пикселях; масштаб экрана пишется рядом.
    let scale = window_scale(window.hwnd());
    sink.set_scale(scale);
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = channel();
    let thread_stop = stop.clone();
    let thread = std::thread::Builder::new()
        .name(format!("s5-video-{}", method.name()))
        .spawn(move || match method {
            VideoMethod::Wgc => run_wgc(window, sink, thread_stop, tx),
            VideoMethod::Dxgi => run_dxgi(window, sink, thread_stop, tx),
            VideoMethod::Gdi => run_gdi(window, fps, sink, thread_stop, tx),
        })
        .map_err(|e| format!("поток видео не создан: {e}"))?;
    match rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(mut notes)) => Ok((
            VideoCapture {
                stop,
                thread: Some(thread),
            },
            {
                notes.push(format!(
                    "масштаб экрана {:.0} %; размер кадра — в физических пикселях",
                    scale * 100.0
                ));
                notes
            },
        )),
        Ok(Err(e)) => {
            stop.store(true, Ordering::Relaxed);
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("метод не ответил за 8 с".to_owned())
        }
    }
}
