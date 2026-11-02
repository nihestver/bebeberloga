// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Общая заготовка для бенчмарков и примера размеров: группа на `n` устройств.

use crate::{Device, Result};

pub const GROUP_ID: &[u8] = b"s1-bench-group";

/// Группа из `n` устройств: `creator` создала её и добавила `n - 1` устройств одним commit-ом;
/// `observer` — одно из добавленных, вошедшее по Welcome. Остальные устройства существуют
/// только как KeyPackage: их приватные ключи для замеров не нужны.
pub struct Group {
    pub creator: Device,
    pub observer: Device,
    pub size: usize,
}

impl Group {
    pub fn new(n: usize) -> Result<Self> {
        assert!(n >= 2, "группа как минимум из двух устройств");
        let mut creator = Device::new("creator")?;
        let mut observer = Device::new("observer")?;
        creator.create_group(GROUP_ID, None)?;

        let mut key_packages = vec![observer.key_package()?];
        for i in 1..n - 1 {
            key_packages.push(Device::new(&format!("member-{i}"))?.key_package()?);
        }
        let out = creator.add_members(GROUP_ID, &key_packages)?;
        creator.merge_pending_commit(GROUP_ID)?;
        observer.join(&out.welcome.expect("Welcome"))?;
        Ok(Self {
            creator,
            observer,
            size: n,
        })
    }
}
