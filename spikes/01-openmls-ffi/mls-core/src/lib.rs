// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Спайк S1: тонкая обёртка над OpenMLS для оценки API, FFI и производительности.
//!
//! Модель из `docs/spec/ARCHITECTURE.md` §4: одно устройство = один MLS-клиент со своим
//! подписывающим ключом; сервер — Delivery Service и external sender, который только
//! подписывает предложения Add/Remove и ключей группы не имеет. Всё состояние — в памяти
//! процесса, сетевых вызовов нет. Код спайка не является продуктовым.
//!
//! Чего спайк сознательно не делает (обязательно для crypto-core, см. ADR-0016 и REPORT.md):
//! не проверяет credential добавляемых устройств (подпись ключом идентичности, право быть в
//! канале), не проверяет содержимое чужих commit-ов перед merge, опознаёт участников по
//! отображаемому имени, не обнуляет ключи в памяти.

use std::collections::HashMap;

#[cfg(feature = "bench")]
pub mod fixture;

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use tls_codec::Serialize as _;

/// Ciphersuite v1 по ADR-0004 (0x0001).
pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Версия openmls, закреплённая в Cargo.toml спайка (для вывода в демо-скриптах).
pub const OPENMLS_VERSION: &str = "0.9.2";

/// Ошибки спайка. Внутренние ошибки openmls сворачиваются в текст: для спайка важен факт
/// отказа и его причина в логе, а не типизированная иерархия.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("группа не найдена")]
    UnknownGroup,
    #[error("участник не найден")]
    UnknownMember,
    #[error("неожиданный тип сообщения")]
    UnexpectedMessage,
    #[error("предложение отвергнуто политикой клиента: {0}")]
    Unauthorized(&'static str),
    #[error("ошибка кодирования: {0}")]
    Codec(String),
    #[error("ошибка MLS: {0}")]
    Mls(String),
}

pub type Result<T> = std::result::Result<T, Error>;

fn mls<E: std::fmt::Debug>(e: E) -> Error {
    Error::Mls(format!("{e:?}"))
}

fn codec<E: std::fmt::Debug>(e: E) -> Error {
    Error::Codec(format!("{e:?}"))
}

/// Единственная политика формата: handshake-сообщения участников всегда зашифрованы.
/// Предложения external sender-а приходят открытыми, но к внешним сообщениям входящая
/// политика в openmls не применяется, поэтому ослаблять её не нужно.
const WIRE_FORMAT_POLICY: WireFormatPolicy = PURE_CIPHERTEXT_WIRE_FORMAT_POLICY;

/// Результат обработки входящего сообщения.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Received {
    /// Расшифрованное application message.
    Application { sender: String, plaintext: Vec<u8> },
    /// Предложение сохранено в очереди группы; его закоммитит участник.
    Proposal { sender: String },
    /// Commit применён, группа перешла в новую эпоху.
    Commit { epoch: u64 },
    /// Собственное зашифрованное сообщение, вернувшееся от сервера: пропускается.
    /// Заголовок с «нашим» листом не аутентифицирован — это только подсказка.
    Ignored,
}

/// Результат commit-а: сам commit и, если добавлялись участники, Welcome для них.
#[derive(Debug, Clone)]
pub struct CommitOutput {
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
}

/// Устройство: MLS-клиент с собственным подписывающим ключом и хранилищем в памяти.
pub struct Device {
    name: String,
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    groups: HashMap<Vec<u8>, MlsGroup>,
}

impl Device {
    /// Новое устройство с Basic credential = имя (в продукте — идентификатор устройства,
    /// подписанный ключом идентичности; для спайка достаточно строки).
    pub fn new(name: &str) -> Result<Self> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(mls)?;
        signer.store(provider.storage()).map_err(mls)?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(name.as_bytes().to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            name: name.to_owned(),
            provider,
            signer,
            credential,
            groups: HashMap::new(),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Одноразовый KeyPackage в TLS-кодировке — то, что устройство загружает на сервер.
    pub fn key_package(&self) -> Result<Vec<u8>> {
        self.key_package_bundle()?
            .key_package()
            .tls_serialize_detached()
            .map_err(codec)
    }

    fn key_package_bundle(&self) -> Result<KeyPackageBundle> {
        KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(mls)
    }

    /// Создать группу. `external_sender` — публичные данные external sender-а (см.
    /// [`ExternalSender::public_info`]); с ним группа принимает его предложения Add/Remove.
    pub fn create_group(&mut self, group_id: &[u8], external_sender: Option<&[u8]>) -> Result<()> {
        let mut config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .wire_format_policy(WIRE_FORMAT_POLICY);
        if let Some(bytes) = external_sender {
            let sender = openmls::extensions::ExternalSender::tls_deserialize_exact_bytes(bytes)
                .map_err(codec)?;
            config = config.with_group_context_extensions(
                Extensions::single(Extension::ExternalSenders(vec![sender])).map_err(mls)?,
            );
        }
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config.build(),
            GroupId::from_slice(group_id),
            self.credential.clone(),
        )
        .map_err(mls)?;
        self.groups.insert(group_id.to_vec(), group);
        Ok(())
    }

    /// Добавить устройства по их KeyPackage. Возвращает commit и Welcome; commit вступает в
    /// силу у отправителя после [`Device::merge_pending_commit`] (когда сервер его принял).
    pub fn add_members(
        &mut self,
        group_id: &[u8],
        key_packages: &[Vec<u8>],
    ) -> Result<CommitOutput> {
        let kps = key_packages
            .iter()
            .map(|bytes| parse_key_package(&self.provider, bytes))
            .collect::<Result<Vec<_>>>()?;
        let group = self.groups.get_mut(group_id).ok_or(Error::UnknownGroup)?;
        let (commit, welcome, _group_info) = group
            .add_members(&self.provider, &self.signer, &kps)
            .map_err(mls)?;
        Ok(CommitOutput {
            commit: commit.tls_serialize_detached().map_err(codec)?,
            welcome: Some(welcome.tls_serialize_detached().map_err(codec)?),
        })
    }

    /// Удалить устройства по именам (в продукте — по проверенному ключу идентичности).
    pub fn remove_members(&mut self, group_id: &[u8], names: &[&str]) -> Result<CommitOutput> {
        let indices = names
            .iter()
            .map(|n| self.leaf_index(group_id, n))
            .collect::<Result<Vec<_>>>()?;
        let group = self.groups.get_mut(group_id).ok_or(Error::UnknownGroup)?;
        let (commit, welcome, _group_info) = group
            .remove_members(&self.provider, &self.signer, &indices)
            .map_err(mls)?;
        Ok(CommitOutput {
            commit: commit.tls_serialize_detached().map_err(codec)?,
            welcome: welcome
                .map(|w| w.tls_serialize_detached().map_err(codec))
                .transpose()?,
        })
    }

    /// Закоммитить предложения из очереди (в том числе от external sender).
    pub fn commit_pending_proposals(&mut self, group_id: &[u8]) -> Result<CommitOutput> {
        let group = self.groups.get_mut(group_id).ok_or(Error::UnknownGroup)?;
        let (commit, welcome, _group_info) = group
            .commit_to_pending_proposals(&self.provider, &self.signer)
            .map_err(mls)?;
        Ok(CommitOutput {
            commit: commit.tls_serialize_detached().map_err(codec)?,
            welcome: welcome
                .map(|w| w.tls_serialize_detached().map_err(codec))
                .transpose()?,
        })
    }

    /// Применить свой же commit после того, как сервер его принял. Единственный способ
    /// подтвердить собственный commit — явный ответ сервера, не возврат сообщения.
    pub fn merge_pending_commit(&mut self, group_id: &[u8]) -> Result<()> {
        let group = self.groups.get_mut(group_id).ok_or(Error::UnknownGroup)?;
        group.merge_pending_commit(&self.provider).map_err(mls)
    }

    /// Отбросить свой неподтверждённый commit (сервер отверг — не та эпоха).
    pub fn clear_pending_commit(&mut self, group_id: &[u8]) -> Result<()> {
        let group = self.groups.get_mut(group_id).ok_or(Error::UnknownGroup)?;
        group
            .clear_pending_commit(self.provider.storage())
            .map_err(mls)
    }

    /// Войти в группу по Welcome. Возвращает идентификатор группы.
    pub fn join(&mut self, welcome: &[u8]) -> Result<Vec<u8>> {
        let message = MlsMessageIn::tls_deserialize_exact_bytes(welcome).map_err(codec)?;
        let MlsMessageBodyIn::Welcome(welcome) = message.extract() else {
            return Err(Error::UnexpectedMessage);
        };
        let config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .wire_format_policy(WIRE_FORMAT_POLICY)
            .build();
        let group = StagedWelcome::new_from_welcome(&self.provider, &config, welcome, None)
            .map_err(mls)?
            .into_group(&self.provider)
            .map_err(mls)?;
        let group_id = group.group_id().as_slice().to_vec();
        self.groups.insert(group_id.clone(), group);
        Ok(group_id)
    }

    /// Зашифровать application message.
    pub fn send(&mut self, group_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
        let group = self.groups.get_mut(group_id).ok_or(Error::UnknownGroup)?;
        group
            .create_message(&self.provider, &self.signer, plaintext)
            .map_err(mls)?
            .tls_serialize_detached()
            .map_err(codec)
    }

    /// Обработать входящее сообщение (application, proposal или commit). Группа
    /// определяется по заголовку сообщения.
    ///
    /// Политика к предложениям извне: openmls проверяет только подпись, кто вправе менять
    /// состав — решает приложение. Здесь: предложение входа от не-участника отвергается всегда
    /// (openmls принял бы его в любой группе); от external sender-а принимаются только Add и
    /// Remove. Проверку credential добавляемого устройства спайк не делает.
    pub fn receive(&mut self, message: &[u8]) -> Result<Received> {
        let (group_id, processed) = self.process(message)?;
        let sender = credential_name(processed.credential());
        let group = self.groups.get_mut(&group_id).ok_or(Error::UnknownGroup)?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(m) => Ok(Received::Application {
                sender,
                plaintext: m.into_bytes(),
            }),
            ProcessedMessageContent::ProposalMessage(p) => {
                authorize_proposal(&p)?;
                group
                    .store_pending_proposal(self.provider.storage(), *p)
                    .map_err(mls)?;
                Ok(Received::Proposal { sender })
            }
            ProcessedMessageContent::ExternalJoinProposalMessage(_) => Err(Error::Unauthorized(
                "вход по собственному предложению не-участника запрещён",
            )),
            // Чужой commit применяется без разбора: в продукте перед merge проверяются
            // предложения, которые он покрывает, по той же политике, что и выше.
            ProcessedMessageContent::StagedCommitMessage(c) => {
                group.merge_staged_commit(&self.provider, *c).map_err(mls)?;
                Ok(Received::Commit {
                    epoch: group.epoch().as_u64(),
                })
            }
            // Сервер вернул наш же открытый commit с совпавшим confirmation tag. При
            // зашифрованных handshake-сообщениях ветка недостижима: свой commit
            // подтверждается только явным ответом сервера (`merge_pending_commit`).
            ProcessedMessageContent::OwnPendingCommit => Err(Error::UnexpectedMessage),
            ProcessedMessageContent::OwnPrivateMessage => Ok(Received::Ignored),
        }
    }

    fn process(&mut self, message: &[u8]) -> Result<(Vec<u8>, ProcessedMessage)> {
        let message = MlsMessageIn::tls_deserialize_exact_bytes(message).map_err(codec)?;
        let protocol_message = message.try_into_protocol_message().map_err(mls)?;
        let group_id = protocol_message.group_id().as_slice().to_vec();
        let group = self.groups.get_mut(&group_id).ok_or(Error::UnknownGroup)?;
        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(mls)?;
        Ok((group_id, processed))
    }

    /// Exporter-секрет группы (RFC 9420 §8.5) — основа для ключей SFrame и mention-hint.
    pub fn export_secret(
        &self,
        group_id: &[u8],
        label: &str,
        context: &[u8],
        len: usize,
    ) -> Result<Vec<u8>> {
        self.group(group_id)?
            .export_secret(self.provider.crypto(), label, context, len)
            .map_err(mls)
    }

    pub fn epoch(&self, group_id: &[u8]) -> Result<u64> {
        Ok(self.group(group_id)?.epoch().as_u64())
    }

    /// Имена участников группы в порядке листьев.
    pub fn members(&self, group_id: &[u8]) -> Result<Vec<String>> {
        Ok(self
            .group(group_id)?
            .members()
            .map(|m| credential_name(&m.credential))
            .collect())
    }

    /// Leaf index участника по имени (первое совпадение). Только для спайка: в продукте
    /// участник опознаётся по проверенному ключу идентичности, имя — для отображения.
    pub fn leaf_index(&self, group_id: &[u8], name: &str) -> Result<LeafNodeIndex> {
        self.group(group_id)?
            .members()
            .find(|m| credential_name(&m.credential) == name)
            .map(|m| m.index)
            .ok_or(Error::UnknownMember)
    }

    /// Предложение войти в группу от имени самого устройства (external join proposal,
    /// `Sender::NewMemberProposal`). Нужно только тестам: показать, что участники его
    /// отвергают, — openmls принимает такое предложение в любой группе.
    pub fn propose_self_join(&self, group_id: &[u8], epoch: u64) -> Result<Vec<u8>> {
        let key_package = self.key_package_bundle()?.key_package().clone();
        JoinProposal::new::<openmls_rust_crypto::MemoryStorage>(
            key_package,
            GroupId::from_slice(group_id),
            GroupEpoch::from(epoch),
            &self.signer,
        )
        .map_err(mls)?
        .tls_serialize_detached()
        .map_err(codec)
    }

    /// Размер всего состояния устройства в хранилище (ключи + значения), байт.
    pub fn state_size(&self) -> usize {
        let values = self.provider.storage().values.read().expect("storage lock");
        values.iter().map(|(k, v)| k.len() + v.len()).sum()
    }

    /// Копия устройства с тем же состоянием — только для замеров: каждая итерация стартует
    /// с чистого снимка. Копирует приватные ключи и создаёт второй экземпляр того же листа,
    /// поэтому в продукте такого быть не может; включается feature `bench`.
    #[cfg(feature = "bench")]
    pub fn snapshot(&self) -> Result<Self> {
        let provider = OpenMlsRustCrypto::default();
        {
            let src = self.provider.storage().values.read().expect("storage lock");
            let mut dst = provider.storage().values.write().expect("storage lock");
            dst.clone_from(&src);
        }
        let mut groups = HashMap::new();
        for id in self.groups.keys() {
            let group = MlsGroup::load(provider.storage(), &GroupId::from_slice(id))
                .map_err(mls)?
                .ok_or(Error::UnknownGroup)?;
            groups.insert(id.clone(), group);
        }
        Ok(Self {
            name: self.name.clone(),
            provider,
            signer: self.signer.clone(),
            credential: self.credential.clone(),
            groups,
        })
    }

    fn group(&self, group_id: &[u8]) -> Result<&MlsGroup> {
        self.groups.get(group_id).ok_or(Error::UnknownGroup)
    }
}

/// Политика клиента к предложениям: от external sender-а — только Add и Remove.
/// GroupContextExtensions от сервера (например, замена списка external senders), PSK и
/// ReInit отвергаются. Предложения участников спайк пропускает как есть.
fn authorize_proposal(p: &QueuedProposal) -> Result<()> {
    match (p.sender(), p.proposal()) {
        (Sender::External(_), Proposal::Add(_) | Proposal::Remove(_)) => Ok(()),
        (Sender::External(_), _) => Err(Error::Unauthorized(
            "external sender может предлагать только Add и Remove",
        )),
        (Sender::Member(_), _) => Ok(()),
        _ => Err(Error::Unauthorized("неизвестный тип отправителя")),
    }
}

/// External sender — роль сервера: подписывает предложения Add/Remove, но не состоит в
/// группе и ключей её не имеет. Ему нужны id группы и текущая эпоха (видны в заголовках
/// сообщений), KeyPackage добавляемого устройства (устройство загрузило его на сервер) и
/// leaf index удаляемого — откуда его берёт сервер при зашифрованных commit-ах, решает B02;
/// в спайке индекс сообщает участник.
pub struct ExternalSender {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: Credential,
}

impl ExternalSender {
    pub fn new(name: &str) -> Result<Self> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(mls)?;
        Ok(Self {
            provider,
            signer,
            credential: BasicCredential::new(name.as_bytes().to_vec()).into(),
        })
    }

    /// Публичные данные для extension `external_senders` группы (TLS-кодировка).
    pub fn public_info(&self) -> Result<Vec<u8>> {
        openmls::extensions::ExternalSender::new(
            self.signer.to_public_vec().into(),
            self.credential.clone(),
        )
        .tls_serialize_detached()
        .map_err(codec)
    }

    /// Предложение добавить устройство по KeyPackage в эпохе `epoch`.
    pub fn propose_add(&self, group_id: &[u8], epoch: u64, key_package: &[u8]) -> Result<Vec<u8>> {
        let kp = parse_key_package(&self.provider, key_package)?;
        ExternalProposal::new_add::<OpenMlsRustCrypto>(
            kp,
            GroupId::from_slice(group_id),
            GroupEpoch::from(epoch),
            &self.signer,
            SenderExtensionIndex::new(0),
        )
        .map_err(mls)?
        .tls_serialize_detached()
        .map_err(codec)
    }

    /// Предложение удалить лист `leaf` в эпохе `epoch`.
    pub fn propose_remove(
        &self,
        group_id: &[u8],
        epoch: u64,
        leaf: LeafNodeIndex,
    ) -> Result<Vec<u8>> {
        ExternalProposal::new_remove::<OpenMlsRustCrypto>(
            leaf,
            GroupId::from_slice(group_id),
            GroupEpoch::from(epoch),
            &self.signer,
            SenderExtensionIndex::new(0),
        )
        .map_err(mls)?
        .tls_serialize_detached()
        .map_err(codec)
    }

    /// Предложение заменить список external senders группы (GroupContextExtensions).
    /// Нужно только тестам: показать, что клиент такое предложение от сервера отвергает.
    pub fn propose_external_senders(
        &self,
        group_id: &[u8],
        epoch: u64,
        senders: &[Vec<u8>],
    ) -> Result<Vec<u8>> {
        let senders = senders
            .iter()
            .map(|b| openmls::extensions::ExternalSender::tls_deserialize_exact_bytes(b))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(codec)?;
        let extensions = Extensions::single(Extension::ExternalSenders(senders)).map_err(mls)?;
        ExternalProposal::new_group_context_extensions::<OpenMlsRustCrypto>(
            extensions,
            GroupId::from_slice(group_id),
            GroupEpoch::from(epoch),
            &self.signer,
            SenderExtensionIndex::new(0),
        )
        .map_err(mls)?
        .tls_serialize_detached()
        .map_err(codec)
    }
}

fn parse_key_package(provider: &OpenMlsRustCrypto, bytes: &[u8]) -> Result<KeyPackage> {
    KeyPackageIn::tls_deserialize_exact_bytes(bytes)
        .map_err(codec)?
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .map_err(mls)
}

/// Заголовок сообщения, который виден серверу без ключей: id группы и эпоха. По ним
/// Delivery Service сериализует commit-ы и отвергает commit не для текущей эпохи.
/// Заголовок не аутентифицирован для сервера: проверить сам commit DS не может.
pub fn message_header(message: &[u8]) -> Result<(Vec<u8>, u64)> {
    let message = MlsMessageIn::tls_deserialize_exact_bytes(message).map_err(codec)?;
    let protocol_message = message.try_into_protocol_message().map_err(mls)?;
    Ok((
        protocol_message.group_id().as_slice().to_vec(),
        protocol_message.epoch().as_u64(),
    ))
}

fn credential_name(credential: &Credential) -> String {
    BasicCredential::try_from(credential.clone())
        .map(|c| String::from_utf8_lossy(c.identity()).into_owned())
        .unwrap_or_else(|_| "<не basic>".to_owned())
}
