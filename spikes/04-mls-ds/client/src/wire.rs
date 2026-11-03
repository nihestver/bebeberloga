// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Кодирование RFC 9420 на стороне клиента: строгие varint-длины, разбор полей KeyPackage,
//! которые openmls не отдаёт наружу (срок, capabilities, ключи), `authenticated_data`
//! предложений сервера и подпись external-предложений для тестов — зеркало
//! `ds/internal/mlswire`.

use openmls_traits::signatures::Signer;

pub(crate) fn put_varint(out: &mut Vec<u8>, n: usize) {
    if n < 1 << 6 {
        out.push(n as u8);
    } else if n < 1 << 14 {
        out.extend_from_slice(&(n as u16 | 0x4000).to_be_bytes());
    } else {
        assert!(n < 1 << 30, "вектор слишком длинный");
        out.extend_from_slice(&(n as u32 | 0x8000_0000).to_be_bytes());
    }
}

pub(crate) fn put_vector(out: &mut Vec<u8>, v: &[u8]) {
    put_varint(out, v.len());
    out.extend_from_slice(v);
}

pub(crate) struct Reader<'a>(pub(crate) &'a [u8]);

impl<'a> Reader<'a> {
    pub(crate) fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.0.len() < n {
            return None;
        }
        let (a, b) = self.0.split_at(n);
        self.0 = b;
        Some(a)
    }

    pub(crate) fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|b| b[0])
    }

    pub(crate) fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes(self.take(2)?.try_into().ok()?))
    }

    pub(crate) fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes(self.take(4)?.try_into().ok()?))
    }

    pub(crate) fn u64(&mut self) -> Option<u64> {
        Some(u64::from_be_bytes(self.take(8)?.try_into().ok()?))
    }

    /// Длина вектора в минимальной кодировке (RFC 9420 §2.1.2); иначе `None`.
    pub(crate) fn varint(&mut self) -> Option<usize> {
        let first = self.u8()?;
        let v = first & 0x3f;
        match first >> 6 {
            0 => Some(v as usize),
            1 => {
                let n = ((v as usize) << 8) | self.u8()? as usize;
                (n >= 1 << 6).then_some(n)
            }
            2 => {
                let b = self.take(3)?;
                let n = ((v as usize) << 24)
                    | (b[0] as usize) << 16
                    | (b[1] as usize) << 8
                    | b[2] as usize;
                (n >= 1 << 14).then_some(n)
            }
            _ => None,
        }
    }

    pub(crate) fn vector(&mut self) -> Option<&'a [u8]> {
        let n = self.varint()?;
        self.take(n)
    }
}

/// Открытые поля KeyPackage (TLS-кодировка без MLSMessage).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyPackageInfo {
    pub identity: Vec<u8>,
    pub init_key: Vec<u8>,
    pub encryption_key: Vec<u8>,
    pub signature_key: Vec<u8>,
    pub versions: Vec<u16>,
    pub cipher_suites: Vec<u16>,
    pub credentials: Vec<u16>,
    /// capabilities.extensions и типы расширений самого листа.
    pub cap_extensions: Vec<u16>,
    pub leaf_extensions: Vec<u16>,
    pub not_before: u64,
    pub not_after: u64,
}

impl KeyPackageInfo {
    /// Расширения листа допустимы по правилу openmls 0.9.2 (`LeafNode::validate_locally`,
    /// valn1601): в листе нельзя ratchet_tree, required_capabilities, external_pub,
    /// external_senders и last_resort, а каждый тип, кроме стандартных 0x0001–0x0005, обязан быть
    /// в capabilities.extensions. Зеркало `mlswire.checkLeafExtensions`.
    pub fn leaf_extensions_valid(&self) -> bool {
        self.leaf_extensions.iter().all(|&t| match t {
            0x0002..=0x0005 | 0x000a => false,
            0x0001 => true,
            _ => self.cap_extensions.contains(&t),
        })
    }
}

fn u16s(v: &[u8]) -> Option<Vec<u16>> {
    if !v.len().is_multiple_of(2) {
        return None;
    }
    Some(
        v.chunks(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect(),
    )
}

/// Разбор KeyPackage без проверки подписей (их проверяет openmls).
pub fn parse_key_package(raw: &[u8]) -> Option<KeyPackageInfo> {
    let mut r = Reader(raw);
    if r.u16()? != 1 {
        return None;
    }
    let _cipher_suite = r.u16()?;
    let init_key = r.vector()?.to_vec();
    let encryption_key = r.vector()?.to_vec();
    let signature_key = r.vector()?.to_vec();
    if r.u16()? != 1 {
        return None; // только Basic credential
    }
    let identity = r.vector()?.to_vec();
    let versions = u16s(r.vector()?)?;
    let cipher_suites = u16s(r.vector()?)?;
    let cap_extensions = u16s(r.vector()?)?;
    let _proposals = r.vector()?;
    let credentials = u16s(r.vector()?)?;
    if r.u8()? != 1 {
        return None; // leaf_node_source = key_package
    }
    let not_before = r.u64()?;
    let not_after = r.u64()?;
    let mut er = Reader(r.vector()?);
    let mut leaf_extensions = Vec::new();
    while !er.0.is_empty() {
        leaf_extensions.push(er.u16()?);
        er.vector()?;
    }
    Some(KeyPackageInfo {
        identity,
        init_key,
        encryption_key,
        signature_key,
        versions,
        cipher_suites,
        credentials,
        cap_extensions,
        leaf_extensions,
        not_before,
        not_after,
    })
}

/// `authenticated_data` предложения сервера: `{uint8 version = 1; opaque device_id<V>}`.
pub fn proposal_aad(device_id: &str) -> Vec<u8> {
    let mut out = vec![1u8];
    put_vector(&mut out, device_id.as_bytes());
    out
}

/// Id устройства из `authenticated_data` предложения сервера.
pub fn parse_proposal_aad(aad: &[u8]) -> Option<String> {
    let mut r = Reader(aad);
    if r.u8()? != 1 {
        return None;
    }
    let id = r.vector()?;
    if !r.0.is_empty() || id.is_empty() {
        return None;
    }
    String::from_utf8(id.to_vec()).ok()
}

/// SignWithLabel (RFC 9420 §5.1.2): подпись `SignContent{"MLS 1.0 " + label, content}`.
pub fn sign_with_label(signer: &dyn Signer, label: &str, content: &[u8]) -> Vec<u8> {
    let mut sc = Vec::new();
    put_vector(&mut sc, format!("MLS 1.0 {label}").as_bytes());
    put_vector(&mut sc, content);
    signer.sign(&sc).expect("подпись")
}

/// Сервер как external sender для тестов клиента: подписывает Add/Remove с
/// `authenticated_data` (openmls не даёт задать AAD внешнего предложения). При пустом AAD
/// результат побайтно совпадает с `ExternalProposal::new_add`/`new_remove`.
pub struct ExternalSender<'a> {
    pub signer: &'a dyn Signer,
    pub index: u32,
}

impl ExternalSender<'_> {
    pub fn add(&self, group_id: &[u8], epoch: u64, key_package: &[u8], aad: &[u8]) -> Vec<u8> {
        let mut p = 1u16.to_be_bytes().to_vec(); // ProposalType add
        p.extend_from_slice(key_package);
        self.public_proposal(group_id, epoch, aad, &p)
    }

    pub fn remove(&self, group_id: &[u8], epoch: u64, leaf: u32, aad: &[u8]) -> Vec<u8> {
        let mut p = 3u16.to_be_bytes().to_vec(); // ProposalType remove
        p.extend_from_slice(&leaf.to_be_bytes());
        self.public_proposal(group_id, epoch, aad, &p)
    }

    fn public_proposal(&self, group_id: &[u8], epoch: u64, aad: &[u8], proposal: &[u8]) -> Vec<u8> {
        // MLSMessage{version, wire_format = public} + FramedContent; у отправителя external
        // GroupContext в TBS не входит (RFC 9420 §6.1).
        let mut msg = vec![0, 1, 0, 1];
        put_vector(&mut msg, group_id);
        msg.extend_from_slice(&epoch.to_be_bytes());
        msg.push(2); // SenderType external
        msg.extend_from_slice(&self.index.to_be_bytes());
        put_vector(&mut msg, aad);
        msg.push(2); // ContentType proposal
        msg.extend_from_slice(proposal);
        let sig = sign_with_label(self.signer, "FramedContentTBS", &msg);
        put_vector(&mut msg, &sig); // FramedContentAuthData.signature; membership_tag нет
        msg
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn varint_must_be_minimal() {
        assert_eq!(Reader(&[0x40, 0x05]).varint(), None);
        assert_eq!(Reader(&[0x80, 0, 0, 5]).varint(), None);
        for n in [0usize, 63, 64, 16383, 16384, 1 << 20] {
            let mut out = Vec::new();
            put_varint(&mut out, n);
            assert_eq!(Reader(&out).varint(), Some(n));
        }
    }

    #[test]
    fn proposal_aad_round_trip() {
        assert_eq!(
            parse_proposal_aad(&proposal_aad("dev-1")).as_deref(),
            Some("dev-1")
        );
        assert_eq!(parse_proposal_aad(&[]), None);
        assert_eq!(parse_proposal_aad(&proposal_aad("")), None);
    }
}
