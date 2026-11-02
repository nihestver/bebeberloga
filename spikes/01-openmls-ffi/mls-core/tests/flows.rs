// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Сценарии спайка S1: группа, Welcome, сообщения, external sender, exporter, эпохи.

use s1_mls_core::{message_header, Device, Error, ExternalSender, Received};

const GID: &[u8] = b"s1-test-group";

/// Группа из двух устройств: `a` создала, `b` вошла по Welcome.
fn pair(external: Option<&[u8]>) -> (Device, Device) {
    let mut a = Device::new("a").unwrap();
    let mut b = Device::new("b").unwrap();
    a.create_group(GID, external).unwrap();
    let out = a.add_members(GID, &[b.key_package().unwrap()]).unwrap();
    a.merge_pending_commit(GID).unwrap();
    assert_eq!(b.join(&out.welcome.unwrap()).unwrap(), GID);
    (a, b)
}

fn app(received: Received) -> (String, Vec<u8>) {
    match received {
        Received::Application { sender, plaintext } => (sender, plaintext),
        other => panic!("ожидалось application message, получено {other:?}"),
    }
}

#[test]
fn two_devices_exchange_messages() {
    let (mut a, mut b) = pair(None);
    assert_eq!(a.epoch(GID).unwrap(), 1);
    assert_eq!(b.epoch(GID).unwrap(), 1);
    assert_eq!(a.members(GID).unwrap(), ["a", "b"]);

    let ct = a.send(GID, "привет".as_bytes()).unwrap();
    assert_eq!(
        app(b.receive(&ct).unwrap()),
        ("a".into(), "привет".as_bytes().to_vec())
    );

    let ct = b.send(GID, "и тебе".as_bytes()).unwrap();
    assert_eq!(
        app(a.receive(&ct).unwrap()),
        ("b".into(), "и тебе".as_bytes().to_vec())
    );

    // Повтор того же шифртекста отвергается (защита от replay на уровне ratchet).
    assert!(a.receive(&ct).is_err());
}

#[test]
fn third_device_joins_and_everyone_reads() {
    let (mut a, mut b) = pair(None);
    let mut c = Device::new("c").unwrap();
    let out = a.add_members(GID, &[c.key_package().unwrap()]).unwrap();
    a.merge_pending_commit(GID).unwrap();
    assert_eq!(
        b.receive(&out.commit).unwrap(),
        Received::Commit { epoch: 2 }
    );
    c.join(&out.welcome.unwrap()).unwrap();
    assert_eq!(c.members(GID).unwrap(), ["a", "b", "c"]);

    let ct = c.send(GID, "всем привет".as_bytes()).unwrap();
    assert_eq!(app(a.receive(&ct).unwrap()).1, "всем привет".as_bytes());
    assert_eq!(app(b.receive(&ct).unwrap()).1, "всем привет".as_bytes());
}

#[test]
fn external_sender_adds_and_removes() {
    let server = ExternalSender::new("server").unwrap();
    let info = server.public_info().unwrap();
    let (mut a, mut b) = pair(Some(&info));
    let mut c = Device::new("c").unwrap();

    // Сервер предлагает добавить c; оба участника ставят предложение в очередь.
    let add = server
        .propose_add(GID, a.epoch(GID).unwrap(), &c.key_package().unwrap())
        .unwrap();
    assert_eq!(
        a.receive(&add).unwrap(),
        Received::Proposal {
            sender: "server".into()
        }
    );
    assert_eq!(
        b.receive(&add).unwrap(),
        Received::Proposal {
            sender: "server".into()
        }
    );

    // Первый активный участник коммитит; остальные применяют commit, c входит по Welcome.
    let out = a.commit_pending_proposals(GID).unwrap();
    a.merge_pending_commit(GID).unwrap();
    assert_eq!(
        b.receive(&out.commit).unwrap(),
        Received::Commit { epoch: 2 }
    );
    c.join(&out.welcome.expect("Welcome для c")).unwrap();
    assert_eq!(c.members(GID).unwrap(), ["a", "b", "c"]);

    let ct = c.send(GID, "я в группе".as_bytes()).unwrap();
    assert_eq!(app(a.receive(&ct).unwrap()).1, "я в группе".as_bytes());
    assert_eq!(app(b.receive(&ct).unwrap()).1, "я в группе".as_bytes());

    // Сервер предлагает удалить b (по leaf index из публичного дерева).
    let leaf = a.leaf_index(GID, "b").unwrap();
    let remove = server
        .propose_remove(GID, a.epoch(GID).unwrap(), leaf)
        .unwrap();
    for d in [&mut a, &mut b, &mut c] {
        assert_eq!(
            d.receive(&remove).unwrap(),
            Received::Proposal {
                sender: "server".into()
            }
        );
    }
    let out = c.commit_pending_proposals(GID).unwrap();
    c.merge_pending_commit(GID).unwrap();
    assert!(out.welcome.is_none());
    assert_eq!(
        a.receive(&out.commit).unwrap(),
        Received::Commit { epoch: 3 }
    );
    assert_eq!(a.members(GID).unwrap(), ["a", "c"]);

    // b тоже видит commit, но после него читать не может (PCS).
    let _ = b.receive(&out.commit);
    let ct = a.send(GID, "без b".as_bytes()).unwrap();
    assert!(b.receive(&ct).is_err());
    assert_eq!(app(c.receive(&ct).unwrap()).1, "без b".as_bytes());
}

#[test]
fn unknown_external_sender_is_rejected() {
    let server = ExternalSender::new("server").unwrap();
    let impostor = ExternalSender::new("server").unwrap();
    let (mut a, _b) = pair(Some(&server.public_info().unwrap()));
    let c = Device::new("c").unwrap();
    let add = impostor
        .propose_add(GID, a.epoch(GID).unwrap(), &c.key_package().unwrap())
        .unwrap();
    assert!(matches!(a.receive(&add), Err(Error::Mls(_))));
}

#[test]
fn group_without_external_sender_rejects_external_proposals() {
    let server = ExternalSender::new("server").unwrap();
    let (mut a, _b) = pair(None);
    let c = Device::new("c").unwrap();
    let add = server
        .propose_add(GID, a.epoch(GID).unwrap(), &c.key_package().unwrap())
        .unwrap();
    assert!(a.receive(&add).is_err());
}

#[test]
fn self_join_proposal_from_outsider_is_rejected() {
    // openmls принял бы такое предложение в любой группе, даже без external_senders;
    // политика клиента отвергает его до постановки в очередь.
    let (mut a, mut b) = pair(None);
    let ghost = Device::new("b").unwrap();
    let join = ghost.propose_self_join(GID, a.epoch(GID).unwrap()).unwrap();
    assert!(matches!(a.receive(&join), Err(Error::Unauthorized(_))));
    assert!(matches!(b.receive(&join), Err(Error::Unauthorized(_))));
    // Очередь пуста: commit без предложений — обычная ротация, состав прежний.
    let out = a.commit_pending_proposals(GID).unwrap();
    a.merge_pending_commit(GID).unwrap();
    assert!(out.welcome.is_none());
    assert_eq!(a.members(GID).unwrap(), ["a", "b"]);
}

#[test]
fn external_sender_may_only_add_and_remove() {
    let server = ExternalSender::new("server").unwrap();
    let evil = ExternalSender::new("server").unwrap();
    let (mut a, _b) = pair(Some(&server.public_info().unwrap()));
    // Сервер пытается дописать второй external sender в group context — отвергается.
    let gce = server
        .propose_external_senders(
            GID,
            a.epoch(GID).unwrap(),
            &[server.public_info().unwrap(), evil.public_info().unwrap()],
        )
        .unwrap();
    assert!(matches!(a.receive(&gce), Err(Error::Unauthorized(_))));
}

#[test]
fn exporter_secret_is_shared_and_rotates_with_epoch() {
    let (mut a, mut b) = pair(None);
    let s1a = a
        .export_secret(GID, "bebeberloga media", b"call", 32)
        .unwrap();
    let s1b = b
        .export_secret(GID, "bebeberloga media", b"call", 32)
        .unwrap();
    assert_eq!(s1a, s1b);
    assert_eq!(s1a.len(), 32);
    assert_ne!(
        s1a,
        a.export_secret(GID, "bebeberloga media", b"other", 32)
            .unwrap()
    );
    assert_ne!(
        s1a,
        a.export_secret(GID, "other label", b"call", 32).unwrap()
    );

    let mut c = Device::new("c").unwrap();
    let out = a.add_members(GID, &[c.key_package().unwrap()]).unwrap();
    a.merge_pending_commit(GID).unwrap();
    b.receive(&out.commit).unwrap();
    c.join(&out.welcome.unwrap()).unwrap();

    let s2a = a
        .export_secret(GID, "bebeberloga media", b"call", 32)
        .unwrap();
    assert_ne!(s1a, s2a);
    assert_eq!(
        s2a,
        b.export_secret(GID, "bebeberloga media", b"call", 32)
            .unwrap()
    );
    assert_eq!(
        s2a,
        c.export_secret(GID, "bebeberloga media", b"call", 32)
            .unwrap()
    );
}

#[test]
fn commit_for_stale_epoch_is_rejected() {
    let (mut a, mut b) = pair(None);
    let c = Device::new("c").unwrap();
    let d = Device::new("d").unwrap();

    // Два конкурентных commit-а в эпохе 1: сервер принимает первый.
    let from_a = a.add_members(GID, &[c.key_package().unwrap()]).unwrap();
    let from_b = b.add_members(GID, &[d.key_package().unwrap()]).unwrap();
    assert_eq!(message_header(&from_a.commit).unwrap(), (GID.to_vec(), 1));
    assert_eq!(message_header(&from_b.commit).unwrap(), (GID.to_vec(), 1));

    a.merge_pending_commit(GID).unwrap();
    // b отбрасывает свой отвергнутый commit и применяет принятый.
    b.clear_pending_commit(GID).unwrap();
    assert_eq!(
        b.receive(&from_a.commit).unwrap(),
        Received::Commit { epoch: 2 }
    );

    // Отвергнутый commit эпохи 1 участникам эпохи 2 не подходит.
    assert!(a.receive(&from_b.commit).is_err());

    // b повторяет добавление уже в новой эпохе.
    let retry = b.add_members(GID, &[d.key_package().unwrap()]).unwrap();
    assert_eq!(message_header(&retry.commit).unwrap().1, 2);
    b.merge_pending_commit(GID).unwrap();
    assert_eq!(
        a.receive(&retry.commit).unwrap(),
        Received::Commit { epoch: 3 }
    );
    assert_eq!(a.members(GID).unwrap(), ["a", "b", "c", "d"]);
}

#[cfg(feature = "bench")]
#[test]
fn snapshot_is_an_independent_copy() {
    let (mut a, mut b) = pair(None);
    let mut a2 = a.snapshot().unwrap();
    assert_eq!(a2.state_size(), a.state_size());
    let ct = b.send(GID, "обоим".as_bytes()).unwrap();
    assert_eq!(app(a.receive(&ct).unwrap()).1, "обоим".as_bytes());
    assert_eq!(app(a2.receive(&ct).unwrap()).1, "обоим".as_bytes());
}
