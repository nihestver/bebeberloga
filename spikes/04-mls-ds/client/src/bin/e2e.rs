// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! E2E-проверка DS настоящими клиентами OpenMLS: вход по Add от сервера, гонка commit-ов,
//! Remove с принуждением, совпадение карты листьев DS с деревом у клиентов, подделка дельты.
//!
//! Запуск (DS уже слушает): `cargo run --bin e2e -- 127.0.0.1:8484`.

use std::time::{SystemTime, UNIX_EPOCH};

use s4_client::http::{Ds, DsError, KIND_COMMIT};
use s4_client::{Device, Event, RosterDelta};

type Res<T> = Result<T, Box<dyn std::error::Error>>;

struct Member {
    dev: Device,
    after: u64,
}

impl Member {
    /// Обработать все новые handshake-сообщения группы. Свой commit клиент узнаёт сам
    /// (`Event::Ignored`): метки DS о отправителе не аутентифицированы. Сообщения эпох до
    /// входа устройства пропускаются по метке эпохи — openmls всё равно отверг бы их.
    fn pump(&mut self, ds: &mut Ds, gid: &[u8]) -> Res<Vec<Event>> {
        let mut events = Vec::new();
        for h in ds.handshakes(gid, self.after, 300)? {
            self.after = h.seq;
            if h.epoch < self.dev.epoch()? {
                continue;
            }
            events.push(self.dev.receive(&h.blob)?);
            if events.last() == Some(&Event::Removed) {
                break;
            }
        }
        Ok(events)
    }

    /// Commit очереди; при успехе применяет его. Возвращает отказ DS, если был.
    fn commit(&mut self, ds: &mut Ds, gid: &[u8]) -> Res<Option<DsError>> {
        let c = self.dev.commit()?;
        match ds.submit(
            gid,
            &self.dev.id,
            KIND_COMMIT,
            &c.commit,
            c.welcome.as_deref(),
        ) {
            Ok(_) => {
                self.dev.merge_pending()?;
                Ok(None)
            }
            Err(e) if e.unknown_outcome() => Err(e.into()), // исход неизвестен: не сбрасывать
            Err(e) => {
                self.dev.clear_pending()?;
                Ok(Some(e))
            }
        }
    }
}

fn check(ok: bool, what: &str) -> Res<()> {
    if ok {
        println!("✓ {what}");
        Ok(())
    } else {
        Err(format!("✗ {what}").into())
    }
}

fn new_device(ds: &mut Ds, entry: &[u8], id: &str) -> Res<Device> {
    let d = Device::new(id, entry)?;
    ds.upload_key_packages(id, &[d.key_package()?, d.key_package()?])?;
    Ok(d)
}

/// Вход по Welcome и сверка состава с картой DS: Welcome сам по себе не доказывает, что
/// дерево то, о котором знает сервер.
fn welcome(ds: &mut Ds, dev: &mut Device) -> Res<()> {
    for _ in 0..50 {
        if let Some((_, w)) = ds.welcomes(&dev.id, 200)?.into_iter().next() {
            dev.join(&w)?;
            let gid = format!("e2e-group-{}", dev.id.split('-').nth(1).unwrap_or("")).into_bytes();
            let (epoch, leaves) = ds.group(&gid)?;
            if epoch == dev.epoch()? && leaves != dev.roster()? {
                return Err(
                    format!("{}: состав после Welcome расходится с картой DS", dev.id).into(),
                );
            }
            return Ok(());
        }
    }
    Err(format!("нет Welcome для {}", dev.id).into())
}

/// Дождаться предложений сервера (батчер мог ещё не сработать).
fn await_proposals(m: &mut Member, ds: &mut Ds, gid: &[u8]) -> Res<()> {
    for _ in 0..100 {
        m.pump(ds, gid)?;
        if m.dev.has_pending_proposals() {
            return Ok(());
        }
    }
    Err("предложения сервера не пришли".into())
}

fn same_roster(ds: &mut Ds, gid: &[u8], members: &[&Member]) -> Res<bool> {
    let (epoch, leaves) = ds.group(gid)?;
    Ok(members
        .iter()
        .all(|m| m.dev.roster().ok() == Some(leaves.clone()) && m.dev.epoch().ok() == Some(epoch)))
}

fn main() -> Res<()> {
    let addr = std::env::args().nth(1).unwrap_or("127.0.0.1:8484".into());
    let mut ds = Ds::new(&addr);
    let entry = ds.external_sender()?;
    let run = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let id = |n: &str| format!("e2e-{run}-{n}");
    let gid = format!("e2e-group-{run}").into_bytes();

    // 1. Создатель и вход двух устройств по Add от сервера.
    let mut a = Member {
        dev: Device::new(&id("a"), &entry)?,
        after: 0,
    };
    a.dev.create_group(&gid)?;
    ds.create_group(&gid, &a.dev.id, 0)?;
    let mut b = Member {
        dev: new_device(&mut ds, &entry, &id("b"))?,
        after: 0,
    };
    let mut c = Member {
        dev: new_device(&mut ds, &entry, &id("c"))?,
        after: 0,
    };
    ds.join(&gid, &b.dev.id)?;
    ds.join(&gid, &c.dev.id)?;
    while a.dev.roster()?.len() < 3 {
        await_proposals(&mut a, &mut ds, &gid)?;
        check(
            a.commit(&mut ds, &gid)?.is_none(),
            "DS принял commit с Add от сервера",
        )?;
    }
    welcome(&mut ds, &mut b.dev)?;
    welcome(&mut ds, &mut c.dev)?;
    b.pump(&mut ds, &gid)?;
    c.pump(&mut ds, &gid)?;
    check(
        same_roster(&mut ds, &gid, &[&a, &b, &c])?,
        "карта листьев DS = дерево у A, B, C",
    )?;

    // 2. Гонка: A и B коммитят одно и то же Add; DS принимает ровно один.
    let mut d = Member {
        dev: new_device(&mut ds, &entry, &id("d"))?,
        after: 0,
    };
    ds.join(&gid, &d.dev.id)?;
    await_proposals(&mut a, &mut ds, &gid)?;
    await_proposals(&mut b, &mut ds, &gid)?;
    let ra = a.commit(&mut ds, &gid)?;
    let rb = b.commit(&mut ds, &gid)?;
    check(ra.is_none(), "первый commit принят")?;
    check(
        rb.as_ref().is_some_and(|e| e.code == "EPOCH_MISMATCH"),
        "второй commit той же эпохи отвергнут: EPOCH_MISMATCH",
    )?;
    let ev = b.pump(&mut ds, &gid)?;
    check(
        ev.iter().any(|e| matches!(e, Event::Commit { .. })),
        "проигравший применил commit победителя после проверки дельты",
    )?;
    c.pump(&mut ds, &gid)?;
    welcome(&mut ds, &mut d.dev)?;
    d.pump(&mut ds, &gid)?;
    check(
        same_roster(&mut ds, &gid, &[&a, &b, &c, &d])?,
        "карта листьев DS = дерево у A, B, C, D",
    )?;

    // 3. Remove C: удаляемый не может коммитить, остальные обязаны включить Remove.
    let c_leaf = c.dev.own_leaf()?;
    ds.remove(&gid, &c.dev.id)?;
    // Атака из ADR-0016 п. 4: удаляемое устройство коммитит (self-update), не обработав
    // Remove, — чтобы очистить очередь и остаться. DS не принимает commit от него.
    let rc = c.commit(&mut ds, &gid)?;
    check(
        rc.as_ref().is_some_and(|e| e.code == "REMOVAL_PENDING"),
        "commit удаляемого устройства отвергнут: REMOVAL_PENDING",
    )?;
    for m in [&mut a, &mut b, &mut c, &mut d] {
        m.pump(&mut ds, &gid)?;
    }
    check(c.dev.removal_pending(), "C видит Remove себя в очереди")?;
    // Включить Remove себя openmls не даёт (CannotRemoveSelf) — коммитят другие.
    check(
        c.dev.commit().is_err(),
        "клиент C не может закоммитить своё удаление сам",
    )?;
    check(b.commit(&mut ds, &gid)?.is_none(), "commit с Remove принят")?;
    a.pump(&mut ds, &gid)?;
    d.pump(&mut ds, &gid)?;
    check(
        c.pump(&mut ds, &gid)?.contains(&Event::Removed),
        "C узнал об удалении",
    )?;
    let (_, leaves) = ds.group(&gid)?;
    check(
        !leaves.iter().any(|(l, _)| *l == c_leaf),
        "лист C освобождён в карте DS",
    )?;
    check(
        same_roster(&mut ds, &gid, &[&a, &b, &d])?,
        "карта листьев DS = дерево у A, B, D",
    )?;

    // 4. Отмена входа после публикации Add: отменить уже нельзя (Add лежит в очередях
    // участников), поэтому DS принимает commit, Welcome не выдаёт и сразу публикует Remove.
    let g = new_device(&mut ds, &entry, &id("g"))?;
    ds.join(&gid, &g.id)?;
    while a.dev.pending_adds() < 1 {
        await_proposals(&mut a, &mut ds, &gid)?;
    }
    ds.remove(&gid, &g.id)?;
    check(
        a.commit(&mut ds, &gid)?.is_none(),
        "commit с отменённым Add принят (группа не встала)",
    )?;
    check(
        ds.welcomes(&g.id, 300)?.is_empty(),
        "отменённому устройству Welcome не выдан",
    )?;
    a.pump(&mut ds, &gid)?;
    check(
        a.dev.has_pending_proposals(),
        "следом за commit-ом пришёл Remove отменённого устройства",
    )?;
    check(
        a.commit(&mut ds, &gid)?.is_none(),
        "Remove отменённого устройства закоммичен",
    )?;
    b.pump(&mut ds, &gid)?;
    d.pump(&mut ds, &gid)?;
    check(
        !a.dev.roster()?.iter().any(|(_, dev)| *dev == g.id),
        "отменённого устройства нет в группе",
    )?;
    check(
        same_roster(&mut ds, &gid, &[&a, &b, &d])?,
        "карта листьев DS = дерево у A, B, D",
    )?;

    // 5. Два новичка; заодно проверка подделки дельты (ломает группу — поэтому последняя).
    let mut e = Member {
        dev: new_device(&mut ds, &entry, &id("e"))?,
        after: 0,
    };
    let mut f = Member {
        dev: new_device(&mut ds, &entry, &id("f"))?,
        after: 0,
    };
    ds.join(&gid, &e.dev.id)?;
    ds.join(&gid, &f.dev.id)?;
    while a.dev.pending_adds() < 2 {
        await_proposals(&mut a, &mut ds, &gid)?;
    }
    // Лист не по порядку DS видит сам.
    let bad = a.dev.commit_with(|mut dl: RosterDelta| {
        for x in &mut dl.added {
            x.0 += 10;
        }
        dl
    })?;
    let r = ds.submit(
        &gid,
        &a.dev.id,
        KIND_COMMIT,
        &bad.commit,
        bad.welcome.as_deref(),
    );
    check(
        r.as_ref().err().is_some_and(|e| e.code == "BAD_DELTA"),
        "дельта с неверными листьями отвергнута DS: BAD_DELTA",
    )?;
    a.dev.clear_pending()?;
    // Перестановку устройств между листьями DS не видит (листья и адресаты Welcome те же),
    // а получатели обязаны её отвергнуть.
    let lie = a.dev.commit_with(|mut dl: RosterDelta| {
        let (i0, i1) = (dl.added[0].1.clone(), dl.added[1].1.clone());
        dl.added[0].1 = i1;
        dl.added[1].1 = i0;
        dl
    })?;
    let r = ds.submit(
        &gid,
        &a.dev.id,
        KIND_COMMIT,
        &lie.commit,
        lie.welcome.as_deref(),
    );
    check(
        r.is_ok(),
        "DS принял перестановку устройств в дельте (проверить её он не может)",
    )?;
    a.dev.merge_pending()?;
    let err = b
        .pump(&mut ds, &gid)
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    check(
        err.contains("дельта состава не совпадает"),
        "получатель B отверг commit с ложной дельтой (рассинхрон — процедура восстановления B02)",
    )?;
    // Новички входят по Welcome и сверяют состав с картой DS: ложь видна и им.
    let mismatch = |r: Res<()>| r.err().map(|e| e.to_string()).unwrap_or_default();
    check(
        mismatch(welcome(&mut ds, &mut e.dev)).contains("расходится с картой DS"),
        "новичок E после Welcome заметил расхождение с картой DS",
    )?;
    check(
        mismatch(welcome(&mut ds, &mut f.dev)).contains("расходится с картой DS"),
        "новичок F после Welcome заметил расхождение с картой DS",
    )?;
    check(
        e.dev.own_leaf()? == c_leaf || f.dev.own_leaf()? == c_leaf,
        "новичок занял освободившийся лист C",
    )?;
    let (_, leaves) = ds.group(&gid)?;
    check(
        leaves != a.dev.roster()?,
        "карта DS после ложной дельты расходится с деревом — ложь видна при сверке",
    )?;
    println!("e2e: все проверки пройдены");
    Ok(())
}
