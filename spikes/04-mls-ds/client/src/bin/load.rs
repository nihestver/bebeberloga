// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Нагрузка на DS: `--joiners` одновременных входов в одну группу настоящими устройствами
//! OpenMLS. В группе уже есть `--committers` онлайн-участников; они получают Add от
//! сервера, соревнуются за commit, проигравшие получают EPOCH_MISMATCH и отступают.
//!
//! Задержка входа: от заявки (`POST …/join`) до получения Welcome плюс собственное время
//! обработки Welcome. Обработка Welcome ограничена числом ядер (семафор), чтобы 1 000
//! устройств на одной машине не искажали друг другу время: на проде у каждого своё ядро.
//!
//! `load run --addr … --joiners 1000 --committers 3 --label … --out results/load.jsonl`
//! `load summarize results/load.jsonl` — таблица Markdown.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use s4_client::http::{Ds, KIND_COMMIT};
use s4_client::Device;
use serde_json::{json, Value};

type Res<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn arg(args: &[String], name: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_owned())
}

fn dist(mut v: Vec<f64>) -> Value {
    if v.is_empty() {
        return json!({"count": 0});
    }
    v.sort_by(|a, b| a.total_cmp(b));
    let q = |p: f64| v[((p * v.len() as f64) as usize).min(v.len() - 1)];
    json!({"count": v.len(), "p50": q(0.5), "p95": q(0.95), "p99": q(0.99), "max": v[v.len() - 1],
           "sum": v.iter().sum::<f64>()})
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// Семафор на обработку Welcome: не больше `n` одновременно.
struct Slots {
    free: Mutex<usize>,
    cv: Condvar,
}

impl Slots {
    fn run<T>(&self, f: impl FnOnce() -> T) -> T {
        let mut g = self.free.lock().expect("семафор");
        while *g == 0 {
            g = self.cv.wait(g).expect("семафор");
        }
        *g -= 1;
        drop(g);
        let out = f();
        *self.free.lock().expect("семафор") += 1;
        self.cv.notify_one();
        out
    }
}

#[derive(Default)]
struct CommitterStats {
    attempts: u64,
    accepted: u64,
    rejected: HashMap<String, u64>,
    build_ms: Vec<f64>,
    process_ms: Vec<f64>,
    proposal_ms: Vec<f64>,
    commit_bytes: Vec<f64>,
    welcome_bytes: Vec<f64>,
    adds_per_commit: Vec<f64>,
    /// (эпоха после commit-а, момент принятия от T0, мс)
    accepted_at: Vec<(u64, f64)>,
}

struct Committer {
    dev: Device,
    after: u64,
}

impl Committer {
    fn pump(&mut self, ds: &mut Ds, gid: &[u8], wait_ms: u64, st: &mut CommitterStats) -> Res<()> {
        for h in ds.handshakes(gid, self.after, wait_ms)? {
            self.after = h.seq;
            if h.epoch < self.dev.epoch()? {
                continue;
            }
            let t = Instant::now();
            let is_commit = h.kind == KIND_COMMIT;
            self.dev
                .receive(&h.blob)
                .map_err(|e| format!("{}: {e}", self.dev.id))?;
            if is_commit {
                st.process_ms.push(ms(t.elapsed()));
            } else {
                st.proposal_ms.push(ms(t.elapsed()));
            }
        }
        Ok(())
    }

    fn try_commit(
        &mut self,
        ds: &mut Ds,
        gid: &[u8],
        st: &mut CommitterStats,
        t0: Instant,
    ) -> Res<bool> {
        let t = Instant::now();
        let c = self.dev.commit()?;
        let build = ms(t.elapsed());
        st.attempts += 1;
        match ds.submit(
            gid,
            &self.dev.id,
            KIND_COMMIT,
            &c.commit,
            c.welcome.as_deref(),
        ) {
            Ok(_) => {
                self.dev.merge_pending()?;
                st.accepted_at.push((self.dev.epoch()?, ms(t0.elapsed())));
                st.accepted += 1;
                st.build_ms.push(build);
                st.commit_bytes.push(c.commit.len() as f64);
                st.adds_per_commit.push(c.delta.added.len() as f64);
                if let Some(w) = &c.welcome {
                    st.welcome_bytes.push(w.len() as f64);
                }
                Ok(true)
            }
            Err(e) if e.unknown_outcome() => Err(e.into()), // исход неизвестен: не сбрасывать
            Err(e) => {
                self.dev.clear_pending()?;
                *st.rejected.entry(e.code).or_default() += 1;
                Ok(false)
            }
        }
    }
}

struct JoinResult {
    /// момент подачи заявки и получения Welcome, мс от T0
    sent_at: f64,
    welcome_at: f64,
    join_ms: f64,
    welcome_ms: f64,
    process_ms: f64,
    welcome_bytes: usize,
    leaf: u32,
    epoch: u64,
    /// Состав после входа совпал с картой DS (None — DS уже ушёл в другую эпоху).
    roster_ok: Option<bool>,
    error: Option<String>,
}

fn run(args: &[String]) -> Res<()> {
    let addr = arg(args, "--addr", "127.0.0.1:8484");
    let joiners: usize = arg(args, "--joiners", "1000").parse()?;
    let committers: usize = arg(args, "--committers", "3").parse()?;
    let delay_ms: u64 = arg(args, "--commit-delay-ms", "0").parse()?;
    let label = arg(args, "--label", "");
    let out = arg(args, "--out", "");
    let timeout = Duration::from_secs(arg(args, "--timeout-s", "600").parse()?);
    let cpus = std::thread::available_parallelism().map_or(4, |n| n.get());
    let slots: usize = arg(args, "--cpu-slots", &cpus.to_string()).parse()?;

    let t0 = Instant::now();
    let mut ds = Ds::new(&addr);
    let entry = ds.external_sender()?;
    let run_id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let gid = format!("load-{run_id}").into_bytes();

    // Подготовка: группа из `committers` участников (до замера).
    let mut members = Vec::new();
    let mut c0 = Committer {
        dev: Device::new(&format!("c-{run_id}-0"), &entry)?,
        after: 0,
    };
    c0.dev.create_group(&gid)?;
    ds.create_group(&gid, &c0.dev.id, 0)?;
    let mut setup = CommitterStats::default();
    for i in 1..committers {
        let mut dev = Device::new(&format!("c-{run_id}-{i}"), &entry)?;
        ds.upload_key_packages(&dev.id, &[dev.key_package()?])?;
        ds.join(&gid, &dev.id)?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while c0.dev.roster()?.len() <= i {
            if Instant::now() > deadline {
                return Err("подготовка: участник не вошёл".into());
            }
            c0.pump(&mut ds, &gid, 500, &mut setup)?;
            if c0.dev.has_pending_proposals() {
                c0.try_commit(&mut ds, &gid, &mut setup, t0)?;
            }
        }
        let (_, w) = ds
            .welcomes(&dev.id, 5000)?
            .into_iter()
            .next()
            .ok_or("нет Welcome")?;
        dev.join(&w)?;
        members.push(Committer { dev, after: 0 });
    }
    members.insert(0, c0);
    let mut setup_ds = Ds::new(&addr);
    for m in &mut members {
        m.pump(&mut setup_ds, &gid, 0, &mut setup)?;
    }

    // Новые устройства и их KeyPackage (параллельно, до замера).
    let t_prep = Instant::now();
    let chunk = joiners.div_ceil(cpus).max(1);
    let devices: Vec<Device> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..joiners)
            .collect::<Vec<_>>()
            .chunks(chunk)
            .map(|ids| {
                let ids = ids.to_vec();
                let (addr, entry) = (&addr, &entry);
                s.spawn(move || -> Res<Vec<Device>> {
                    let mut ds = Ds::new(addr);
                    let mut out = Vec::new();
                    for i in ids {
                        let d = Device::new(&format!("j-{run_id}-{i}"), entry)?;
                        ds.upload_key_packages(&d.id, &[d.key_package()?])?;
                        out.push(d);
                    }
                    Ok(out)
                })
            })
            .collect();
        let mut all = Vec::new();
        for h in handles {
            all.extend(h.join().map_err(|_| "поток")??);
        }
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(all)
    })?;
    eprintln!(
        "подготовка {} устройств: {:.1} с",
        devices.len(),
        t_prep.elapsed().as_secs_f64()
    );
    ds.reset_stats()?;

    // Онлайн-участники: тянут handshake-и и коммитят, пока не остановят.
    let stop = Arc::new(AtomicBool::new(false));
    let committer_handles: Vec<_> = members
        .into_iter()
        .enumerate()
        .map(|(i, mut m)| {
            let (stop, addr, gid) = (stop.clone(), addr.clone(), gid.clone());
            std::thread::spawn(move || -> Res<CommitterStats> {
                let mut ds = Ds::new(&addr);
                let mut st = CommitterStats::default();
                let mut rng = 0x9e37_79b9_7f4a_7c15u64 ^ (i as u64 + 1);
                while !stop.load(Ordering::Relaxed) {
                    m.pump(&mut ds, &gid, 200, &mut st)?;
                    if m.dev.has_pending_proposals() && !m.dev.removal_pending() {
                        if delay_ms > 0 {
                            rng ^= rng << 13;
                            rng ^= rng >> 7;
                            rng ^= rng << 17;
                            std::thread::sleep(Duration::from_millis(rng % (delay_ms + 1)));
                            m.pump(&mut ds, &gid, 0, &mut st)?;
                        }
                        m.try_commit(&mut ds, &gid, &mut st, t0)?;
                    }
                }
                Ok(st)
            })
        })
        .collect();

    // Замер: все устройства подают заявку одновременно.
    let barrier = Arc::new(Barrier::new(devices.len() + 1));
    let slots = Arc::new(Slots {
        free: Mutex::new(slots),
        cv: Condvar::new(),
    });
    let joiner_handles: Vec<_> = devices
        .into_iter()
        .map(|mut dev| {
            let (barrier, slots, addr, gid) =
                (barrier.clone(), slots.clone(), addr.clone(), gid.clone());
            std::thread::Builder::new()
                .stack_size(4 << 20)
                .spawn(move || -> JoinResult {
                    let mut ds = Ds::new(&addr);
                    let mut r = JoinResult {
                        sent_at: 0.0,
                        welcome_at: 0.0,
                        join_ms: 0.0,
                        welcome_ms: 0.0,
                        process_ms: 0.0,
                        welcome_bytes: 0,
                        leaf: u32::MAX,
                        epoch: 0,
                        roster_ok: None,
                        error: None,
                    };
                    barrier.wait();
                    r.sent_at = ms(t0.elapsed());
                    let t0 = Instant::now();
                    if let Err(e) = ds.join(&gid, &dev.id) {
                        r.error = Some(e.code);
                        return r;
                    }
                    r.join_ms = ms(t0.elapsed());
                    let welcome = loop {
                        match ds.welcomes(&dev.id, 2000) {
                            Ok(w) if !w.is_empty() => break w.into_iter().next().map(|x| x.1),
                            Ok(_) if t0.elapsed() < timeout => {}
                            Ok(_) => break None,
                            Err(e) => {
                                r.error = Some(e.code);
                                return r;
                            }
                        }
                    };
                    let Some(welcome) = welcome else {
                        r.error = Some("TIMEOUT".into());
                        return r;
                    };
                    r.welcome_ms = ms(t0.elapsed());
                    r.welcome_at = r.sent_at + r.welcome_ms;
                    r.welcome_bytes = welcome.len();
                    let res = slots.run(|| {
                        let t = Instant::now();
                        let res = dev.join(&welcome);
                        (res, ms(t.elapsed()))
                    });
                    r.process_ms = res.1;
                    match res.0 {
                        Ok(()) => {
                            r.leaf = dev.own_leaf().unwrap_or(u32::MAX);
                            r.epoch = dev.epoch().unwrap_or(0);
                            // Сверка состава с картой DS (вне замера задержки): возможна,
                            // пока DS в той же эпохе — новичок дальше за группой не следит.
                            if let Ok((epoch, leaves)) = ds.group(&gid) {
                                if epoch == r.epoch {
                                    r.roster_ok =
                                        Some(dev.roster().map(|r| r == leaves).unwrap_or(false));
                                }
                            }
                        }
                        Err(e) => r.error = Some(format!("JOIN: {e}")),
                    }
                    r
                })
                .expect("поток")
        })
        .collect();
    barrier.wait();
    let t_start = Instant::now();
    let results: Vec<JoinResult> = joiner_handles
        .into_iter()
        .map(|h| h.join().expect("поток устройства"))
        .collect();
    let wall = t_start.elapsed();
    stop.store(true, Ordering::Relaxed);
    let mut cs = CommitterStats::default();
    for h in committer_handles {
        let st = h.join().map_err(|_| "поток участника")??;
        cs.attempts += st.attempts;
        cs.accepted += st.accepted;
        for (k, v) in st.rejected {
            *cs.rejected.entry(k).or_default() += v;
        }
        cs.build_ms.extend(st.build_ms);
        cs.process_ms.extend(st.process_ms);
        cs.proposal_ms.extend(st.proposal_ms);
        cs.commit_bytes.extend(st.commit_bytes);
        cs.welcome_bytes.extend(st.welcome_bytes);
        cs.adds_per_commit.extend(st.adds_per_commit);
        cs.accepted_at.extend(st.accepted_at);
    }
    let accepted: HashMap<u64, f64> = cs.accepted_at.iter().copied().collect();
    let release = results.iter().map(|r| r.sent_at).fold(f64::MAX, f64::min);

    // Сверка: лист каждого вошедшего = лист в карте DS.
    let (epoch, leaves) = ds.group(&gid)?;
    let by_dev: HashMap<String, u32> = leaves.iter().map(|(l, d)| (d.clone(), *l)).collect();
    let mut errors: HashMap<String, u64> = HashMap::new();
    let mut ok = Vec::new();
    for (i, r) in results.iter().enumerate() {
        match &r.error {
            Some(e) => *errors.entry(e.clone()).or_default() += 1,
            None => {
                if by_dev.get(&format!("j-{run_id}-{i}")) != Some(&r.leaf) {
                    *errors.entry("LEAF_MISMATCH".into()).or_default() += 1;
                } else if r.roster_ok == Some(false) {
                    *errors.entry("ROSTER_MISMATCH".into()).or_default() += 1;
                } else {
                    ok.push(r);
                }
            }
        }
    }
    let stats = ds.stats()?;
    let report = json!({
        "label": label,
        "ds_flags": std::env::var("DS_FLAGS").unwrap_or_default(),
        "joiners": joiners, "committers": committers, "commit_delay_ms": delay_ms, "cpu_slots": slots_count(&slots),
        "joined": ok.len(), "errors": errors,
        "roster_verified": ok.iter().filter(|r| r.roster_ok == Some(true)).count(), "final_epoch": epoch, "group_size": leaves.len(),
        "wall_ms": ms(wall),
        // последний вход «на проде»: без ожидания стенда в очереди на ядра (семафор)
        "last_applied_ms": ok.iter().map(|r| r.sent_at - release + r.welcome_ms + r.process_ms).fold(0.0, f64::max),
        "join_request_ms": dist(ok.iter().map(|r| r.join_ms).collect()),
        "welcome_received_ms": dist(ok.iter().map(|r| r.welcome_ms).collect()),
        "welcome_process_ms": dist(ok.iter().map(|r| r.process_ms).collect()),
        "applied_ms": dist(ok.iter().map(|r| r.welcome_ms + r.process_ms).collect()),
        "joiner_welcome_bytes": dist(ok.iter().map(|r| r.welcome_bytes as f64).collect()),
        // разложение задержки: заявка → commit принят DS → Welcome у устройства
        "to_commit_ms": dist(ok.iter().filter_map(|r| accepted.get(&r.epoch).map(|a| a - r.sent_at)).collect()),
        "delivery_ms": dist(ok.iter().filter_map(|r| accepted.get(&r.epoch).map(|a| r.welcome_at - a)).collect()),
        "commits_at_ms": cs.accepted_at.iter().map(|(e, a)| json!([e, a - release])).collect::<Vec<_>>(),
        "joined_epochs": ok.iter().map(|r| r.epoch).collect::<std::collections::BTreeSet<_>>().len(),
        "commits": {"attempts": cs.attempts, "accepted": cs.accepted, "rejected": cs.rejected,
            "build_ms": dist(cs.build_ms), "process_ms": dist(cs.process_ms), "proposal_ms": dist(cs.proposal_ms),
            "commit_bytes": dist(cs.commit_bytes), "welcome_bytes": dist(cs.welcome_bytes),
            "adds_per_commit": dist(cs.adds_per_commit)},
        "ds": stats,
    });
    println!(
        "{label}: вошли {}/{joiners} (стенд {:.1} с); применено p50 {:.0} мс p95 {:.0} мс p99 {:.0} мс; commit-ов {} (попыток {}); ошибки {:?}",
        ok.len(), wall.as_secs_f64(),
        report["applied_ms"]["p50"].as_f64().unwrap_or(0.0),
        report["applied_ms"]["p95"].as_f64().unwrap_or(0.0),
        report["applied_ms"]["p99"].as_f64().unwrap_or(0.0),
        cs.accepted, cs.attempts, report["errors"],
    );
    if !out.is_empty() {
        use std::io::Write as _;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&out)?;
        writeln!(f, "{report}")?;
    }
    if ok.len() + errors.get("CHANNEL_MEMBER_LIMIT").copied().unwrap_or(0) as usize != joiners {
        return Err(format!("вошли не все: {errors:?}").into());
    }
    Ok(())
}

fn slots_count(s: &Slots) -> usize {
    *s.free.lock().expect("семафор")
}

fn f(v: &Value, path: &[&str]) -> f64 {
    let mut x = v;
    for p in path {
        x = &x[*p];
    }
    x.as_f64().unwrap_or(0.0)
}

/// Таблица Markdown: по сценарию — медиана по повторам (число повторов — в скобках).
fn summarize(args: &[String]) -> Res<()> {
    let path = args.get(2).cloned().unwrap_or("results/load.jsonl".into());
    let text = std::fs::read_to_string(&path)?;
    let mut order: Vec<String> = Vec::new();
    let mut runs: HashMap<String, Vec<Value>> = HashMap::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let v: Value = serde_json::from_str(line)?;
        let label = v["label"].as_str().unwrap_or("").to_owned();
        if !runs.contains_key(&label) {
            order.push(label.clone());
        }
        runs.entry(label).or_default().push(v);
    }
    let med = |vs: &[Value], path: &[&str]| -> f64 {
        let mut x: Vec<f64> = vs.iter().map(|v| f(v, path)).collect();
        x.sort_by(|a, b| a.total_cmp(b));
        x[x.len() / 2]
    };
    println!("| Сценарий (повторов) | Вошли, мин | Последний применил, с | Welcome получен p50 / p95, мс | Применено p50 / p95 / p99, мс | Commit-ов принято / попыток | Add на commit, макс | Commit, КБ | Welcome на устройство, КБ | Обработка Welcome p50, мс | Проверка 1 Add у коммитера p50, мс | Lock hold commit p95, мс |");
    println!("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for label in order {
        let vs = &runs[&label];
        let joined = vs
            .iter()
            .map(|v| v["joined"].as_u64().unwrap_or(0))
            .min()
            .unwrap_or(0);
        println!(
            "| {label} ({}) | {joined}/{} | {:.1} | {:.0} / {:.0} | {:.0} / {:.0} / {:.0} | {:.0} / {:.0} | {:.0} | {:.0} | {:.0} | {:.1} | {:.2} | {:.0} |",
            vs.len(), vs[0]["joiners"],
            med(vs, &["last_applied_ms"]) / 1000.0,
            med(vs, &["welcome_received_ms", "p50"]), med(vs, &["welcome_received_ms", "p95"]),
            med(vs, &["applied_ms", "p50"]), med(vs, &["applied_ms", "p95"]), med(vs, &["applied_ms", "p99"]),
            med(vs, &["commits", "accepted"]), med(vs, &["commits", "attempts"]),
            med(vs, &["commits", "adds_per_commit", "max"]),
            med(vs, &["commits", "commit_bytes", "max"]) / 1024.0,
            med(vs, &["joiner_welcome_bytes", "p50"]) / 1024.0,
            med(vs, &["welcome_process_ms", "p50"]),
            med(vs, &["commits", "proposal_ms", "p50"]),
            med(vs, &["ds", "dists", "lock_hold.commit_ms", "p95"]),
        );
    }
    Ok(())
}

fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("summarize") => summarize(&args),
        Some("run") => run(&args),
        _ => Err("использование: load run [--addr …] | load summarize <файл>".into()),
    }
}
