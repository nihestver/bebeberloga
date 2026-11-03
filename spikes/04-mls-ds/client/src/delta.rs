// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Дельта состава в `authenticated_data` commit-а (формат спайка S4, зеркало
//! `ds/internal/mlswire/delta.go`): удалённые листья и добавленные `(лист, id устройства)`.
//! Грамматика одна с DS: минимальные varint, непустой id в UTF-8.

use std::collections::BTreeSet;

pub const VERSION: u8 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RosterDelta {
    pub removed: Vec<u32>,
    pub added: Vec<(u32, String)>,
}

use crate::wire::{put_vector, Reader};

impl RosterDelta {
    pub fn encode(&self) -> Vec<u8> {
        let mut rem = Vec::new();
        for l in &self.removed {
            rem.extend_from_slice(&l.to_be_bytes());
        }
        let mut add = Vec::new();
        for (l, id) in &self.added {
            add.extend_from_slice(&l.to_be_bytes());
            put_vector(&mut add, id.as_bytes());
        }
        let mut out = vec![VERSION];
        put_vector(&mut out, &rem);
        put_vector(&mut out, &add);
        out
    }

    pub fn decode(b: &[u8]) -> Option<Self> {
        let mut r = Reader(b);
        if r.u8()? != VERSION {
            return None;
        }
        let rem = r.vector()?;
        let add = r.vector()?;
        if !r.0.is_empty() || rem.len() % 4 != 0 {
            return None;
        }
        let removed = rem
            .chunks(4)
            .map(|c| u32::from_be_bytes(c.try_into().expect("4 байта")))
            .collect();
        let mut ar = Reader(add);
        let mut added = Vec::new();
        while !ar.0.is_empty() {
            let l = ar.u32()?;
            let id = ar.vector()?;
            if id.is_empty() {
                return None;
            }
            added.push((l, String::from_utf8(id.to_vec()).ok()?));
        }
        Some(Self { removed, added })
    }

    /// Совпадает ли с фактическим действием commit-а: удалённые — как множество, добавленные —
    /// поштучно в порядке применения.
    pub fn same_effect(&self, other: &RosterDelta) -> bool {
        let a: BTreeSet<_> = self.removed.iter().collect();
        let b: BTreeSet<_> = other.removed.iter().collect();
        a == b && self.removed.len() == other.removed.len() && self.added == other.added
    }
}

/// Индексы для `n` добавлений: самый левый пустой лист после удалений, иначе рост вправо
/// (RFC 9420 §12.1.1, §12.3). Зеркало `mlswire.AssignLeaves`.
pub fn assign_leaves(occupied: &BTreeSet<u32>, removed: &[u32], n: usize) -> Vec<u32> {
    let mut taken = occupied.clone();
    for l in removed {
        taken.remove(l);
    }
    let mut out = Vec::with_capacity(n);
    let mut next = 0u32;
    while out.len() < n {
        if !taken.contains(&next) {
            out.push(next);
        }
        next += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_assignment() {
        let d = RosterDelta {
            removed: vec![3],
            added: vec![(3, "dev-a".into()), (5, "dev-b".into())],
        };
        assert_eq!(RosterDelta::decode(&d.encode()), Some(d));
        let occ: BTreeSet<u32> = [0, 1, 3, 4].into();
        assert_eq!(assign_leaves(&occ, &[3], 4), vec![2, 3, 5, 6]);
    }
}
