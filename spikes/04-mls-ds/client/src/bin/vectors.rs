// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Golden-векторы OpenMLS для тестов `ds/internal/mlswire`: KeyPackage, commit с дельтой
//! состава в AAD, Welcome и предложения external sender-а, подписанные известным ключом.
//! Go-тест проверяет разбор и побайтовое совпадение предложений, подписанных DS.
//!
//! Запуск: `cargo run --bin vectors -- ../ds/testdata/openmls`.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::OpenMlsProvider;
use s4_client::{Device, Event};
use tls_codec::Serialize as _;

const SEED: [u8; 32] = [7; 32];
const GID: &[u8] = b"s4-vector-group";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or("../ds/testdata/openmls".into()),
    );
    std::fs::create_dir_all(&dir)?;
    let write = |name: &str, b: &[u8]| std::fs::write(dir.join(name), b);

    let public = ed25519_dalek::SigningKey::from_bytes(&SEED)
        .verifying_key()
        .to_bytes();
    let signer =
        SignatureKeyPair::from_raw(SignatureScheme::ED25519, SEED.to_vec(), public.to_vec());
    let entry = openmls::extensions::ExternalSender::new(
        public.to_vec().into(),
        BasicCredential::new(b"vec-ds".to_vec()).into(),
    )
    .tls_serialize_detached()?;

    let provider = OpenMlsRustCrypto::default();
    let joiner = Device::new("vec-joiner", &entry)?;
    let kp_raw = joiner.key_package()?;
    let kp = KeyPackageIn::tls_deserialize_exact_bytes(&kp_raw)?
        .validate(provider.crypto(), ProtocolVersion::Mls10)?;
    let propose = |epoch: u64| -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        Ok(ExternalProposal::new_add::<OpenMlsRustCrypto>(
            kp.clone(),
            GroupId::from_slice(GID),
            GroupEpoch::from(epoch),
            &signer,
            SenderExtensionIndex::new(0),
        )?
        .tls_serialize_detached()?)
    };
    let remove = ExternalProposal::new_remove::<OpenMlsRustCrypto>(
        LeafNodeIndex::new(1),
        GroupId::from_slice(GID),
        GroupEpoch::from(1),
        &signer,
        SenderExtensionIndex::new(0),
    )?
    .tls_serialize_detached()?;

    // Создатель получает Add от сервера в эпохе 0 и коммитит его с дельтой в AAD.
    let mut creator = Device::new("vec-creator", &entry)?;
    creator.create_group(GID)?;
    let bound = s4_client::wire::ExternalSender {
        signer: &signer,
        index: 0,
    }
    .add(
        GID,
        0,
        &kp_raw,
        &s4_client::wire::proposal_aad("vec-joiner"),
    );
    assert_eq!(creator.receive(&bound)?, Event::Proposal);
    let commit = creator.commit()?;
    creator.merge_pending()?;
    let welcome = commit.welcome.clone().expect("Welcome");
    let mut joiner = joiner;
    joiner.join(&welcome)?;
    assert_eq!(joiner.own_leaf()?, 1);
    assert_eq!(joiner.roster()?, creator.roster()?);

    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    write("group_id.bin", GID)?;
    write("generated_at.bin", &now.to_be_bytes())?;
    write("key_package.bin", &kp_raw)?;
    write("commit.bin", &commit.commit)?;
    write("welcome.bin", &welcome)?;
    write("external_sender_seed.bin", &SEED)?;
    write("external_sender.bin", &entry)?;
    write("external_add.bin", &propose(1)?)?;
    write("external_remove.bin", &remove)?;
    println!("векторы OpenMLS записаны в {}", dir.display());
    Ok(())
}
