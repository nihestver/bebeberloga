// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Linux: захват звука через PipeWire.
//!
//! Программа создаёт собственный узел захвата без автоподключения и сама связывает
//! с ним выходные порты узлов воспроизведения нужных процессов. Узлы и порты приходят
//! событиями реестра, поэтому узел, появившийся во время записи, подключается так же,
//! как существовавший при старте. Линковка сделана по документации PipeWire.
//!
//! Три режима: дерево процессов приложения; все узлы воспроизведения, кроме
//! собственных; monitor-порты устройства вывода по умолчанию (вся система как есть).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use pipewire as pw;
use pw::properties::properties;
use pw::spa;
use pw::types::ObjectType;

use super::list::is_in_tree;
use crate::clock::now_ns;
use crate::model::{AudioNodeInfo, Res, CHANNELS, SAMPLE_RATE};
use crate::rec::{AudioSink, FLAG_TIMESTAMP_FALLBACK};

/// Класс узлов, которые воспроизводят звук приложений.
const PLAYBACK_CLASS: &str = "Stream/Output/Audio";
const CAPTURE_NODE_NAME: &str = "s5cap-capture";

/// Способ захвата звука.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioMethod {
    /// Узлы процесса `pid` и его потомков.
    Tree(u32),
    /// Все узлы воспроизведения, кроме узлов собственного процесса.
    AllExceptSelf,
    /// Monitor-порты устройства вывода по умолчанию.
    Monitor,
}

impl AudioMethod {
    pub fn describe(self) -> &'static str {
        match self {
            AudioMethod::Tree(_) => "pipewire: линковка узлов дерева процессов",
            AudioMethod::AllExceptSelf => "pipewire: линковка всех узлов, кроме собственных",
            AudioMethod::Monitor => "pipewire: monitor устройства вывода, вся система",
        }
    }
}

struct NodeEntry {
    media_class: String,
    client_id: Option<u32>,
    /// PID из свойства узла `application.process.id`.
    app_pid: Option<u32>,
    client_api: String,
    running: bool,
    _proxy: Option<pw::node::Node>,
    _listener: Option<pw::node::NodeListener>,
}

struct PortEntry {
    node: u32,
    output: bool,
    channel: String,
    monitor: bool,
}

#[derive(Default)]
struct Graph {
    nodes: HashMap<u32, NodeEntry>,
    ports: HashMap<u32, PortEntry>,
    /// Клиент → PID, который сервер сам узнал у сокета (`pipewire.sec.pid`).
    clients: HashMap<u32, u32>,
    /// Созданные связи: (порт-источник, наш порт) → объект связи.
    links: HashMap<(u32, u32), pw::link::Link>,
    our_node: Option<u32>,
    linked_nodes: Vec<u32>,
}

impl Graph {
    fn remove(&mut self, id: u32) {
        self.nodes.remove(&id);
        self.ports.remove(&id);
        self.clients.remove(&id);
        self.links
            .retain(|(out, input), _| *out != id && *input != id);
        self.linked_nodes.retain(|n| *n != id);
    }
}

/// PID процесса, которому принадлежит узел, и свойство, из которого он взят.
///
/// Свойство узла `application.process.id` заполняет сам клиент, и есть оно не у всех:
/// у узлов, созданных через слой ALSA, его нет. Тогда берётся `pipewire.sec.pid`
/// клиента узла — PID, который сервер сам узнал у сокета.
fn node_pid(graph: &Graph, node: &NodeEntry) -> Option<(u32, &'static str)> {
    if let Some(pid) = node.app_pid {
        return Some((pid, "application.process.id узла"));
    }
    node.client_id
        .and_then(|c| graph.clients.get(&c))
        .map(|pid| (*pid, "pipewire.sec.pid клиента"))
}

fn parse_u32(value: Option<&str>) -> Option<u32> {
    value.and_then(|v| v.parse().ok())
}

/// Связать подходящие узлы воспроизведения с нашим узлом захвата.
fn relink(
    core: &pw::core::CoreRc,
    graph: &mut Graph,
    method: AudioMethod,
    notes: &Arc<Mutex<Vec<String>>>,
) {
    let Some(our) = graph.our_node else {
        return;
    };
    let own_pid = std::process::id();
    let our_ports: Vec<(u32, String)> = graph
        .ports
        .iter()
        .filter(|(_, p)| p.node == our && !p.output)
        .map(|(id, p)| (*id, p.channel.clone()))
        .collect();
    // Ждём оба своих порта: иначе канал источника не с чем сопоставить.
    if our_ports.len() < CHANNELS {
        return;
    }
    let wanted: Vec<(u32, u32, &'static str)> = graph
        .nodes
        .iter()
        .filter(|(id, n)| **id != our && n.media_class == PLAYBACK_CLASS)
        .filter_map(|(id, n)| node_pid(graph, n).map(|(pid, from)| (*id, pid, from)))
        .filter(|(_, pid, _)| match method {
            AudioMethod::Tree(root) => is_in_tree(*pid, root),
            AudioMethod::AllExceptSelf => *pid != own_pid,
            AudioMethod::Monitor => false,
        })
        .collect();
    for (node, pid, pid_from) in wanted {
        let outs: Vec<(u32, String)> = graph
            .ports
            .iter()
            .filter(|(_, p)| p.node == node && p.output && !p.monitor)
            .map(|(id, p)| (*id, p.channel.clone()))
            .collect();
        for (out_port, channel) in &outs {
            // Моно-источник идёт в оба наших канала, левый и правый — канал в канал.
            // Порты приходят по одному, поэтому решение принимается только по имени
            // канала порта, а не по их числу. Остальные каналы многоканального
            // источника спайк не подмешивает.
            let targets: Vec<u32> = if channel == "MONO" {
                our_ports.iter().map(|(id, _)| *id).collect()
            } else {
                our_ports
                    .iter()
                    .filter(|(_, ch)| ch == channel)
                    .map(|(id, _)| *id)
                    .collect()
            };
            for in_port in targets {
                if graph.links.contains_key(&(*out_port, in_port)) {
                    continue;
                }
                let created = core.create_object::<pw::link::Link>(
                    "link-factory",
                    &properties! {
                        "link.output.node" => node.to_string(),
                        "link.output.port" => out_port.to_string(),
                        "link.input.node" => our.to_string(),
                        "link.input.port" => in_port.to_string(),
                        "object.linger" => "false",
                    },
                );
                match created {
                    Ok(link) => {
                        graph.links.insert((*out_port, in_port), link);
                        if !graph.linked_nodes.contains(&node) {
                            graph.linked_nodes.push(node);
                            if let Ok(mut n) = notes.lock() {
                                n.push(format!(
                                    "узел {node} процесса {pid} подключён; PID взят из {pid_from} (всего узлов: {})",
                                    graph.linked_nodes.len()
                                ));
                            }
                        }
                    }
                    Err(e) => {
                        if let Ok(mut n) = notes.lock() {
                            n.push(format!("связь с узлом {node} не создана: {e}"));
                        }
                    }
                }
            }
        }
    }
}

type Chunk = (u64, u64, Vec<f32>, u32);

/// Поток PipeWire: реестр, узел захвата, линковка. Работает, пока не взведён `stop`.
fn capture_thread(
    method: AudioMethod,
    samples: Sender<Chunk>,
    stop: Arc<AtomicBool>,
    ready: Sender<Result<(), String>>,
    notes: Arc<Mutex<Vec<String>>>,
) -> Res<()> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    let core = context.connect_rc(None)?;
    let registry = core.get_registry_rc()?;
    let graph = Rc::new(RefCell::new(Graph::default()));
    let ready = Rc::new(RefCell::new(Some(ready)));

    // Реестр: узлы, порты и клиенты.
    let reg_graph = graph.clone();
    let reg_core = core.clone();
    let reg_registry = registry.clone();
    let reg_notes = notes.clone();
    let remove_graph = graph.clone();
    let _registry_listener = registry
        .add_listener_local()
        .global(move |global| {
            let Some(props) = global.props else {
                return;
            };
            match global.type_ {
                ObjectType::Node => {
                    let media_class = props.get("media.class").unwrap_or("").to_owned();
                    let mut entry = NodeEntry {
                        media_class: media_class.clone(),
                        client_id: parse_u32(props.get("client.id")),
                        app_pid: parse_u32(props.get("application.process.id")),
                        client_api: String::new(),
                        running: false,
                        _proxy: None,
                        _listener: None,
                    };
                    // PID приложения сервер отдаёт в полных сведениях об узле.
                    if media_class == PLAYBACK_CLASS {
                        if let Ok(node) = reg_registry.bind::<pw::node::Node, _>(global) {
                            let node_id = global.id;
                            let info_graph = reg_graph.clone();
                            let info_core = reg_core.clone();
                            let info_notes = reg_notes.clone();
                            let listener = node
                                .add_listener_local()
                                .info(move |info| {
                                    let Some(props) = info.props() else {
                                        return;
                                    };
                                    let pid = parse_u32(props.get("application.process.id"));
                                    let api = props.get("client.api").unwrap_or("").to_owned();
                                    let mut g = info_graph.borrow_mut();
                                    if let Some(entry) = g.nodes.get_mut(&node_id) {
                                        if pid.is_some() {
                                            entry.app_pid = pid;
                                        }
                                        entry.client_api = api;
                                    }
                                    relink(&info_core, &mut g, method, &info_notes);
                                })
                                .register();
                            entry._proxy = Some(node);
                            entry._listener = Some(listener);
                        }
                    }
                    reg_graph.borrow_mut().nodes.insert(global.id, entry);
                }
                ObjectType::Port => {
                    let Some(node) = parse_u32(props.get("node.id")) else {
                        return;
                    };
                    reg_graph.borrow_mut().ports.insert(
                        global.id,
                        PortEntry {
                            node,
                            output: props.get("port.direction") == Some("out"),
                            channel: props.get("audio.channel").unwrap_or("").to_owned(),
                            monitor: props.get("port.monitor") == Some("true"),
                        },
                    );
                }
                ObjectType::Client => {
                    if let Some(pid) = parse_u32(props.get("pipewire.sec.pid")) {
                        reg_graph.borrow_mut().clients.insert(global.id, pid);
                    }
                }
                _ => return,
            }
            relink(&reg_core, &mut reg_graph.borrow_mut(), method, &reg_notes);
        })
        .global_remove(move |id| remove_graph.borrow_mut().remove(id))
        .register();

    // Узел захвата.
    let mut props = properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Screen",
        *pw::keys::NODE_NAME => CAPTURE_NODE_NAME,
        *pw::keys::APP_NAME => "s5cap",
    };
    if method == AudioMethod::Monitor {
        props.insert(*pw::keys::STREAM_CAPTURE_SINK, "true");
    } else {
        // Менеджер сеанса не должен сам подключать нас к микрофону или устройству.
        props.insert("node.autoconnect", "false");
    }
    let stream = pw::stream::StreamRc::new(core.clone(), CAPTURE_NODE_NAME, props)?;
    let channels = Arc::new(AtomicU32::new(CHANNELS as u32));
    let format_channels = channels.clone();
    let format_notes = notes.clone();
    let state_graph = graph.clone();
    let state_core = core.clone();
    let state_notes = notes.clone();
    let state_ready = ready.clone();
    let delay_noted = AtomicBool::new(false);
    let process_notes = notes.clone();
    let _stream_listener = stream
        .add_local_listener_with_user_data(())
        .state_changed(move |stream, _, _old, new| match new {
            pw::stream::StreamState::Paused | pw::stream::StreamState::Streaming => {
                let mut g = state_graph.borrow_mut();
                if g.our_node.is_none() {
                    g.our_node = Some(stream.node_id());
                }
                relink(&state_core, &mut g, method, &state_notes);
                if let Some(r) = state_ready.borrow_mut().take() {
                    let _ = r.send(Ok(()));
                }
            }
            pw::stream::StreamState::Error(text) => {
                if let Some(r) = state_ready.borrow_mut().take() {
                    let _ = r.send(Err(format!("узел захвата в состоянии ошибки: {text}")));
                }
            }
            _ => {}
        })
        .param_changed(move |_, _, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let mut info = spa::param::audio::AudioInfoRaw::new();
            if info.parse(param).is_ok() {
                format_channels.store(info.channels().max(1), Ordering::Relaxed);
                if let Ok(mut n) = format_notes.lock() {
                    n.push(format!(
                        "формат узла захвата: {} Гц, каналов {}, {:?}",
                        info.rate(),
                        info.channels(),
                        info.format()
                    ));
                }
            }
        })
        .process(move |stream, _| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let arrival = now_ns();
            // Время цикла графа по CLOCK_MONOTONIC минус задержка до источника.
            let (t_ns, flags) = match stream.time() {
                Ok(t) if t.now() > 0 => {
                    let rate = t.rate();
                    let delay_ns = if rate.denom != 0 {
                        t.delay() as i128 * 1_000_000_000i128 * rate.num as i128
                            / rate.denom as i128
                    } else {
                        0
                    };
                    if !delay_noted.swap(true, Ordering::Relaxed) {
                        if let Ok(mut n) = process_notes.lock() {
                            n.push(format!(
                                "первая метка: задержка по данным PipeWire {} мкс, от начала цикла до обработки {} мкс",
                                delay_ns / 1000,
                                (arrival as i128 - t.now() as i128) / 1000
                            ));
                        }
                    }
                    ((t.now() as i128 - delay_ns).max(0) as u64, 0)
                }
                _ => (arrival, FLAG_TIMESTAMP_FALLBACK),
            };
            let datas = buffer.datas_mut();
            let Some(data) = datas.first_mut() else {
                return;
            };
            let (offset, size) = (data.chunk().offset() as usize, data.chunk().size() as usize);
            let Some(bytes) = data.data() else {
                return;
            };
            let Some(bytes) = bytes.get(offset..offset + size) else {
                return;
            };
            let ch = channels.load(Ordering::Relaxed).max(1) as usize;
            let frames = size / 4 / ch;
            let sample = |frame: usize, channel: usize| -> f32 {
                let at = (frame * ch + channel) * 4;
                f32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
            };
            let mut out = Vec::with_capacity(frames * CHANNELS);
            for frame in 0..frames {
                out.push(sample(frame, 0));
                out.push(sample(frame, if ch > 1 { 1 } else { 0 }));
            }
            let _ = samples.send((t_ns, arrival, out, flags));
        })
        .register()?;

    // Формат: float32, 48 кГц, стерео (левый и правый).
    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::F32LE);
    info.set_rate(SAMPLE_RATE);
    info.set_channels(CHANNELS as u32);
    let mut position = [0u32; spa::sys::SPA_AUDIO_MAX_CHANNELS as usize];
    position[0] = spa::sys::SPA_AUDIO_CHANNEL_FL;
    position[1] = spa::sys::SPA_AUDIO_CHANNEL_FR;
    info.set_position(position);
    let object = spa::pod::Object {
        type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: info.into(),
    };
    let bytes: Vec<u8> = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .map_err(|e| format!("параметр формата не собран: {e:?}"))?
    .0
    .into_inner();
    let pod = spa::pod::Pod::from_bytes(&bytes).ok_or("параметр формата не разобран")?;
    let mut flags = pw::stream::StreamFlags::MAP_BUFFERS | pw::stream::StreamFlags::RT_PROCESS;
    if method == AudioMethod::Monitor {
        flags |= pw::stream::StreamFlags::AUTOCONNECT;
    }
    stream.connect(spa::utils::Direction::Input, None, flags, &mut [pod])?;

    // Остановка: таймер цикла проверяет флаг.
    let timer_loop = mainloop.clone();
    let timer = mainloop.loop_().add_timer(move |_| {
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
    Ok(())
}

/// Работающий захват звука.
pub struct AudioCapture {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl AudioCapture {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

/// Запустить захват. Замечания о ходе работы дописываются в `notes`.
pub fn start(
    method: AudioMethod,
    sink: Arc<AudioSink>,
    notes: Arc<Mutex<Vec<String>>>,
) -> Result<AudioCapture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = channel();
    let (samples_tx, samples_rx) = channel::<Chunk>();
    // Запись на диск — в отдельном потоке: поток обработки звука не должен ждать файл.
    let writer = std::thread::Builder::new()
        .name("s5-audio-writer".to_owned())
        .spawn(move || {
            while let Ok((t_ns, arrival, data, flags)) = samples_rx.recv() {
                sink.push_at(t_ns, arrival, &data, flags);
            }
        })
        .map_err(|e| format!("поток записи не создан: {e}"))?;
    let thread_stop = stop.clone();
    let thread_notes = notes.clone();
    let capture = std::thread::Builder::new()
        .name("s5-audio-pipewire".to_owned())
        .spawn(move || {
            let fallback = ready_tx.clone();
            if let Err(e) = capture_thread(method, samples_tx, thread_stop, ready_tx, thread_notes)
            {
                let _ = fallback.send(Err(e.to_string()));
            }
        })
        .map_err(|e| format!("поток PipeWire не создан: {e}"))?;
    let mut handle = AudioCapture {
        stop,
        threads: vec![capture, writer],
    };
    match ready_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(e)) => {
            handle.stop();
            Err(e)
        }
        Err(_) => {
            handle.stop();
            Err("узел захвата PipeWire не создан за 10 с".to_owned())
        }
    }
}

/// Один проход по реестру: узлы со звуком, их PID и состояние.
pub fn scan_nodes() -> Res<(Vec<AudioNodeInfo>, String)> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    let core = context.connect_rc(None)?;
    let registry = core.get_registry_rc()?;
    let graph = Rc::new(RefCell::new(Graph::default()));
    let version = Rc::new(RefCell::new(String::new()));

    let version_out = version.clone();
    let _core_info = core
        .add_listener_local()
        .info(move |info| *version_out.borrow_mut() = info.version().to_owned())
        .register();

    let reg_graph = graph.clone();
    let reg_registry = registry.clone();
    let _listener = registry
        .add_listener_local()
        .global(move |global| {
            let Some(props) = global.props else {
                return;
            };
            match global.type_ {
                ObjectType::Node => {
                    let media_class = props.get("media.class").unwrap_or("").to_owned();
                    if !media_class.contains("Audio") {
                        return;
                    }
                    let mut entry = NodeEntry {
                        media_class,
                        client_id: parse_u32(props.get("client.id")),
                        app_pid: parse_u32(props.get("application.process.id")),
                        client_api: String::new(),
                        running: false,
                        _proxy: None,
                        _listener: None,
                    };
                    if let Ok(node) = reg_registry.bind::<pw::node::Node, _>(global) {
                        let node_id = global.id;
                        let info_graph = reg_graph.clone();
                        let listener = node
                            .add_listener_local()
                            .info(move |info| {
                                let mut g = info_graph.borrow_mut();
                                let Some(entry) = g.nodes.get_mut(&node_id) else {
                                    return;
                                };
                                entry.running =
                                    matches!(info.state(), pw::node::NodeState::Running);
                                if let Some(props) = info.props() {
                                    if let Some(pid) =
                                        parse_u32(props.get("application.process.id"))
                                    {
                                        entry.app_pid = Some(pid);
                                    }
                                    entry.client_api =
                                        props.get("client.api").unwrap_or("").to_owned();
                                }
                            })
                            .register();
                        entry._proxy = Some(node);
                        entry._listener = Some(listener);
                    }
                    reg_graph.borrow_mut().nodes.insert(global.id, entry);
                }
                ObjectType::Client => {
                    if let Some(pid) = parse_u32(props.get("pipewire.sec.pid")) {
                        reg_graph.borrow_mut().clients.insert(global.id, pid);
                    }
                }
                _ => {}
            }
        })
        .register();

    // Два круга обмена с сервером: первый приносит объекты реестра, второй — сведения об узлах.
    for _ in 0..2 {
        let done = Rc::new(RefCell::new(false));
        let done_flag = done.clone();
        let loop_quit = mainloop.clone();
        let pending = core.sync(0)?;
        let _sync = core
            .add_listener_local()
            .done(move |id, seq| {
                if id == pw::core::PW_ID_CORE && seq == pending {
                    *done_flag.borrow_mut() = true;
                    loop_quit.quit();
                }
            })
            .register();
        while !*done.borrow() {
            mainloop.run();
        }
    }

    let g = graph.borrow();
    let mut out: Vec<AudioNodeInfo> = g
        .nodes
        .iter()
        .map(|(id, n)| {
            let sec_pid = n.client_id.and_then(|c| g.clients.get(&c).copied());
            let mut extra = vec![("media.class".to_owned(), n.media_class.clone())];
            if !n.client_api.is_empty() {
                extra.push(("client.api".to_owned(), n.client_api.clone()));
            }
            extra.push((
                "application.process.id".to_owned(),
                n.app_pid
                    .map(|p| p.to_string())
                    .unwrap_or_else(|| "нет".to_owned()),
            ));
            extra.push((
                "pipewire.sec.pid клиента".to_owned(),
                sec_pid
                    .map(|p| p.to_string())
                    .unwrap_or_else(|| "нет".to_owned()),
            ));
            AudioNodeInfo {
                pid: n.app_pid.or(sec_pid).unwrap_or(0),
                node_id: *id as u64,
                kind: n.media_class.clone(),
                active: n.running,
                extra,
            }
        })
        .collect();
    out.sort_by_key(|n| n.node_id);
    let version = version.borrow().clone();
    Ok((out, version))
}
