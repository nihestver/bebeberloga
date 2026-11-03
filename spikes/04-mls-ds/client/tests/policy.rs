// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Политика клиента без сервера: дельта состава в AAD, закреплённый external sender,
//! предложения только от сервера и привязанные к устройству, негодные KeyPackage, лист
//! автора без смены credential.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use s4_client::wire::{proposal_aad, ExternalSender};
use s4_client::{Device, Error, Event, RosterDelta};
use tls_codec::Serialize as _;

const GID: &[u8] = b"policy-group";

struct Server {
    signer: SignatureKeyPair,
    entry: Vec<u8>,
}

impl Server {
    fn new(name: &str) -> Self {
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519).unwrap();
        let entry = openmls::extensions::ExternalSender::new(
            signer.to_public_vec().into(),
            BasicCredential::new(name.as_bytes().to_vec()).into(),
        )
        .tls_serialize_detached()
        .unwrap();
        Self { signer, entry }
    }

    fn es(&self) -> ExternalSender<'_> {
        ExternalSender {
            signer: &self.signer,
            index: 0,
        }
    }

    /// Add с привязкой к устройству из credential пакета.
    fn add(&self, epoch: u64, kp: &[u8]) -> Vec<u8> {
        let id = s4_client::wire::parse_key_package(kp).unwrap().identity;
        self.add_as(epoch, kp, std::str::from_utf8(&id).unwrap())
    }

    fn add_as(&self, epoch: u64, kp: &[u8], device: &str) -> Vec<u8> {
        self.es().add(GID, epoch, kp, &proposal_aad(device))
    }

    fn remove_as(&self, epoch: u64, leaf: u32, device: &str) -> Vec<u8> {
        self.es().remove(GID, epoch, leaf, &proposal_aad(device))
    }
}

/// Группа A+B и два новых устройства, чьи Add уже в очереди у A и B.
fn setup(server: &Server) -> (Device, Device, Device, Device) {
    let mut a = Device::new("a", &server.entry).unwrap();
    let mut b = Device::new("b", &server.entry).unwrap();
    a.create_group(GID).unwrap();
    a.receive(&server.add(0, &b.key_package().unwrap()))
        .unwrap();
    let c = a.commit().unwrap();
    a.merge_pending().unwrap();
    b.join(&c.welcome.unwrap()).unwrap();
    let e = Device::new("e", &server.entry).unwrap();
    let f = Device::new("f", &server.entry).unwrap();
    for d in [&e, &f] {
        let p = server.add(1, &d.key_package().unwrap());
        assert_eq!(a.receive(&p).unwrap(), Event::Proposal);
        assert_eq!(b.receive(&p).unwrap(), Event::Proposal);
    }
    (a, b, e, f)
}

#[test]
fn honest_delta_is_applied_and_matches_tree() {
    let server = Server::new("ds");
    let (mut a, mut b, mut e, _f) = setup(&server);
    let c = a.commit().unwrap();
    assert_eq!(
        c.delta,
        RosterDelta {
            removed: vec![],
            added: vec![(2, "e".into()), (3, "f".into())]
        }
    );
    assert!(c.dropped.is_empty());
    a.merge_pending().unwrap();
    assert_eq!(b.receive(&c.commit).unwrap(), Event::Commit { epoch: 2 });
    assert_eq!(a.roster().unwrap(), b.roster().unwrap());
    e.join(&c.welcome.unwrap()).unwrap();
    assert_eq!(e.own_leaf().unwrap(), 2);
}

#[test]
fn swapped_devices_in_delta_are_rejected() {
    let server = Server::new("ds");
    let (mut a, mut b, _e, _f) = setup(&server);
    let c = a
        .commit_with(|mut d| {
            let x = d.added[0].1.clone();
            d.added[0].1 = d.added[1].1.clone();
            d.added[1].1 = x;
            d
        })
        .unwrap();
    assert!(matches!(b.receive(&c.commit), Err(Error::DeltaMismatch)));
}

#[test]
fn hidden_add_is_rejected() {
    // Commit добавляет два устройства, а в дельте объявлено одно.
    let server = Server::new("ds");
    let (mut a, mut b, _e, _f) = setup(&server);
    let c = a
        .commit_with(|mut d| {
            d.added.truncate(1);
            d
        })
        .unwrap();
    assert!(matches!(b.receive(&c.commit), Err(Error::DeltaMismatch)));
}

#[test]
fn renamed_leaf_in_update_path_is_rejected() {
    // Участник подменяет credential своего листа через UpdatePath (self-update с чужим id
    // при том же ключе); дельта пустая и «честная». Получатель обязан отвергнуть.
    let server = Server::new("ds");
    let mut a = Device::new("a", &server.entry).unwrap();
    let mut b = Device::new("b", &server.entry).unwrap();
    a.create_group(GID).unwrap();
    a.receive(&server.add(0, &b.key_package().unwrap()))
        .unwrap();
    let c = a.commit().unwrap();
    a.merge_pending().unwrap();
    b.join(&c.welcome.unwrap()).unwrap();
    let rename = a.commit_rename("b").unwrap();
    assert!(matches!(b.receive(&rename), Err(Error::Unauthorized(_))));
    assert_eq!(b.roster().unwrap(), vec![(0, "a".into()), (1, "b".into())]);
}

#[test]
fn welcome_from_foreign_instance_is_rejected() {
    let ours = Server::new("ds");
    let theirs = Server::new("other-ds");
    let mut a = Device::new("a", &theirs.entry).unwrap();
    let mut b = Device::new("b", &ours.entry).unwrap();
    a.create_group(GID).unwrap();
    a.receive(&theirs.add(0, &b.key_package().unwrap()))
        .unwrap();
    let c = a.commit().unwrap();
    assert!(matches!(
        b.join(&c.welcome.unwrap()),
        Err(Error::Unauthorized(_))
    ));
}

#[test]
fn proposal_signed_by_unknown_key_is_rejected() {
    let ours = Server::new("ds");
    let fake = Server::new("ds");
    let (mut a, _b, _e, _f) = setup(&ours);
    let g = Device::new("g", &ours.entry).unwrap();
    assert!(a.receive(&fake.add(1, &g.key_package().unwrap())).is_err());
}

#[test]
fn proposals_must_be_bound_to_their_device() {
    let server = Server::new("ds");
    let (mut a, _b, _e, _f) = setup(&server);
    let g = Device::new("g", &server.entry).unwrap();
    let kp = g.key_package().unwrap();
    // Add без AAD, Add с чужим id в AAD, Remove листа b с id другого устройства.
    assert!(matches!(
        a.receive(&server.es().add(GID, 1, &kp, &[])),
        Err(Error::Unauthorized(_))
    ));
    assert!(matches!(
        a.receive(&server.add_as(1, &kp, "h")),
        Err(Error::Unauthorized(_))
    ));
    assert!(matches!(
        a.receive(&server.remove_as(1, 1, "e")),
        Err(Error::Unauthorized(_))
    ));
    assert_eq!(
        a.receive(&server.remove_as(1, 1, "b")).unwrap(),
        Event::Proposal
    );
}

#[test]
fn poisoned_key_package_is_dropped_not_fatal() {
    // Пакет со сроком в 2 с истекает, пока Add ждёт commit-а; без фильтра openmls отверг бы
    // весь commit, и ожидающий Remove так и не применился бы.
    let server = Server::new("ds");
    let (mut a, mut b, _e, _f) = setup(&server);
    let p = Device::new("p", &server.entry).unwrap();
    let short = p.key_package_with_lifetime(Some(2)).unwrap();
    assert_eq!(a.receive(&server.add(1, &short)).unwrap(), Event::Proposal);
    assert_eq!(b.receive(&server.add(1, &short)).unwrap(), Event::Proposal);
    // Заодно сервер удаляет b: Remove обязан пройти.
    let rm = server.remove_as(1, 1, "b");
    assert_eq!(a.receive(&rm).unwrap(), Event::Proposal);
    assert_eq!(b.receive(&rm).unwrap(), Event::Proposal);
    std::thread::sleep(std::time::Duration::from_secs(3));
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["p".to_string()]);
    assert_eq!(c.delta.removed, vec![1]);
    assert_eq!(c.delta.added.len(), 2);
    a.merge_pending().unwrap();
    assert_eq!(b.receive(&c.commit).unwrap(), Event::Removed);
}

#[test]
fn duplicate_hpke_key_is_dropped() {
    // Один и тот же KeyPackage в двух Add (разные предложения — разные эпохи подписи не
    // нужны: openmls хранит оба). При commit-е второй Add выбрасывается как повтор
    // HPKE-ключей; без этого openmls отверг бы весь commit.
    let server = Server::new("ds");
    let (mut a, _b, _e, _f) = setup(&server);
    let q = Device::new("q", &server.entry).unwrap();
    let kp = q.key_package().unwrap();
    assert_eq!(a.receive(&server.add(1, &kp)).unwrap(), Event::Proposal);
    let second = a.receive(&server.add_as(1, &kp, "q"));
    if second.is_ok() {
        assert_eq!(a.pending_adds(), 4);
    }
    let c = a.commit().unwrap();
    assert_eq!(c.delta.added.iter().filter(|(_, id)| id == "q").count(), 1);
    if second.is_ok() {
        assert_eq!(c.dropped, vec!["q".to_string()]);
    }
}

#[test]
fn external_proposal_matches_openmls_when_aad_is_empty() {
    // Своя подпись external-предложений (нужна ради AAD) побайтно совпадает с openmls.
    let server = Server::new("ds");
    let d = Device::new("d", &server.entry).unwrap();
    let raw = d.key_package().unwrap();
    let provider = OpenMlsRustCrypto::default();
    let kp = KeyPackageIn::tls_deserialize_exact_bytes(&raw)
        .unwrap()
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .unwrap();
    let reference = ExternalProposal::new_add::<OpenMlsRustCrypto>(
        kp,
        GroupId::from_slice(GID),
        GroupEpoch::from(7),
        &server.signer,
        SenderExtensionIndex::new(0),
    )
    .unwrap()
    .tls_serialize_detached()
    .unwrap();
    assert_eq!(server.es().add(GID, 7, &raw, &[]), reference);
    let reference = ExternalProposal::new_remove::<OpenMlsRustCrypto>(
        LeafNodeIndex::new(3),
        GroupId::from_slice(GID),
        GroupEpoch::from(7),
        &server.signer,
        SenderExtensionIndex::new(0),
    )
    .unwrap()
    .tls_serialize_detached()
    .unwrap();
    assert_eq!(server.es().remove(GID, 7, 3, &[]), reference);
}

#[test]
fn own_commit_from_stream_is_merged_after_lost_response() {
    // Ответ DS потерялся: автор не применил commit, но узнаёт его в потоке группы.
    let server = Server::new("ds");
    let (mut a, mut b, _e, _f) = setup(&server);
    let c = a.commit().unwrap();
    assert_eq!(a.receive(&c.commit).unwrap(), Event::Commit { epoch: 2 });
    assert_eq!(b.receive(&c.commit).unwrap(), Event::Commit { epoch: 2 });
    assert_eq!(a.roster().unwrap(), b.roster().unwrap());
}

#[test]
fn own_message_that_was_not_sent_is_rejected() {
    // Свой commit, отброшенный после отказа DS, в потоке быть не может: это подделка метки
    // отправителя или рассинхрон — молча игнорировать нельзя.
    let server = Server::new("ds");
    let (mut a, _b, _e, _f) = setup(&server);
    let c = a.commit().unwrap();
    a.clear_pending().unwrap();
    assert!(matches!(a.receive(&c.commit), Err(Error::Unauthorized(_))));
}

#[test]
fn duplicate_signature_key_is_dropped() {
    // Второй пакет того же устройства (другие HPKE-ключи, тот же ключ подписи) и пакет
    // устройства, которое уже в группе, выбрасываются до commit-а.
    let server = Server::new("ds");
    let (mut a, b, _e, _f) = setup(&server);
    let q = Device::new("q", &server.entry).unwrap();
    for kp in [
        q.key_package().unwrap(),
        q.key_package().unwrap(),
        b.key_package().unwrap(),
    ] {
        assert_eq!(a.receive(&server.add(1, &kp)).unwrap(), Event::Proposal);
    }
    let c = a.commit().unwrap();
    let mut dropped = c.dropped.clone();
    dropped.sort();
    assert_eq!(dropped, vec!["b".to_string(), "q".to_string()]);
    assert_eq!(c.delta.added.iter().filter(|(_, id)| id == "q").count(), 1);
}

/// KeyPackage устройства `id` с подменённым init_key, переподписанный ключом устройства.
fn forged_key_package(id: &str, init_key: &[u8]) -> Vec<u8> {
    let provider = OpenMlsRustCrypto::default();
    let signer = SignatureKeyPair::new(SignatureScheme::ED25519).unwrap();
    let cred = CredentialWithKey {
        credential: BasicCredential::new(id.as_bytes().to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    };
    let mut raw = KeyPackage::builder()
        .build(s4_client::CIPHERSUITE, &provider, &signer, cred)
        .unwrap()
        .key_package()
        .tls_serialize_detached()
        .unwrap();
    // version (2) + cipher_suite (2) + длина init_key (1 байт: 32) + сам ключ
    assert_eq!(raw[4], 32);
    raw[5..37].copy_from_slice(init_key);
    // подпись KeyPackage — последний вектор: длина 0x40 0x40 + 64 байта
    let tbs = raw.len() - 66;
    assert_eq!(&raw[tbs..tbs + 2], &[0x40, 0x40]);
    let sig = s4_client::wire::sign_with_label(&signer, "KeyPackageTBS", &raw[..tbs]);
    raw.truncate(tbs);
    raw.extend_from_slice(&[0x40, 0x40]);
    raw.extend_from_slice(&sig);
    raw
}

#[test]
fn init_key_equal_to_member_encryption_key_is_dropped_alone() {
    // init_key атакующего = encryption_key листа b (виден всем в дереве). Выпадает только
    // атакующий; невиновные, стоящие в очереди перед ним, входят (ревью, раунд 3, Н1).
    let server = Server::new("ds");
    let mut a = Device::new("a", &server.entry).unwrap();
    let mut b = Device::new("b", &server.entry).unwrap();
    a.create_group(GID).unwrap();
    let bkp = b.key_package().unwrap();
    a.receive(&server.add(0, &bkp)).unwrap();
    let c = a.commit().unwrap();
    a.merge_pending().unwrap();
    b.join(&c.welcome.unwrap()).unwrap();
    let target = s4_client::wire::parse_key_package(&bkp)
        .unwrap()
        .encryption_key;
    for i in 0..3 {
        let d = Device::new(&format!("n{i}"), &server.entry).unwrap();
        a.receive(&server.add(1, &d.key_package().unwrap()))
            .unwrap();
    }
    a.receive(&server.add(1, &forged_key_package("m", &target)))
        .unwrap();
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["m".to_string()]);
    assert_eq!(c.delta.added.len(), 3);
}

#[test]
fn init_key_equal_to_other_add_encryption_key_is_dropped_alone() {
    let server = Server::new("ds");
    let (mut a, _b, _e, _f) = setup(&server);
    let n1 = Device::new("n1", &server.entry).unwrap();
    let kp1 = n1.key_package().unwrap();
    let enc1 = s4_client::wire::parse_key_package(&kp1)
        .unwrap()
        .encryption_key;
    a.receive(&server.add(1, &kp1)).unwrap();
    a.receive(&server.add(1, &forged_key_package("n2", &enc1)))
        .unwrap();
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["n2".to_string()]);
    assert!(c.delta.added.iter().any(|(_, id)| id == "n1"));
}

fn vector(out: &mut Vec<u8>, v: &[u8]) {
    assert!(v.len() < 1 << 14);
    if v.len() < 1 << 6 {
        out.push(v.len() as u8);
    } else {
        out.extend_from_slice(&(v.len() as u16 | 0x4000).to_be_bytes());
    }
    out.extend_from_slice(v);
}

fn random32() -> Vec<u8> {
    let provider = OpenMlsRustCrypto::default();
    provider.rand().random_vec(32).unwrap()
}

/// KeyPackage, собранный вручную по RFC 9420 §10: произвольные init- и encryption-ключи и
/// расширения листа, обе подписи настоящие.
fn built_key_package(
    id: &str,
    init: &[u8],
    enc: &[u8],
    leaf_ext: &[u8],
    cap_ext: &[u8],
) -> Vec<u8> {
    let signer = SignatureKeyPair::new(SignatureScheme::ED25519).unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut leaf = Vec::new();
    vector(&mut leaf, enc);
    vector(&mut leaf, &signer.to_public_vec());
    leaf.extend_from_slice(&1u16.to_be_bytes()); // Basic
    vector(&mut leaf, id.as_bytes());
    vector(&mut leaf, &[0, 1]); // versions
    vector(&mut leaf, &[0, 1]); // cipher_suites
    vector(&mut leaf, cap_ext); // extensions
    vector(&mut leaf, &[]); // proposals
    vector(&mut leaf, &[0, 1]); // credentials
    leaf.push(1); // leaf_node_source = key_package
    leaf.extend_from_slice(&(now - 3600).to_be_bytes());
    leaf.extend_from_slice(&(now + 30 * 24 * 3600).to_be_bytes());
    vector(&mut leaf, leaf_ext);
    let leaf_sig = s4_client::wire::sign_with_label(&signer, "LeafNodeTBS", &leaf);
    vector(&mut leaf, &leaf_sig);
    let mut kp = vec![0, 1, 0, 1];
    vector(&mut kp, init);
    kp.extend_from_slice(&leaf);
    vector(&mut kp, &[]); // KeyPackage.extensions
    let sig = s4_client::wire::sign_with_label(&signer, "KeyPackageTBS", &kp);
    vector(&mut kp, &sig);
    kp
}

/// Группа A+B; возвращает KeyPackage B (по нему виден encryption_key его листа).
fn pair(server: &Server) -> (Device, Device, Vec<u8>) {
    let mut a = Device::new("a", &server.entry).unwrap();
    let mut b = Device::new("b", &server.entry).unwrap();
    a.create_group(GID).unwrap();
    let bkp = b.key_package().unwrap();
    a.receive(&server.add(0, &bkp)).unwrap();
    let c = a.commit().unwrap();
    a.merge_pending().unwrap();
    b.join(&c.welcome.unwrap()).unwrap();
    (a, b, bkp)
}

#[test]
fn encryption_key_equal_to_member_leaf_is_dropped_alone() {
    let server = Server::new("ds");
    let (mut a, mut b, bkp) = pair(&server);
    let b_enc = s4_client::wire::parse_key_package(&bkp)
        .unwrap()
        .encryption_key;
    let n0 = Device::new("n0", &server.entry).unwrap();
    for kp in [
        n0.key_package().unwrap(),
        built_key_package("m", &random32(), &b_enc, &[], &[]),
    ] {
        let p = server.add(1, &kp);
        a.receive(&p).unwrap();
        b.receive(&p).unwrap();
    }
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["m".to_string()]);
    assert_eq!(c.delta.added, vec![(2, "n0".to_string())]);
    a.merge_pending().unwrap();
    assert_eq!(b.receive(&c.commit).unwrap(), Event::Commit { epoch: 2 });
}

#[test]
fn cross_collision_in_reverse_order_drops_the_later_add() {
    // Сначала init = X, потом encryption = X: выпадает второй, первый входит.
    let server = Server::new("ds");
    let (mut a, _b, _bkp) = pair(&server);
    let x = random32();
    a.receive(&server.add(1, &built_key_package("m1", &x, &random32(), &[], &[])))
        .unwrap();
    a.receive(&server.add(1, &built_key_package("m2", &random32(), &x, &[], &[])))
        .unwrap();
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["m2".to_string()]);
    assert_eq!(c.delta.added, vec![(2, "m1".to_string())]);
}

#[test]
fn duplicate_init_key_only_is_dropped() {
    let server = Server::new("ds");
    let (mut a, _b, _bkp) = pair(&server);
    let x = random32();
    a.receive(&server.add(1, &built_key_package("m1", &x, &random32(), &[], &[])))
        .unwrap();
    a.receive(&server.add(1, &built_key_package("m2", &x, &random32(), &[], &[])))
        .unwrap();
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["m2".to_string()]);
}

#[test]
fn init_key_equal_to_removed_member_key_is_kept() {
    // Участник, которого этот commit удаляет, в проверку уникальности не входит (как в openmls):
    // честный Add с совпадающим ключом не выбрасывается, получатель принимает commit.
    let server = Server::new("ds");
    let mut a = Device::new("a", &server.entry).unwrap();
    let mut b = Device::new("b", &server.entry).unwrap();
    let mut c = Device::new("c", &server.entry).unwrap();
    a.create_group(GID).unwrap();
    let ckp = c.key_package().unwrap();
    for kp in [b.key_package().unwrap(), ckp.clone()] {
        a.receive(&server.add(0, &kp)).unwrap();
    }
    let first = a.commit().unwrap();
    a.merge_pending().unwrap();
    let w = first.welcome.unwrap();
    b.join(&w).unwrap();
    c.join(&w).unwrap();
    let c_enc = s4_client::wire::parse_key_package(&ckp)
        .unwrap()
        .encryption_key;
    let rm = server.remove_as(1, 2, "c");
    let addm = server.add(1, &built_key_package("m", &c_enc, &random32(), &[], &[]));
    for p in [&rm, &addm] {
        a.receive(p).unwrap();
        b.receive(p).unwrap();
    }
    let cm = a.commit().unwrap();
    assert!(cm.dropped.is_empty(), "{:?}", cm.dropped);
    assert_eq!(cm.delta.removed, vec![2]);
    a.merge_pending().unwrap();
    assert_eq!(b.receive(&cm.commit).unwrap(), Event::Commit { epoch: 2 });
}

#[test]
fn leaf_extension_not_in_capabilities_is_dropped_alone() {
    // Расширение листа 0xff00 без записи в capabilities: openmls отверг бы commit со всей пачкой
    // (ревью, раунд 3, П1). С записью в capabilities тот же пакет допустим.
    let server = Server::new("ds");
    let (mut a, mut b, _bkp) = pair(&server);
    let n0 = Device::new("n0", &server.entry).unwrap();
    for kp in [
        n0.key_package().unwrap(),
        built_key_package(
            "ok",
            &random32(),
            &random32(),
            &[0xff, 0x00, 0x00],
            &[0xff, 0x00],
        ),
        built_key_package("m", &random32(), &random32(), &[0xff, 0x00, 0x00], &[]),
    ] {
        let p = server.add(1, &kp);
        a.receive(&p).unwrap();
        b.receive(&p).unwrap();
    }
    let c = a.commit().unwrap();
    assert_eq!(c.dropped, vec!["m".to_string()]);
    assert_eq!(c.delta.added.len(), 2);
    a.merge_pending().unwrap();
    assert_eq!(b.receive(&c.commit).unwrap(), Event::Commit { epoch: 2 });
}
