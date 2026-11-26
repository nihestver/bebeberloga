// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Windows: захват звука через WASAPI.
//!
//! Три способа, по убыванию точности:
//! 1. process loopback по PID с деревом процессов — звук приложения;
//! 2. process loopback с исключением дерева собственного процесса — вся система
//!    без программы захвата;
//! 3. обычный loopback устройства вывода — вся система как есть.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use windows::core::{implement, IUnknown, Interface, Ref, HRESULT, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eConsole, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::System::Threading::{
    CreateEventW, GetCurrentProcessId, SetEvent, WaitForSingleObject,
};

use super::list::com_init;
use crate::clock::now_ns;
use crate::model::{OutputState, Res, CHANNELS, SAMPLE_RATE};
use crate::rec::{AudioSink, FLAG_DISCONTINUITY, FLAG_SILENT, FLAG_TIMESTAMP_FALLBACK};

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const VT_BLOB: u16 = 65;
const BUFFER_FLAG_DISCONTINUITY: u32 = 1;
const BUFFER_FLAG_SILENT: u32 = 2;
const BUFFER_FLAG_TIMESTAMP_ERROR: u32 = 4;
/// Длительность буфера, которую просим у системы: 20 мс в единицах по 100 нс.
const BUFFER_HNS: i64 = 200_000;

/// Способ захвата звука.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioMethod {
    /// Process loopback: процесс `pid` и его потомки.
    ProcessTree(u32),
    /// Process loopback: всё, кроме дерева собственного процесса.
    SystemExceptSelf,
    /// Loopback устройства вывода по умолчанию.
    Endpoint,
}

impl AudioMethod {
    pub fn name(self) -> &'static str {
        match self {
            AudioMethod::ProcessTree(_) => "process-loopback",
            AudioMethod::SystemExceptSelf => "system-exclude-self",
            AudioMethod::Endpoint => "endpoint-loopback",
        }
    }

    pub fn describe(self) -> &'static str {
        match self {
            AudioMethod::ProcessTree(_) => "wasapi: process loopback, дерево процессов",
            AudioMethod::SystemExceptSelf => {
                "wasapi: process loopback, система без собственного процесса"
            }
            AudioMethod::Endpoint => "wasapi: loopback устройства вывода, вся система",
        }
    }
}

/// PROPVARIANT с типом VT_BLOB в раскладке C: заголовок 8 байт, затем размер и указатель.
#[repr(C)]
struct BlobVariant {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    size: u32,
    data: *mut u8,
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationDone {
    /// Событие, которое взводится по завершении активации (значение HANDLE).
    event: usize,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationDone_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        // SAFETY: событие создано вызывающей стороной и живо до конца ожидания.
        unsafe { SetEvent(HANDLE(self.event as *mut c_void)) }
    }
}

/// Активировать клиент process loopback.
fn activate_process_loopback(pid: u32, mode: PROCESS_LOOPBACK_MODE) -> Res<IAudioClient> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: mode,
            },
        },
    };
    let variant = BlobVariant {
        vt: VT_BLOB,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        data: (&mut params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast::<u8>(),
    };
    // SAFETY: параметры и событие живут до конца функции; BlobVariant совпадает по
    // раскладке с PROPVARIANT типа VT_BLOB.
    unsafe {
        let event = CreateEventW(None, false, false, PCWSTR::null())?;
        let handler: IActivateAudioInterfaceCompletionHandler = ActivationDone {
            event: event.0 as usize,
        }
        .into();
        let operation = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some((&variant as *const BlobVariant).cast::<PROPVARIANT>()),
            &handler,
        );
        let operation = match operation {
            Ok(op) => op,
            Err(e) => {
                let _ = CloseHandle(event);
                return Err(format!("активация process loopback отклонена: {e}").into());
            }
        };
        let waited = WaitForSingleObject(event, 5000);
        let _ = CloseHandle(event);
        if waited != WAIT_OBJECT_0 {
            return Err("активация process loopback не завершилась за 5 с".into());
        }
        let mut status = HRESULT(0);
        let mut unknown: Option<IUnknown> = None;
        operation.GetActivateResult(&mut status, &mut unknown)?;
        if status.is_err() {
            return Err(format!(
                "активация process loopback: {}",
                windows::core::Error::from_hresult(status)
            )
            .into());
        }
        let unknown = unknown.ok_or("активация process loopback вернула пустой объект")?;
        Ok(unknown.cast::<IAudioClient>()?)
    }
}

/// Формат, в котором спайк получает сэмплы от системы.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Wire {
    Float32,
    Pcm16,
}

fn wave_format(wire: Wire) -> WAVEFORMATEX {
    let (tag, bits) = match wire {
        Wire::Float32 => (WAVE_FORMAT_IEEE_FLOAT, 32u16),
        Wire::Pcm16 => (WAVE_FORMAT_PCM, 16u16),
    };
    let block = CHANNELS as u16 * bits / 8;
    WAVEFORMATEX {
        wFormatTag: tag,
        nChannels: CHANNELS as u16,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * block as u32,
        nBlockAlign: block,
        wBitsPerSample: bits,
        cbSize: 0,
    }
}

/// Инициализировать клиент в формате спайка; перебираются варианты формата и флагов.
fn initialize(client: &IAudioClient, event_driven: bool, notes: &mut Vec<String>) -> Res<Wire> {
    let base = AUDCLNT_STREAMFLAGS_LOOPBACK
        | if event_driven {
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        } else {
            0
        };
    let convert = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    let mut last = String::new();
    for (wire, flags, label) in [
        (
            Wire::Float32,
            base | convert,
            "float32, с преобразованием формата системой",
        ),
        (
            Wire::Pcm16,
            base | convert,
            "PCM16, с преобразованием формата системой",
        ),
        (Wire::Float32, base, "float32, без преобразования"),
        (Wire::Pcm16, base, "PCM16, без преобразования"),
    ] {
        let format = wave_format(wire);
        // SAFETY: формат живёт на стеке на время вызова.
        match unsafe {
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                flags,
                BUFFER_HNS,
                0,
                &format,
                None,
            )
        } {
            Ok(()) => {
                notes.push(format!("формат захвата: 48000 Гц, стерео, {label}"));
                return Ok(wire);
            }
            Err(e) => {
                notes.push(format!("вариант «{label}» отклонён: {e}"));
                last = e.to_string();
            }
        }
    }
    Err(format!("клиент звука не инициализирован: {last}").into())
}

fn open_endpoint() -> Res<IAudioClient> {
    // SAFETY: вызовы COM по документации.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        Ok(device.Activate::<IAudioClient>(CLSCTX_ALL, None)?)
    }
}

fn endpoint_volume() -> Res<IAudioEndpointVolume> {
    com_init();
    // SAFETY: вызовы COM по документации.
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        Ok(device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)?)
    }
}

/// Состояние устройства вывода по умолчанию: выключен ли звук и громкость.
pub fn output_state() -> Res<OutputState> {
    let volume = endpoint_volume()?;
    // SAFETY: чтение свойств действительного интерфейса.
    unsafe {
        Ok(OutputState {
            muted: volume.GetMute()?.as_bool(),
            volume: volume.GetMasterVolumeLevelScalar()?,
        })
    }
}

/// Задать состояние устройства вывода по умолчанию.
pub fn set_output_state(state: &OutputState) -> Res<()> {
    let volume = endpoint_volume()?;
    // SAFETY: запись свойств действительного интерфейса; контекст события не нужен.
    unsafe {
        volume.SetMasterVolumeLevelScalar(state.volume.clamp(0.0, 1.0), std::ptr::null())?;
        volume.SetMute(state.muted, std::ptr::null())?;
    }
    Ok(())
}

/// Цикл чтения буферов до сигнала остановки.
fn capture_loop(
    client: &IAudioClient,
    wire: Wire,
    event: Option<HANDLE>,
    sink: &AudioSink,
    stop: &AtomicBool,
) -> Res<()> {
    // SAFETY: буфер от GetBuffer действителен до ReleaseBuffer; число кадров и формат
    // заданы при инициализации.
    unsafe {
        let capture: IAudioCaptureClient = client.GetService()?;
        client.Start()?;
        let mut scratch: Vec<f32> = Vec::new();
        while !stop.load(Ordering::Relaxed) {
            match event {
                // Событие может не прийти, пока приложение молчит: ждём недолго и опрашиваем.
                Some(e) => {
                    let _ = WaitForSingleObject(e, 50);
                }
                None => std::thread::sleep(Duration::from_millis(5)),
            }
            loop {
                let pending = capture.GetNextPacketSize()?;
                if pending == 0 {
                    break;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let (mut frames, mut flags) = (0u32, 0u32);
                let (mut device_pos, mut qpc_hns) = (0u64, 0u64);
                capture.GetBuffer(
                    &mut data,
                    &mut frames,
                    &mut flags,
                    Some(&mut device_pos),
                    Some(&mut qpc_hns),
                )?;
                let samples = frames as usize * CHANNELS;
                scratch.clear();
                scratch.resize(samples, 0.0);
                if flags & BUFFER_FLAG_SILENT == 0 && !data.is_null() {
                    match wire {
                        Wire::Float32 => {
                            let src = std::slice::from_raw_parts(data.cast::<f32>(), samples);
                            scratch.copy_from_slice(src);
                        }
                        Wire::Pcm16 => {
                            let src = std::slice::from_raw_parts(data.cast::<i16>(), samples);
                            for (dst, s) in scratch.iter_mut().zip(src) {
                                *dst = *s as f32 / 32768.0;
                            }
                        }
                    }
                }
                let mut out_flags = 0u32;
                if flags & BUFFER_FLAG_DISCONTINUITY != 0 {
                    out_flags |= FLAG_DISCONTINUITY;
                }
                if flags & BUFFER_FLAG_SILENT != 0 {
                    out_flags |= FLAG_SILENT;
                }
                // Метка системы — счётчик QPC на момент первого кадра, в единицах по 100 нс.
                let t_ns = if flags & BUFFER_FLAG_TIMESTAMP_ERROR != 0 || qpc_hns == 0 {
                    out_flags |= FLAG_TIMESTAMP_FALLBACK;
                    now_ns().saturating_sub(frames as u64 * 1_000_000_000 / SAMPLE_RATE as u64)
                } else {
                    qpc_hns * 100
                };
                sink.push(t_ns, &scratch, out_flags);
                capture.ReleaseBuffer(frames)?;
            }
        }
        let _ = client.Stop();
    }
    Ok(())
}

/// Поток захвата: активация, инициализация и чтение. Результат запуска уходит в `ready`.
fn capture_thread(
    method: AudioMethod,
    sink: Arc<AudioSink>,
    stop: Arc<AtomicBool>,
    ready: Sender<Result<Vec<String>, String>>,
) {
    com_init();
    let mut notes = Vec::new();
    let setup = (|| -> Res<(IAudioClient, Wire, Option<HANDLE>)> {
        let (client, event_driven) = match method {
            AudioMethod::ProcessTree(pid) => (
                activate_process_loopback(pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE)?,
                true,
            ),
            AudioMethod::SystemExceptSelf => (
                // SAFETY: функция без аргументов.
                activate_process_loopback(
                    unsafe { GetCurrentProcessId() },
                    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
                )?,
                true,
            ),
            AudioMethod::Endpoint => (open_endpoint()?, false),
        };
        if method == AudioMethod::Endpoint {
            // SAFETY: формат смешивания возвращается в памяти COM и освобождается здесь.
            unsafe {
                if let Ok(mix) = client.GetMixFormat() {
                    // Структура упакована: поля копируются в локальные переменные.
                    let (rate, count, bits) = (
                        (*mix).nSamplesPerSec,
                        (*mix).nChannels,
                        (*mix).wBitsPerSample,
                    );
                    notes.push(format!(
                        "формат смешивания устройства: {rate} Гц, каналов {count}, {bits} бит"
                    ));
                    CoTaskMemFree(Some(mix.cast::<c_void>()));
                }
            }
        }
        let wire = initialize(&client, event_driven, &mut notes)?;
        let event = if event_driven {
            // SAFETY: событие закрывается после остановки потока.
            unsafe {
                let e = CreateEventW(None, false, false, PCWSTR::null())?;
                client.SetEventHandle(e)?;
                Some(e)
            }
        } else {
            None
        };
        // SAFETY: чтение размера буфера инициализированного клиента.
        if let Ok(frames) = unsafe { client.GetBufferSize() } {
            notes.push(format!("буфер клиента: {frames} кадров"));
        }
        Ok((client, wire, event))
    })();
    let (client, wire, event) = match setup {
        Ok(v) => {
            let _ = ready.send(Ok(notes));
            v
        }
        Err(e) => {
            notes.push(e.to_string());
            let _ = ready.send(Err(notes.join("; ")));
            return;
        }
    };
    if let Err(e) = capture_loop(&client, wire, event, &sink, &stop) {
        eprintln!("s5cap: захват звука прерван: {e}");
    }
    if let Some(e) = event {
        // SAFETY: событие создано выше и больше не используется.
        unsafe {
            let _ = CloseHandle(e);
        }
    }
}

/// Работающий захват звука.
pub struct AudioCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl AudioCapture {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Запустить захват одним способом. Возвращает захват и замечания о запуске.
pub fn start(
    method: AudioMethod,
    sink: Arc<AudioSink>,
) -> Result<(AudioCapture, Vec<String>), String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = channel();
    let thread_stop = stop.clone();
    let thread = std::thread::Builder::new()
        .name("s5-audio".to_owned())
        .spawn(move || capture_thread(method, sink, thread_stop, tx))
        .map_err(|e| format!("поток звука не создан: {e}"))?;
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(notes)) => Ok((
            AudioCapture {
                stop,
                thread: Some(thread),
            },
            notes,
        )),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("захват звука не запустился за 10 с".to_owned())
        }
    }
}
