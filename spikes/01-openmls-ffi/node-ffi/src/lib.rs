// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Node-API обвязка (napi-rs) над `s1_mls_core` для Node 22 и Electron 33.
//! Байты наружу — `Buffer`; ошибки — исключения JS с текстом из `s1_mls_core::Error`.

use napi::bindgen_prelude::*;
use napi_derive::napi;

fn err(e: s1_mls_core::Error) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
pub fn openmls_version() -> String {
    s1_mls_core::OPENMLS_VERSION.to_owned()
}

#[napi(object)]
pub struct CommitResult {
    pub commit: Buffer,
    pub welcome: Option<Buffer>,
}

impl From<s1_mls_core::CommitOutput> for CommitResult {
    fn from(o: s1_mls_core::CommitOutput) -> Self {
        Self {
            commit: o.commit.into(),
            welcome: o.welcome.map(Into::into),
        }
    }
}

/// `kind`: "application" | "proposal" | "commit" | "ignored".
#[napi(object)]
pub struct ReceivedMessage {
    pub kind: String,
    pub sender: Option<String>,
    pub plaintext: Option<Buffer>,
    pub epoch: Option<i64>,
}

impl From<s1_mls_core::Received> for ReceivedMessage {
    fn from(r: s1_mls_core::Received) -> Self {
        use s1_mls_core::Received as R;
        match r {
            R::Application { sender, plaintext } => Self {
                kind: "application".into(),
                sender: Some(sender),
                plaintext: Some(plaintext.into()),
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
                epoch: Some(epoch as i64),
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

#[napi]
pub struct Device {
    inner: s1_mls_core::Device,
}

#[napi]
impl Device {
    #[napi(constructor)]
    pub fn new(name: String) -> Result<Self> {
        Ok(Self {
            inner: s1_mls_core::Device::new(&name).map_err(err)?,
        })
    }

    #[napi]
    pub fn key_package(&self) -> Result<Buffer> {
        self.inner.key_package().map(Into::into).map_err(err)
    }

    #[napi]
    pub fn create_group(
        &mut self,
        group_id: Buffer,
        external_sender: Option<Buffer>,
    ) -> Result<()> {
        self.inner
            .create_group(&group_id, external_sender.as_deref())
            .map_err(err)
    }

    #[napi]
    pub fn add_members(
        &mut self,
        group_id: Buffer,
        key_packages: Vec<Buffer>,
    ) -> Result<CommitResult> {
        let kps: Vec<Vec<u8>> = key_packages.iter().map(|b| b.to_vec()).collect();
        self.inner
            .add_members(&group_id, &kps)
            .map(Into::into)
            .map_err(err)
    }

    #[napi]
    pub fn commit_pending_proposals(&mut self, group_id: Buffer) -> Result<CommitResult> {
        self.inner
            .commit_pending_proposals(&group_id)
            .map(Into::into)
            .map_err(err)
    }

    #[napi]
    pub fn merge_pending_commit(&mut self, group_id: Buffer) -> Result<()> {
        self.inner.merge_pending_commit(&group_id).map_err(err)
    }

    #[napi]
    pub fn join(&mut self, welcome: Buffer) -> Result<Buffer> {
        self.inner.join(&welcome).map(Into::into).map_err(err)
    }

    #[napi]
    pub fn send(&mut self, group_id: Buffer, plaintext: Buffer) -> Result<Buffer> {
        self.inner
            .send(&group_id, &plaintext)
            .map(Into::into)
            .map_err(err)
    }

    #[napi]
    pub fn receive(&mut self, message: Buffer) -> Result<ReceivedMessage> {
        self.inner.receive(&message).map(Into::into).map_err(err)
    }

    #[napi]
    pub fn export_secret(
        &self,
        group_id: Buffer,
        label: String,
        context: Buffer,
        len: u32,
    ) -> Result<Buffer> {
        self.inner
            .export_secret(&group_id, &label, &context, len as usize)
            .map(Into::into)
            .map_err(err)
    }

    #[napi]
    pub fn epoch(&self, group_id: Buffer) -> Result<i64> {
        self.inner.epoch(&group_id).map(|e| e as i64).map_err(err)
    }

    #[napi]
    pub fn members(&self, group_id: Buffer) -> Result<Vec<String>> {
        self.inner.members(&group_id).map_err(err)
    }
}
