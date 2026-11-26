// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Linux: дерево процессов из /proc, окна X11, сведения о стенде.

use std::collections::HashMap;
use std::fs;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, Window};

use crate::model::{EnvInfo, Icon, ProcInfo, Res, WindowInfo};

/// Все процессы: PID → (PID родителя, имя).
pub fn all_procs() -> HashMap<u32, (u32, String)> {
    let mut map = HashMap::new();
    let Ok(dir) = fs::read_dir("/proc") else {
        return map;
    };
    for entry in dir.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(stat) = fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        // Формат: «pid (имя) состояние ppid …»; имя может содержать пробелы и скобки.
        let (Some(open), Some(close)) = (stat.find('('), stat.rfind(')')) else {
            continue;
        };
        let name = stat[open + 1..close].to_owned();
        let ppid = stat[close + 1..]
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        map.insert(pid, (ppid, name));
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
        if depth >= 32 {
            continue;
        }
        for (child, (parent, _)) in &procs {
            if *parent == pid && *child != pid {
                queue.push((*child, depth + 1));
            }
        }
    }
    out.sort_by_key(|p| (p.depth, p.pid));
    Ok(out)
}

/// Является ли `pid` процессом `root` или его потомком (по цепочке родителей).
pub fn is_in_tree(pid: u32, root: u32) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        if current == root {
            return true;
        }
        if current <= 1 {
            return false;
        }
        let Ok(stat) = fs::read_to_string(format!("/proc/{current}/stat")) else {
            return false;
        };
        let Some(close) = stat.rfind(')') else {
            return false;
        };
        current = stat[close + 1..]
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
    }
    false
}

/// Вид сеанса: `wayland`, `x11` или пусто.
pub fn session_type() -> String {
    std::env::var("XDG_SESSION_TYPE").unwrap_or_default()
}

/// Идёт ли сеанс X11. Если вид сеанса не объявлен (виртуальный X-сервер в
/// контейнере), сеансом X11 считается «есть DISPLAY и нет WAYLAND_DISPLAY».
pub fn x11_session() -> bool {
    match session_type().as_str() {
        "x11" => true,
        "wayland" => false,
        _ => std::env::var_os("DISPLAY").is_some() && std::env::var_os("WAYLAND_DISPLAY").is_none(),
    }
}

fn text_property(
    conn: &impl Connection,
    window: Window,
    property: u32,
    kind: u32,
) -> Option<String> {
    let reply = conn
        .get_property(false, window, property, kind, 0, 4096)
        .ok()?
        .reply()
        .ok()?;
    if reply.value.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&reply.value).into_owned())
}

/// Самая крупная иконка из _NET_WM_ICON (ARGB, по 32 бита на точку).
fn window_icon(conn: &impl Connection, window: Window, atom: u32) -> Option<Icon> {
    let reply = conn
        .get_property(false, window, atom, AtomEnum::CARDINAL, 0, 1 << 20)
        .ok()?
        .reply()
        .ok()?;
    let words: Vec<u32> = reply.value32()?.collect();
    let mut best: Option<Icon> = None;
    let mut i = 0usize;
    while i + 2 <= words.len() {
        let (w, h) = (words[i] as usize, words[i + 1] as usize);
        let count = w.checked_mul(h)?;
        if w == 0 || h == 0 || i + 2 + count > words.len() {
            break;
        }
        if best.as_ref().is_none_or(|b| (b.width as usize) < w) {
            let rgba = words[i + 2..i + 2 + count]
                .iter()
                .flat_map(|argb| {
                    [
                        (argb >> 16) as u8,
                        (argb >> 8) as u8,
                        *argb as u8,
                        (argb >> 24) as u8,
                    ]
                })
                .collect();
            best = Some(Icon {
                width: w as u32,
                height: h as u32,
                rgba,
            });
        }
        i += 2 + count;
    }
    best
}

/// Окна верхнего уровня, которые видит X-сервер.
///
/// В сеансе Wayland это только окна программ, работающих через XWayland: списка
/// остальных окон у приложения нет, их выбирает пользователь в системном окне портала.
pub fn list_windows(with_icons: bool) -> Res<Vec<WindowInfo>> {
    let Ok((conn, screen_num)) = x11rb::connect(None) else {
        return Ok(Vec::new());
    };
    let root = conn.setup().roots[screen_num].root;
    let atom =
        |name: &str| -> Res<u32> { Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom) };
    let client_list = atom("_NET_CLIENT_LIST")?;
    let wm_name = atom("_NET_WM_NAME")?;
    let wm_pid = atom("_NET_WM_PID")?;
    let wm_icon = atom("_NET_WM_ICON")?;
    let utf8 = atom("UTF8_STRING")?;
    let via_xwayland = session_type() == "wayland";

    let reply = conn
        .get_property(false, root, client_list, AtomEnum::WINDOW, 0, 4096)?
        .reply()?;
    let windows: Vec<Window> = reply.value32().map(|v| v.collect()).unwrap_or_default();
    let mut out = Vec::new();
    for window in windows {
        let title = text_property(&conn, window, wm_name, utf8)
            .or_else(|| {
                text_property(
                    &conn,
                    window,
                    AtomEnum::WM_NAME.into(),
                    AtomEnum::STRING.into(),
                )
            })
            .unwrap_or_default();
        let pid = conn
            .get_property(false, window, wm_pid, AtomEnum::CARDINAL, 0, 1)
            .ok()
            .and_then(|c| c.reply().ok())
            .and_then(|r| r.value32().and_then(|mut v| v.next()))
            .unwrap_or(0);
        let class = text_property(
            &conn,
            window,
            AtomEnum::WM_CLASS.into(),
            AtomEnum::STRING.into(),
        )
        .map(|s| s.split('\0').next().unwrap_or("").to_owned())
        .unwrap_or_default();
        let (width, height) = conn
            .get_geometry(window)
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|g| (g.width as u32, g.height as u32))
            .unwrap_or((0, 0));
        let mut notes = Vec::new();
        if pid == 0 {
            notes.push("окно не сообщает PID (_NET_WM_PID)".to_owned());
        }
        if via_xwayland {
            notes.push("окно программы под XWayland".to_owned());
        }
        out.push(WindowInfo {
            id: window as u64,
            pid,
            title,
            app: class,
            width,
            height,
            scale: 0.0,
            icon: if with_icons {
                window_icon(&conn, window, wm_icon)
            } else {
                None
            },
            notes,
        });
    }
    Ok(out)
}

fn command_line(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // Первая строка вывода `--version` — имя программы; версия — в строке с цифрами.
    text.lines()
        .map(str::trim)
        .find(|l| l.chars().any(|c| c.is_ascii_digit()))
        .map(str::to_owned)
}

/// Есть ли в сеансе X11 программа, которая сама составляет картинку экрана из окон.
/// По соглашению оконных менеджеров она владеет выделением `_NET_WM_CM_S<экран>`.
fn compositing_manager() -> String {
    let answer = || -> Res<bool> {
        let (conn, screen_num) = x11rb::connect(None)?;
        let atom = conn
            .intern_atom(false, format!("_NET_WM_CM_S{screen_num}").as_bytes())?
            .reply()?
            .atom;
        let owner = conn.get_selection_owner(atom)?.reply()?.owner;
        Ok(owner != x11rb::NONE)
    };
    match answer() {
        Ok(true) => "есть".to_owned(),
        Ok(false) => "нет".to_owned(),
        Err(e) => format!("не определено: {e}"),
    }
}

/// Сведения о стенде.
pub fn env_info() -> EnvInfo {
    let mut details = Vec::new();
    let os_release = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let pretty = os_release
        .lines()
        .find_map(|l| l.strip_prefix("PRETTY_NAME="))
        .map(|v| v.trim_matches('"').to_owned())
        .unwrap_or_default();
    if let Ok(kernel) = fs::read_to_string("/proc/sys/kernel/osrelease") {
        details.push(("ядро".to_owned(), kernel.trim().to_owned()));
    }
    if let Ok(desktop) = std::env::var("XDG_CURRENT_DESKTOP") {
        details.push(("рабочий стол".to_owned(), desktop));
    }
    for (label, program) in [("PipeWire", "pipewire"), ("WirePlumber", "wireplumber")] {
        if let Some(version) = command_line(program, &["--version"]) {
            details.push((label.to_owned(), version));
        }
    }
    // Видеоадаптеры: драйвер из /sys, без названий моделей.
    if let Ok(dir) = fs::read_dir("/sys/class/drm") {
        let mut drivers = Vec::new();
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            let uevent = fs::read_to_string(entry.path().join("device/uevent")).unwrap_or_default();
            if let Some(driver) = uevent.lines().find_map(|l| l.strip_prefix("DRIVER=")) {
                drivers.push(driver.to_owned());
            }
        }
        if !drivers.is_empty() {
            details.push(("драйверы видеоадаптеров".to_owned(), drivers.join(", ")));
        }
    }
    if x11_session() {
        details.push((
            "составление картинки оконным менеджером".to_owned(),
            compositing_manager(),
        ));
    }
    EnvInfo {
        os: "Linux".to_owned(),
        os_version: pretty,
        arch: std::env::consts::ARCH.to_owned(),
        session: session_type(),
        details,
    }
}
