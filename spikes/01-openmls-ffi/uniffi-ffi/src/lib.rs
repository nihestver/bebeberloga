// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! uniffi-обвязка над `s1_mls_core` для Kotlin (Android) и Swift (iOS/macOS).
//! Интерфейс описан proc-macro, без UDL; объект потокобезопасен через Mutex.

use std::sync::{Arc, Mutex};

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MlsError {
    #[error("{msg}")]
    Failed { msg: String },
}

impl From<s1_mls_core::Error> for MlsError {
    fn from(e: s1_mls_core::Error) -> Self {
        Self::Failed { msg: e.to_string() }
    }
}

#[derive(uniffi::Record)]
pub struct CommitResult {
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
}

impl From<s1_mls_core::CommitOutput> for CommitResult {
    fn from(o: s1_mls_core::CommitOutput) -> Self {
        Self {
            commit: o.commit,
            welcome: o.welcome,
        }
    }
}

/// `kind`: "application" | "proposal" | "commit" | "ignored".
#[derive(uniffi::Record)]
pub struct ReceivedMessage {
    pub kind: String,
    pub sender: Option<String>,
    pub plaintext: Option<Vec<u8>>,
    pub epoch: Option<u64>,
}

impl From<s1_mls_core::Received> for ReceivedMessage {
    fn from(r: s1_mls_core::Received) -> Self {
        use s1_mls_core::Received as R;
        match r {
            R::Application { sender, plaintext } => Self {
                kind: "application".into(),
                sender: Some(sender),
                plaintext: Some(plaintext),
                epoch: None,
            },
            R::Proposal { sender } => Self {
                kind: "proposal".into(),
                sender: Some(sender),
                plaintext: None,
                epoch: None,
            },
            R::Commit { epoch } => Self {
                kind: "commit".into(),
                sender: None,
                plaintext: None,
                epoch: Some(epoch),
            },
            R::Ignored => Self {
                kind: "ignored".into(),
                sender: None,
                plaintext: None,
                epoch: None,
            },
        }
    }
}

#[uniffi::export]
pub fn openmls_version() -> String {
    s1_mls_core::OPENMLS_VERSION.to_owned()
}

#[derive(uniffi::Object)]
pub struct Device {
    inner: Mutex<s1_mls_core::Device>,
}

impl Device {
    fn with<T>(
        &self,
        f: impl FnOnce(&mut s1_mls_core::Device) -> s1_mls_core::Result<T>,
    ) -> Result<T, MlsError> {
        let mut inner = self.inner.lock().map_err(|_| MlsError::Failed {
            msg: "устройство недоступно: отравленный mutex".into(),
        })?;
        f(&mut inner).map_err(Into::into)
    }
}

#[uniffi::export]
impl Device {
    #[uniffi::constructor]
    pub fn new(name: String) -> Result<Arc<Self>, MlsError> {
        Ok(Arc::new(Self {
            inner: Mutex::new(s1_mls_core::Device::new(&name)?),
        }))
    }

    pub fn key_package(&self) -> Result<Vec<u8>, MlsError> {
        self.with(|d| d.key_package())
    }

    pub fn create_group(
        &self,
        group_id: Vec<u8>,
        external_sender: Option<Vec<u8>>,
    ) -> Result<(), MlsError> {
        self.with(|d| d.create_group(&group_id, external_sender.as_deref()))
    }

    pub fn add_members(
        &self,
        group_id: Vec<u8>,
        key_packages: Vec<Vec<u8>>,
    ) -> Result<CommitResult, MlsError> {
        self.with(|d| d.add_members(&group_id, &key_packages).map(Into::into))
    }

    pub fn commit_pending_proposals(&self, group_id: Vec<u8>) -> Result<CommitResult, MlsError> {
        self.with(|d| d.commit_pending_proposals(&group_id).map(Into::into))
    }

    pub fn merge_pending_commit(&self, group_id: Vec<u8>) -> Result<(), MlsError> {
        self.with(|d| d.merge_pending_commit(&group_id))
    }

    pub fn join(&self, welcome: Vec<u8>) -> Result<Vec<u8>, MlsError> {
        self.with(|d| d.join(&welcome))
    }

    pub fn send(&self, group_id: Vec<u8>, plaintext: Vec<u8>) -> Result<Vec<u8>, MlsError> {
        self.with(|d| d.send(&group_id, &plaintext))
    }

    pub fn receive(&self, message: Vec<u8>) -> Result<ReceivedMessage, MlsError> {
        self.with(|d| d.receive(&message).map(Into::into))
    }

    pub fn export_secret(
        &self,
        group_id: Vec<u8>,
        label: String,
        context: Vec<u8>,
        len: u32,
    ) -> Result<Vec<u8>, MlsError> {
        self.with(|d| d.export_secret(&group_id, &label, &context, len as usize))
    }

    pub fn epoch(&self, group_id: Vec<u8>) -> Result<u64, MlsError> {
        self.with(|d| d.epoch(&group_id))
    }

    pub fn members(&self, group_id: Vec<u8>) -> Result<Vec<String>, MlsError> {
        self.with(|d| d.members(&group_id))
    }
}
