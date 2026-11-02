// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Размеры для группы на N устройств: состояние участника, KeyPackage, commit и Welcome
//! при добавлении одного устройства, размер application message. Печатает таблицу Markdown.

use s1_mls_core::fixture::{Group, GROUP_ID};
use s1_mls_core::Device;

fn main() {
    println!("| N устройств | состояние участника, байт | KeyPackage, байт | commit (+1), байт | Welcome (+1), байт | app message (16 байт), байт |");
    println!("|---|---|---|---|---|---|");
    for n in [10usize, 100, 1000] {
        let mut g = Group::new(n).expect("группа");
        let newcomer = Device::new("newcomer").expect("устройство");
        let kp = newcomer.key_package().expect("KeyPackage");
        let out = g
            .creator
            .add_members(GROUP_ID, std::slice::from_ref(&kp))
            .expect("commit");
        g.creator.clear_pending_commit(GROUP_ID).expect("clear");
        let app = g.creator.send(GROUP_ID, &[0u8; 16]).expect("message");
        println!(
            "| {n} | {} | {} | {} | {} | {} |",
            g.observer.state_size(),
            kp.len(),
            out.commit.len(),
            out.welcome.as_ref().map_or(0, Vec::len),
            app.len()
        );
    }
}
