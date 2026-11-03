// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Спайк S4: устройство на OpenMLS, работающее с прототипом Delivery Service.
//!
//! Модель (ARCHITECTURE §4.3, ADR-0016 п. 2–4): сервер — external sender, публикует только
//! предложения Add/Remove; commit делает участник. Автор commit-а кладёт в
//! `authenticated_data` дельту состава (см. [`delta`]), получатель до merge сверяет её с
//! фактическим действием commit-а. Политика к предложениям сервера — как в S1: только Add и
//! Remove от `Sender::External`, и каждое привязано к устройству через `authenticated_data`
//! под подписью сервера ([`wire::proposal_aad`]); commit без объявленного сервером Remove не
//! применяется; лист автора commit-а (UpdatePath, Update) не может сменить credential.
//! Код спайка не продуктовый: ключи в памяти без `zeroize`, одно устройство = одна группа.

pub mod delta;
pub mod http;
pub mod wire;

use std::collections::{BTreeSet, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use tls_codec::Serialize as _;

pub use delta::RosterDelta;

/// Ciphersuite v1 (ADR-0004).
pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Верхняя граница срока KeyPackage, который клиент готов добавить (ADR-0016 «Последствия»).
pub const MAX_KEY_PACKAGE_LIFETIME_SECS: u64 = 90 * 24 * 3600;

/// Минимальный остаток срока добавляемого KeyPackage — как `MinKeyPackageLifetime` у DS.
pub const MIN_KEY_PACKAGE_REMAINING_SECS: u64 = 3600;

const WIRE_FORMAT_POLICY: WireFormatPolicy = PURE_CIPHERTEXT_WIRE_FORMAT_POLICY;

#[derive(Debug)]
pub enum Error {
    NoGroup,
    Unauthorized(&'static str),
    DeltaMismatch,
    Codec(String),
    Mls(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NoGroup => write!(f, "нет группы"),
            Error::Unauthorized(m) => write!(f, "отвергнуто политикой: {m}"),
            Error::DeltaMismatch => write!(f, "дельта состава не совпадает с commit-ом"),
            Error::Codec(m) => write!(f, "кодирование: {m}"),
            Error::Mls(m) => write!(f, "MLS: {m}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

fn mls<E: std::fmt::Debug>(e: E) -> Error {
    Error::Mls(format!("{e:?}"))
}

fn codec<E: std::fmt::Debug>(e: E) -> Error {
    Error::Codec(format!("{e:?}"))
}

/// Результат обработки handshake-сообщения.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Proposal,
    Commit {
        epoch: u64,
    },
    /// Commit удалил это устройство.
    Removed,
    /// Собственное сообщение вернулось от сервера и уже учтено.
    Ignored,
}

/// Подготовленный commit: применяется у автора только после подтверждения DS.
pub struct Commit {
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
    pub delta: RosterDelta,
    /// Add, выброшенные из очереди перед commit-ом (негодный KeyPackage): их устройства.
    pub dropped: Vec<String>,
}

pub struct Device {
    pub id: String,
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
    /// Закреплённый ключ инстанса: ExternalSender в TLS-кодировке.
    server: Vec<u8>,
    /// Отправленный, но ещё не подтверждённый commit: если ответ DS потерялся, клиент узнаёт
    /// его в потоке группы побайтно и применяет.
    pending_commit: Option<Vec<u8>>,
}

/// Id устройства из Basic credential; не-UTF-8 и не-Basic считаются пустым id и ни с чем не
/// совпадают (B02 задаёт канонический вид id).
fn identity(c: &Credential) -> String {
    BasicCredential::try_from(c.clone())
        .ok()
        .and_then(|b| String::from_utf8(b.identity().to_vec()).ok())
        .unwrap_or_default()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Device {
    /// Устройство с Basic credential = id (в продукте — id, подписанный ключом идентичности).
    pub fn new(id: &str, server: &[u8]) -> Result<Self> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(mls)?;
        signer.store(provider.storage()).map_err(mls)?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(id.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            id: id.to_owned(),
            provider,
            signer,
            credential,
            group: None,
            server: server.to_vec(),
            pending_commit: None,
        })
    }

    /// Одноразовый KeyPackage (TLS-кодировка структуры KeyPackage, без MLSMessage).
    pub fn key_package(&self) -> Result<Vec<u8>> {
        self.key_package_with_lifetime(None)
    }

    /// KeyPackage с заданным сроком в секундах (только для тестов негодных пакетов).
    pub fn key_package_with_lifetime(&self, secs: Option<u64>) -> Result<Vec<u8>> {
        let mut b = KeyPackage::builder();
        if let Some(s) = secs {
            b = b.key_package_lifetime(Lifetime::new(s));
        }
        b.build(
            CIPHERSUITE,
            &self.provider,
            &self.signer,
            self.credential.clone(),
        )
        .map_err(mls)?
        .key_package()
        .tls_serialize_detached()
        .map_err(codec)
    }

    pub fn create_group(&mut self, gid: &[u8]) -> Result<()> {
        let sender = openmls::extensions::ExternalSender::tls_deserialize_exact_bytes(&self.server)
            .map_err(codec)?;
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .wire_format_policy(WIRE_FORMAT_POLICY)
            .with_group_context_extensions(
                Extensions::single(Extension::ExternalSenders(vec![sender])).map_err(mls)?,
            )
            .build();
        self.group = Some(
            MlsGroup::new_with_group_id(
                &self.provider,
                &self.signer,
                &config,
                GroupId::from_slice(gid),
                self.credential.clone(),
            )
            .map_err(mls)?,
        );
        Ok(())
    }

    /// Войти по Welcome; external sender группы обязан совпасть с закреплённым ключом инстанса.
    /// Состав после входа клиент сверяет с картой DS (см. e2e/load): Welcome сам по себе не
    /// доказывает, что дерево то, о котором знает сервер.
    pub fn join(&mut self, welcome: &[u8]) -> Result<()> {
        let msg = MlsMessageIn::tls_deserialize_exact_bytes(welcome).map_err(codec)?;
        let MlsMessageBodyIn::Welcome(welcome) = msg.extract() else {
            return Err(Error::Unauthorized("не Welcome"));
        };
        let config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .wire_format_policy(WIRE_FORMAT_POLICY)
            .build();
        let staged =
            StagedWelcome::new_from_welcome(&self.provider, &config, welcome, None).map_err(mls)?;
        let senders = staged
            .group_context()
            .extensions()
            .external_senders()
            .ok_or(Error::Unauthorized("в группе нет external sender"))?;
        let pinned = senders.len() == 1
            && senders[0].tls_serialize_detached().map_err(codec)? == self.server;
        if !pinned {
            return Err(Error::Unauthorized(
                "external sender группы не совпадает с ключом инстанса",
            ));
        }
        self.group = Some(staged.into_group(&self.provider).map_err(mls)?);
        Ok(())
    }

    fn group(&self) -> Result<&MlsGroup> {
        self.group.as_ref().ok_or(Error::NoGroup)
    }

    pub fn epoch(&self) -> Result<u64> {
        Ok(self.group()?.epoch().as_u64())
    }

    pub fn own_leaf(&self) -> Result<u32> {
        Ok(self.group()?.own_leaf_index().u32())
    }

    /// Состав группы: (лист, id устройства).
    pub fn roster(&self) -> Result<Vec<(u32, String)>> {
        let mut r: Vec<_> = self
            .group()?
            .members()
            .map(|m| (m.index.u32(), identity(&m.credential)))
            .collect();
        r.sort();
        Ok(r)
    }

    /// Есть ли в очереди предложения сервера, которые ждут commit-а.
    pub fn has_pending_proposals(&self) -> bool {
        self.group
            .as_ref()
            .is_some_and(|g| g.pending_proposals().next().is_some())
    }

    /// Сколько Add ждёт commit-а.
    pub fn pending_adds(&self) -> usize {
        self.group.as_ref().map_or(0, |g| {
            g.pending_proposals()
                .filter(|p| matches!(p.proposal(), Proposal::Add(_)))
                .count()
        })
    }

    /// Стоит ли в очереди Remove этого устройства (тогда оно не коммитит).
    pub fn removal_pending(&self) -> bool {
        let Some(g) = &self.group else { return false };
        let own = g.own_leaf_index();
        g.pending_proposals()
            .any(|p| matches!(p.proposal(), Proposal::Remove(r) if r.removed() == own))
    }

    /// Обработать Proposal или Commit из потока группы.
    pub fn receive(&mut self, blob: &[u8]) -> Result<Event> {
        let msg = MlsMessageIn::tls_deserialize_exact_bytes(blob).map_err(codec)?;
        let pm = msg.try_into_protocol_message().map_err(mls)?;
        let group = self.group.as_mut().ok_or(Error::NoGroup)?;
        let processed = group.process_message(&self.provider, pm).map_err(mls)?;
        let aad = processed.aad().to_vec();
        let sender = processed.sender().clone();
        match processed.into_content() {
            ProcessedMessageContent::ProposalMessage(p) => {
                authorize(group, p.proposal(), p.sender(), &aad)?;
                group
                    .store_pending_proposal(self.provider.storage(), *p)
                    .map_err(mls)?;
                Ok(Event::Proposal)
            }
            ProcessedMessageContent::StagedCommitMessage(c) => {
                verify_commit(group, &c, &sender, &aad)?;
                let removed = c.self_removed();
                group.merge_staged_commit(&self.provider, *c).map_err(mls)?;
                if removed {
                    self.group = None;
                    return Ok(Event::Removed);
                }
                Ok(Event::Commit {
                    epoch: group.epoch().as_u64(),
                })
            }
            ProcessedMessageContent::ExternalJoinProposalMessage(_) => {
                Err(Error::Unauthorized("вход по предложению не-участника"))
            }
            ProcessedMessageContent::ApplicationMessage(_) => {
                Err(Error::Unauthorized("не handshake"))
            }
            // Открытый свой commit при зашифрованных handshake недостижим.
            ProcessedMessageContent::OwnPendingCommit => {
                Err(Error::Unauthorized("свой открытый commit"))
            }
            // Своё зашифрованное сообщение: метка отправителя в sender_data известна всем
            // участникам эпохи и автора не доказывает, поэтому верится только побайтному
            // совпадению с отправленным commit-ом. Совпало — DS его принял, а ответ потерялся
            // (ревью N4): применяем. Не совпало — чужая подделка или рассинхрон.
            ProcessedMessageContent::OwnPrivateMessage => {
                if self.pending_commit.as_deref() == Some(blob) {
                    self.merge_pending()?;
                    return Ok(Event::Commit {
                        epoch: self.epoch()?,
                    });
                }
                Err(Error::Unauthorized(
                    "своё сообщение, которого клиент не отправлял",
                ))
            }
        }
    }

    /// Закоммитить предложения из очереди. Негодные Add (истёкший или слишком долгий срок,
    /// capabilities без ciphersuite группы, повтор HPKE-ключа) выбрасываются до commit-а:
    /// иначе openmls отвергнет весь commit, и один такой пакет заморозил бы группу вместе с
    /// ожидающими Remove. Дельта вычисляется заранее и кладётся в AAD; после построения
    /// сверяется с фактическим действием (порядок Add задаёт openmls).
    pub fn commit(&mut self) -> Result<Commit> {
        self.commit_with(|d| d)
    }

    /// То же с подменой дельты — только для проверки, что получатели ловят ложь.
    pub fn commit_with(&mut self, tamper: impl Fn(RosterDelta) -> RosterDelta) -> Result<Commit> {
        let group = self.group.as_mut().ok_or(Error::NoGroup)?;
        let mut dropped = drop_invalid_adds(group, &self.provider)?;
        loop {
            let mut predicted = predicted_delta(group);
            let mut result = None;
            for _ in 0..2 {
                group.set_aad(tamper(predicted.clone()).encode());
                let built = group.commit_to_pending_proposals(&self.provider, &self.signer);
                group.set_aad(Vec::new()); // AAD не должен утечь в следующее сообщение
                let (commit, welcome, _gi) = match built {
                    Ok(x) => x,
                    Err(CommitToPendingProposalsError::CreateCommitError(
                        CreateCommitError::ProposalValidationError(_),
                    )) => {
                        // Запасной путь: openmls не назвал виновника — выбрасываем Add по одному.
                        result = Some(None);
                        break;
                    }
                    Err(e) => return Err(mls(e)),
                };
                let staged = group.pending_commit().ok_or(Error::NoGroup)?;
                let actual = actual_delta(group, staged);
                if actual.same_effect(&predicted) {
                    let bytes = commit.tls_serialize_detached().map_err(codec)?;
                    self.pending_commit = Some(bytes.clone());
                    result = Some(Some(Commit {
                        commit: bytes,
                        welcome: welcome
                            .map(|w| w.tls_serialize_detached().map_err(codec))
                            .transpose()?,
                        delta: tamper(predicted),
                        dropped: Vec::new(),
                    }));
                    break;
                }
                group
                    .clear_pending_commit(self.provider.storage())
                    .map_err(mls)?;
                predicted = actual;
            }
            match result {
                Some(Some(mut c)) => {
                    c.dropped = dropped;
                    return Ok(c);
                }
                Some(None) => {
                    let Some(victim) = first_add(group) else {
                        return Err(Error::Unauthorized(
                            "commit отвергнут openmls без негодных Add",
                        ));
                    };
                    group
                        .remove_pending_proposal(self.provider.storage(), &victim.0)
                        .map_err(mls)?;
                    dropped.push(victim.1);
                }
                None => return Err(Error::DeltaMismatch),
            }
        }
    }

    /// DS принял commit — применить.
    pub fn merge_pending(&mut self) -> Result<()> {
        self.pending_commit = None;
        let group = self.group.as_mut().ok_or(Error::NoGroup)?;
        group.merge_pending_commit(&self.provider).map_err(mls)
    }

    /// DS отверг commit — отбросить и ждать новую эпоху.
    pub fn clear_pending(&mut self) -> Result<()> {
        self.pending_commit = None;
        let group = self.group.as_mut().ok_or(Error::NoGroup)?;
        group
            .clear_pending_commit(self.provider.storage())
            .map_err(mls)
    }

    /// Commit-«переименование»: self-update с другим id в credential при том же ключе —
    /// только для проверки, что получатели его отвергают.
    #[doc(hidden)]
    pub fn commit_rename(&mut self, new_id: &str) -> Result<Vec<u8>> {
        let group = self.group.as_mut().ok_or(Error::NoGroup)?;
        let params = LeafNodeParameters::builder()
            .with_credential_with_key(CredentialWithKey {
                credential: BasicCredential::new(new_id.as_bytes().to_vec()).into(),
                signature_key: self.signer.to_public_vec().into(),
            })
            .build();
        group.set_aad(RosterDelta::default().encode());
        let bundle = group
            .self_update(&self.provider, &self.signer, params)
            .map_err(mls)?;
        bundle.commit().tls_serialize_detached().map_err(codec)
    }
}

/// Предложение от сервера (`Sender::External(0)`), только Add или Remove, и его
/// `authenticated_data` называет то же устройство, что и само предложение: Add — credential
/// KeyPackage, Remove — лист, который удаляется. Без этого Remove был бы привязан только к
/// индексу листа, и ложная дельта в карте DS удалила бы не то устройство.
fn authorize(group: &MlsGroup, p: &Proposal, sender: &Sender, aad: &[u8]) -> Result<()> {
    if !matches!(sender, Sender::External(i) if *i == SenderExtensionIndex::new(0)) {
        return Err(Error::Unauthorized("предложение не от сервера"));
    }
    let bound = wire::parse_proposal_aad(aad)
        .ok_or(Error::Unauthorized("предложение без привязки к устройству"))?;
    match p {
        Proposal::Add(a) => {
            let kp = a.key_package();
            if identity(kp.leaf_node().credential()) != bound {
                return Err(Error::Unauthorized("Add назван для другого устройства"));
            }
            let raw = kp.tls_serialize_detached().map_err(codec)?;
            let info = wire::parse_key_package(&raw)
                .ok_or(Error::Unauthorized("KeyPackage не разбирается"))?;
            if info.not_after > now_secs() + MAX_KEY_PACKAGE_LIFETIME_SECS {
                return Err(Error::Unauthorized("срок KeyPackage больше допустимого"));
            }
            Ok(())
        }
        Proposal::Remove(r) => {
            let target = group.member(r.removed()).map(identity).unwrap_or_default();
            if target != bound {
                return Err(Error::Unauthorized("Remove указывает на другое устройство"));
            }
            Ok(())
        }
        _ => Err(Error::Unauthorized(
            "от сервера принимаются только Add и Remove",
        )),
    }
}

fn occupied(group: &MlsGroup) -> BTreeSet<u32> {
    group.members().map(|m| m.index.u32()).collect()
}

/// Первый Add в очереди: (ссылка, id устройства).
fn first_add(group: &MlsGroup) -> Option<(openmls::ciphersuite::hash_ref::ProposalRef, String)> {
    group.pending_proposals().find_map(|p| match p.proposal() {
        Proposal::Add(a) => Some((
            p.proposal_reference_ref().clone(),
            identity(a.key_package().leaf_node().credential()),
        )),
        _ => None,
    })
}

/// Выбрасывает из очереди Add с негодным KeyPackage; возвращает id их устройств.
fn drop_invalid_adds(group: &mut MlsGroup, provider: &OpenMlsRustCrypto) -> Result<Vec<String>> {
    let now = now_secs();
    // Повторяет проверку уникальности ключей openmls при сборке commit-а (RFC 9420, ValSem101–104):
    // ключи подписи и шифрования участников, которых этот commit не удаляет, плюс ключи уже
    // принятых Add; encryption_key Add не должен совпадать ни с ключом шифрования, ни с init-
    // ключом, init_key — ни с тем, ни с другим. Перекрёстную коллизию init ↔ encryption
    // атакующий собирает из ключа листа, видного всем в дереве (ревью, раунд 3, Н1).
    let removed: HashSet<u32> = group
        .pending_proposals()
        .filter_map(|p| match p.proposal() {
            Proposal::Remove(r) => Some(r.removed().u32()),
            _ => None,
        })
        .collect();
    let staying: Vec<_> = group
        .members()
        .filter(|m| !removed.contains(&m.index.u32()))
        .collect();
    let mut sig: HashSet<Vec<u8>> = staying.iter().map(|m| m.signature_key.clone()).collect();
    let mut enc: HashSet<Vec<u8>> = staying.iter().map(|m| m.encryption_key.clone()).collect();
    let mut init: HashSet<Vec<u8>> = HashSet::new();
    let mut victims = Vec::new();
    for p in group.pending_proposals() {
        let Proposal::Add(a) = p.proposal() else {
            continue;
        };
        let kp = a.key_package();
        let id = identity(kp.leaf_node().credential());
        let raw = kp.tls_serialize_detached().map_err(codec)?;
        let Some(info) = wire::parse_key_package(&raw) else {
            victims.push((p.proposal_reference_ref().clone(), id));
            continue;
        };
        // Срок пакета каждый получатель проверяет по своим часам в момент обработки commit-а, и
        // устройство, обработавшее commit позже срока, застревает в старой эпохе. Запас — не
        // меньше того, что DS требует при резервировании; в продукте — горизонт офлайна (B02).
        let bad = info.not_after < now + MIN_KEY_PACKAGE_REMAINING_SECS
            || info.not_before > now
            || !info.leaf_extensions_valid()
            || !info.versions.contains(&1)
            || !info.cipher_suites.contains(&(CIPHERSUITE as u16))
            || !info.credentials.contains(&1)
            || info.init_key == info.encryption_key
            || sig.contains(&info.signature_key)
            || enc.contains(&info.encryption_key)
            || init.contains(&info.encryption_key)
            || enc.contains(&info.init_key)
            || init.contains(&info.init_key);
        if bad {
            victims.push((p.proposal_reference_ref().clone(), id));
            continue;
        }
        // Ключи запоминаются только у принятых Add: выброшенный не должен утянуть за собой
        // невиновного с тем же ключом.
        sig.insert(info.signature_key);
        enc.insert(info.encryption_key);
        init.insert(info.init_key);
    }
    let mut dropped = Vec::new();
    for (r, id) in victims {
        group
            .remove_pending_proposal(provider.storage(), &r)
            .map_err(mls)?;
        dropped.push(id);
    }
    Ok(dropped)
}

fn predicted_delta(group: &MlsGroup) -> RosterDelta {
    let mut removed = Vec::new();
    let mut added_ids = Vec::new();
    for p in group.pending_proposals() {
        match p.proposal() {
            Proposal::Remove(r) => removed.push(r.removed().u32()),
            Proposal::Add(a) => added_ids.push(identity(a.key_package().leaf_node().credential())),
            _ => {}
        }
    }
    let leaves = delta::assign_leaves(&occupied(group), &removed, added_ids.len());
    RosterDelta {
        removed,
        added: leaves.into_iter().zip(added_ids).collect(),
    }
}

fn actual_delta(group: &MlsGroup, staged: &StagedCommit) -> RosterDelta {
    let removed: Vec<u32> = staged
        .remove_proposals()
        .map(|r| r.remove_proposal().removed().u32())
        .collect();
    let ids: Vec<String> = staged
        .add_proposals()
        .map(|a| identity(a.add_proposal().key_package().leaf_node().credential()))
        .collect();
    let leaves = delta::assign_leaves(&occupied(group), &removed, ids.len());
    RosterDelta {
        removed,
        added: leaves.into_iter().zip(ids).collect(),
    }
}

/// Проверка чужого commit-а до merge: все Add/Remove — от сервера с верной привязкой, все
/// известные Remove сервера включены, лист автора (UpdatePath) и листы из Update не сменили
/// credential, дельта в AAD совпадает с фактическим действием.
fn verify_commit(
    group: &MlsGroup,
    staged: &StagedCommit,
    sender: &Sender,
    aad: &[u8],
) -> Result<()> {
    let current = |idx: LeafNodeIndex| group.member(idx).map(identity).unwrap_or_default();
    if let Some(leaf) = staged.update_path_leaf_node() {
        let Sender::Member(idx) = sender else {
            return Err(Error::Unauthorized("UpdatePath не от участника"));
        };
        if identity(leaf.credential()) != current(*idx) || current(*idx).is_empty() {
            return Err(Error::Unauthorized(
                "лист автора commit-а сменил credential",
            ));
        }
    }
    for q in staged.queued_proposals() {
        match q.proposal() {
            Proposal::Add(_) | Proposal::Remove(_) => {
                // Предложения по ссылке уже прошли `authorize` при постановке в очередь; здесь
                // отсекаются inline-предложения участников.
                if !matches!(q.sender(), Sender::External(_)) {
                    return Err(Error::Unauthorized("Add/Remove не от сервера"));
                }
            }
            Proposal::Update(u) => {
                let Sender::Member(idx) = q.sender() else {
                    return Err(Error::Unauthorized("Update не от участника"));
                };
                if identity(u.leaf_node().credential()) != current(*idx) {
                    return Err(Error::Unauthorized("Update меняет credential листа"));
                }
            }
            _ => return Err(Error::Unauthorized("недопустимое предложение в commit")),
        }
    }
    let committed: BTreeSet<u32> = staged
        .remove_proposals()
        .map(|r| r.remove_proposal().removed().u32())
        .collect();
    for p in group.pending_proposals() {
        if let Proposal::Remove(r) = p.proposal() {
            if !committed.contains(&r.removed().u32()) {
                return Err(Error::Unauthorized(
                    "commit без объявленного сервером Remove",
                ));
            }
        }
    }
    let declared = RosterDelta::decode(aad).ok_or(Error::DeltaMismatch)?;
    if !declared.same_effect(&actual_delta(group, staged)) {
        return Err(Error::DeltaMismatch);
    }
    Ok(())
}
