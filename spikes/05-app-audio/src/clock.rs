// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Единая монотонная шкала времени спайка, в наносекундах.
//!
//! На каждой ОС это те же часы, в которых система сама ставит метки кадрам и звуковым
//! буферам: Windows — QueryPerformanceCounter, macOS — mach_absolute_time (часы хоста
//! CoreMedia), Linux — CLOCK_MONOTONIC. Поэтому метки захвата и метки тестового
//! источника сравнимы без пересчёта между процессами.

#[cfg(target_os = "macos")]
mod mach {
    #[repr(C)]
    pub struct TimebaseInfo {
        pub numer: u32,
        pub denom: u32,
    }
    extern "C" {
        pub fn mach_absolute_time() -> u64;
        pub fn mach_timebase_info(info: *mut TimebaseInfo) -> i32;
    }
}

/// Текущее время по монотонной шкале, нс.
#[cfg(target_os = "macos")]
pub fn now_ns() -> u64 {
    // SAFETY: функция без аргументов и побочных эффектов.
    mach_ticks_to_ns(unsafe { mach::mach_absolute_time() })
}

/// Перевод отсчётов mach_absolute_time в наносекунды.
#[cfg(target_os = "macos")]
pub fn mach_ticks_to_ns(ticks: u64) -> u64 {
    use std::sync::OnceLock;
    static TIMEBASE: OnceLock<(u32, u32)> = OnceLock::new();
    let (numer, denom) = *TIMEBASE.get_or_init(|| {
        let mut info = mach::TimebaseInfo { numer: 0, denom: 0 };
        // SAFETY: info — корректная структура на стеке с раскладкой mach_timebase_info_data_t.
        unsafe { mach::mach_timebase_info(&mut info) };
        (info.numer.max(1), info.denom.max(1))
    });
    ((ticks as u128) * (numer as u128) / (denom as u128)) as u64
}

/// Текущее время по монотонной шкале, нс.
#[cfg(target_os = "linux")]
pub fn now_ns() -> u64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: ts — корректная структура на стеке.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    (ts.tv_sec as u64) * 1_000_000_000 + ts.tv_nsec as u64
}

/// Текущее время по монотонной шкале, нс.
#[cfg(windows)]
pub fn now_ns() -> u64 {
    use windows::Win32::System::Performance::QueryPerformanceCounter;
    let mut ticks = 0i64;
    // SAFETY: ticks — корректная переменная на стеке; вызов не падает на поддерживаемых Windows.
    let _ = unsafe { QueryPerformanceCounter(&mut ticks) };
    qpc_ticks_to_ns(ticks)
}

/// Перевод отсчётов QPC в наносекунды.
#[cfg(windows)]
pub fn qpc_ticks_to_ns(ticks: i64) -> u64 {
    use std::sync::OnceLock;
    use windows::Win32::System::Performance::QueryPerformanceFrequency;
    static FREQ: OnceLock<i64> = OnceLock::new();
    let freq = *FREQ.get_or_init(|| {
        let mut f = 0i64;
        // SAFETY: f — корректная переменная на стеке.
        let _ = unsafe { QueryPerformanceFrequency(&mut f) };
        f.max(1)
    });
    ((ticks.max(0) as u128) * 1_000_000_000u128 / (freq as u128)) as u64
}

/// Перевод интервалов по 100 нс (единица WASAPI и WinRT TimeSpan) в наносекунды.
pub fn hns_to_ns(hns: i64) -> u64 {
    (hns.max(0) as u64) * 100
}
