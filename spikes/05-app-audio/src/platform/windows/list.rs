// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Windows: окна верхнего уровня с PID и иконкой, дерево процессов, аудиосессии.

use std::collections::HashMap;
use std::ffi::c_void;

use windows::core::{Interface, BOOL, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, EnumDisplaySettingsW, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DEVMODEW, DIB_RGB_COLORS, ENUM_CURRENT_SETTINGS, HGDIOBJ,
};
use windows::Win32::Media::Audio::{
    eConsole, eRender, AudioSessionStateActive, IAudioClient, IAudioSessionControl2,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, EnumChildWindows, EnumWindows, GetClassLongPtrW, GetClassNameW, GetIconInfo,
    GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SendMessageTimeoutW, GCLP_HICON,
    GCLP_HICONSM, GWL_EXSTYLE, HICON, ICONINFO, ICON_BIG, ICON_SMALL2, SMTO_ABORTIFHUNG,
    WM_GETICON, WS_EX_TOOLWINDOW,
};

use crate::model::{AudioNodeInfo, EnvInfo, Icon, ProcInfo, Res, WindowInfo};

/// Подключить поток к COM (многопоточный апартамент). Повторный вызов безвреден.
pub fn com_init() {
    // SAFETY: инициализация COM для текущего потока; результат «уже инициализирован» допустим.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn utf16_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

unsafe extern "system" fn collect_windows(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam — указатель на Vec<HWND>, живущий на время EnumWindows.
    let list = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
    list.push(hwnd);
    BOOL(1)
}

struct ChildSearch {
    frame_pid: u32,
    found: Option<u32>,
}

unsafe extern "system" fn find_foreign_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: lparam — указатель на ChildSearch, живущий на время EnumChildWindows.
    let ctx = unsafe { &mut *(lparam.0 as *mut ChildSearch) };
    let mut pid = 0u32;
    // SAFETY: hwnd получен от системы.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid != 0 && pid != ctx.frame_pid {
        ctx.found = Some(pid);
        return BOOL(0);
    }
    BOOL(1)
}

/// Полный путь исполняемого файла процесса. В сводки и журналы не попадает.
fn exe_path(pid: u32) -> Option<String> {
    // SAFETY: дескриптор закрывается ниже; буфер и его размер согласованы.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(handle);
        if !ok {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

/// Короткое имя исполняемого файла процесса (без пути).
fn exe_name(pid: u32) -> Option<String> {
    let full = exe_path(pid)?;
    Some(full.rsplit(['\\', '/']).next().unwrap_or("").to_owned())
}

/// Иконка исполняемого файла процесса — запасной путь для окон без своей иконки.
fn exe_icon(pid: u32) -> Option<Icon> {
    let path: Vec<u16> = exe_path(pid)?.encode_utf16().chain(Some(0)).collect();
    let mut info = SHFILEINFOW::default();
    // SAFETY: путь завершён нулём, структура на стеке; полученную иконку освобождаем.
    unsafe {
        let got = SHGetFileInfoW(
            PCWSTR(path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if got == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let icon = hicon_to_rgba(info.hIcon);
        let _ = DestroyIcon(info.hIcon);
        icon
    }
}

fn hicon_to_rgba(hicon: HICON) -> Option<Icon> {
    // SAFETY: объекты GDI, полученные от системы, освобождаются в конце; буфер пикселей
    // вмещает width × height × 4 байт.
    unsafe {
        let mut info = ICONINFO::default();
        GetIconInfo(hicon, &mut info).ok()?;
        let cleanup = |info: &ICONINFO| {
            if !info.hbmColor.is_invalid() {
                let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
            }
            if !info.hbmMask.is_invalid() {
                let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
            }
        };
        if info.hbmColor.is_invalid() {
            cleanup(&info);
            return None;
        }
        let mut bm = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(info.hbmColor.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut bm as *mut BITMAP).cast::<c_void>()),
        );
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        if got == 0 || w <= 0 || h <= 0 || w > 1024 || h > 1024 {
            cleanup(&info);
            return None;
        }
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let hdc = GetDC(None);
        let lines = GetDIBits(
            hdc,
            info.hbmColor,
            0,
            h as u32,
            Some(px.as_mut_ptr().cast::<c_void>()),
            &mut bmi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, hdc);
        cleanup(&info);
        if lines == 0 {
            return None;
        }
        // BGRA → RGBA; у старых иконок альфа-канал пуст — считаем их непрозрачными.
        let no_alpha = px.as_chunks::<4>().0.iter().all(|p| p[3] == 0);
        for p in px.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
            if no_alpha {
                p[3] = 255;
            }
        }
        Some(Icon {
            width: w as u32,
            height: h as u32,
            rgba: px,
        })
    }
}

/// Иконка окна: сначала у самого окна, затем у его класса, затем у исполняемого файла.
fn window_icon(hwnd: HWND, pid: u32) -> (Option<Icon>, &'static str) {
    // SAFETY: запросы к окну с тайм-аутом; дескриптор иконки принадлежит окну и не освобождается.
    unsafe {
        for (kind, source) in [
            (ICON_BIG, "WM_GETICON, большая"),
            (ICON_SMALL2, "WM_GETICON, малая"),
        ] {
            let mut result = 0usize;
            let _ = SendMessageTimeoutW(
                hwnd,
                WM_GETICON,
                WPARAM(kind as usize),
                LPARAM(0),
                SMTO_ABORTIFHUNG,
                100,
                Some(&mut result),
            );
            if result != 0 {
                if let Some(icon) = hicon_to_rgba(HICON(result as *mut c_void)) {
                    return (Some(icon), source);
                }
            }
        }
        for (index, source) in [
            (GCLP_HICON, "класс окна, большая"),
            (GCLP_HICONSM, "класс окна, малая"),
        ] {
            let handle = GetClassLongPtrW(hwnd, index);
            if handle != 0 {
                if let Some(icon) = hicon_to_rgba(HICON(handle as *mut c_void)) {
                    return (Some(icon), source);
                }
            }
        }
    }
    match exe_icon(pid) {
        Some(icon) => (Some(icon), "исполняемый файл"),
        None => (None, "нет"),
    }
}

/// Масштаб экрана, на котором находится окно: 96 точек на дюйм — это 100 %.
pub fn window_scale(hwnd: HWND) -> f32 {
    // SAFETY: чтение свойства окна; для исчезнувшего окна функция вернёт 0.
    unsafe { GetDpiForWindow(hwnd) as f32 / 96.0 }
}

/// Окна верхнего уровня: видимые, не служебные, с заголовком. Размеры окон — в
/// физических пикселях (процесс объявляет себя знающим о масштабе в `init`).
pub fn list_windows(with_icons: bool) -> Res<Vec<WindowInfo>> {
    let mut hwnds: Vec<HWND> = Vec::new();
    // SAFETY: обратный вызов получает указатель на hwnds, живущий до конца вызова.
    unsafe {
        EnumWindows(
            Some(collect_windows),
            LPARAM(&mut hwnds as *mut Vec<HWND> as isize),
        )?;
    }
    let mut out = Vec::new();
    for hwnd in hwnds {
        // SAFETY: чтение свойств окна; буферы и их размеры согласованы.
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                continue;
            }
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
                continue;
            }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                (&mut cloaked as *mut u32).cast::<c_void>(),
                4,
            );
            if cloaked != 0 {
                continue;
            }
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                continue;
            }
            let mut text = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, &mut text).max(0) as usize;
            let title = String::from_utf16_lossy(&text[..n.min(text.len())]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut notes = Vec::new();

            // Окно-рамка упакованного приложения принадлежит системному процессу;
            // процесс приложения — у дочернего окна.
            let mut class = [0u16; 256];
            let class_len = GetClassNameW(hwnd, &mut class).max(0) as usize;
            if utf16_to_string(&class[..class_len.min(class.len())]) == "ApplicationFrameWindow" {
                let mut search = ChildSearch {
                    frame_pid: pid,
                    found: None,
                };
                let _ = EnumChildWindows(
                    Some(hwnd),
                    Some(find_foreign_child),
                    LPARAM(&mut search as *mut ChildSearch as isize),
                );
                match search.found {
                    Some(real) => {
                        notes.push(format!(
                            "окно-рамка системного процесса {pid}; процесс приложения взят у дочернего окна"
                        ));
                        pid = real;
                    }
                    None => notes.push(
                        "окно-рамка системного процесса; процесс приложения не найден".to_owned(),
                    ),
                }
            }
            if IsIconic(hwnd).as_bool() {
                notes.push("окно свёрнуто".to_owned());
            }

            let mut rect = RECT::default();
            if DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&mut rect as *mut RECT).cast::<c_void>(),
                std::mem::size_of::<RECT>() as u32,
            )
            .is_err()
            {
                let _ = GetWindowRect(hwnd, &mut rect);
            }
            let icon = if with_icons {
                let (icon, source) = window_icon(hwnd, pid);
                notes.push(format!("иконка: {source}"));
                icon
            } else {
                None
            };
            out.push(WindowInfo {
                id: hwnd.0 as usize as u64,
                pid,
                title,
                app: exe_name(pid).unwrap_or_default(),
                width: (rect.right - rect.left).max(0) as u32,
                height: (rect.bottom - rect.top).max(0) as u32,
                scale: window_scale(hwnd),
                icon,
                notes,
            });
        }
    }
    Ok(out)
}

fn snapshot() -> Res<HashMap<u32, (u32, String)>> {
    let mut map = HashMap::new();
    // SAFETY: снимок закрывается ниже; структура записи инициализирована размером.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                map.insert(
                    entry.th32ProcessID,
                    (entry.th32ParentProcessID, utf16_to_string(&entry.szExeFile)),
                );
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    Ok(map)
}

/// Время создания процесса в единицах FILETIME.
fn creation_time(pid: u32) -> Option<u64> {
    // SAFETY: дескриптор закрывается ниже; структуры времени — на стеке.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let (mut created, mut exited, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        let ok = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).is_ok();
        let _ = CloseHandle(handle);
        ok.then_some(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
    }
}

/// Процесс `root` и все его потомки.
///
/// Номер родителя в снимке — это PID на момент запуска потомка: если родитель
/// завершился, а номер достался другому процессу, связь ложная. Поэтому потомок
/// принимается, только если создан не раньше родителя.
pub fn process_tree(root: u32) -> Res<Vec<ProcInfo>> {
    let procs = snapshot()?;
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
        if depth >= 32 {
            continue;
        }
        let parent_created = creation_time(pid);
        for (child, (parent, _)) in &procs {
            if *parent != pid || *child == pid || *child == 0 {
                continue;
            }
            let genuine = match (parent_created, creation_time(*child)) {
                (Some(p), Some(c)) => c >= p,
                _ => true,
            };
            if genuine && !out.iter().any(|p| p.pid == *child) {
                queue.push((*child, depth + 1));
            }
        }
    }
    out.sort_by_key(|p| (p.depth, p.pid));
    Ok(out)
}

/// Аудиосессии всех активных устройств вывода с их PID.
pub fn audio_nodes() -> Res<Vec<AudioNodeInfo>> {
    com_init();
    let mut out = Vec::new();
    // SAFETY: вызовы COM по документации; интерфейсы освобождаются при выходе из области.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        for d in 0..devices.GetCount()? {
            let device = devices.Item(d)?;
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions = manager.GetSessionEnumerator()?;
            for i in 0..sessions.GetCount()? {
                let control = sessions.GetSession(i)?;
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let pid = control2.GetProcessId().unwrap_or(0);
                let active = control
                    .GetState()
                    .map(|s| s == AudioSessionStateActive)
                    .unwrap_or(false);
                let system_sounds = control2.IsSystemSoundsSession().0 == 0;
                out.push(AudioNodeInfo {
                    pid,
                    node_id: ((d as u64) << 16) | i as u64,
                    kind: "сессия WASAPI".to_owned(),
                    active,
                    extra: vec![
                        ("устройство".to_owned(), d.to_string()),
                        ("системные звуки".to_owned(), system_sounds.to_string()),
                    ],
                });
            }
        }
    }
    Ok(out)
}

fn os_version() -> String {
    // «ver» печатает номер сборки с ревизией; слова вокруг зависят от языка системы.
    let text = std::process::Command::new("cmd")
        .args(["/c", "ver"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    text.split(['[', ']'])
        .nth(1)
        .map(|inner| {
            inner
                .split_whitespace()
                .filter(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

/// Сведения о стенде.
pub fn env_info() -> EnvInfo {
    com_init();
    let mut details = Vec::new();
    // SAFETY: вызовы COM и DXGI по документации; память формата освобождается CoTaskMemFree.
    unsafe {
        if let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() {
            let mut i = 0;
            while let Ok(adapter) = factory.EnumAdapters1(i) {
                if let Ok(desc) = adapter.GetDesc1() {
                    let mut outputs = 0;
                    while adapter.EnumOutputs(outputs).is_ok() {
                        outputs += 1;
                    }
                    details.push((
                        format!("видеоадаптер {i}"),
                        format!("{}; выходов: {outputs}", utf16_to_string(&desc.Description)),
                    ));
                }
                i += 1;
            }
        }
        let mut mode = DEVMODEW {
            dmSize: std::mem::size_of::<DEVMODEW>() as u16,
            ..Default::default()
        };
        if EnumDisplaySettingsW(PCWSTR::null(), ENUM_CURRENT_SETTINGS, &mut mode).as_bool() {
            details.push((
                "основной экран".to_owned(),
                format!(
                    "{}×{} физических пикселей, {} Гц",
                    mode.dmPelsWidth, mode.dmPelsHeight, mode.dmDisplayFrequency
                ),
            ));
        }
        let mix = (|| -> windows::core::Result<String> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
            let format = client.GetMixFormat()?;
            let (rate, channels, bits) = (
                (*format).nSamplesPerSec,
                (*format).nChannels,
                (*format).wBitsPerSample,
            );
            CoTaskMemFree(Some(format.cast::<c_void>()));
            Ok(format!("{rate} Гц, каналов {channels}, {bits} бит"))
        })();
        details.push((
            "формат смешивания устройства вывода".to_owned(),
            mix.unwrap_or_else(|e| format!("недоступен: {e}")),
        ));
    }
    EnvInfo {
        os: "Windows".to_owned(),
        os_version: os_version(),
        arch: std::env::consts::ARCH.to_owned(),
        session: String::new(),
        details,
    }
}
