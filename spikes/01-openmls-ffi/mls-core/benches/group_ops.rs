// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: Apache-2.0

//! Замеры для группы на 10, 100 и 1 000 устройств:
//! - `commit_add_one` — время создания commit-а (и Welcome) при добавлении одного устройства;
//! - `process_commit` — время обработки этого commit-а существующим участником (включая merge);
//! - `join_welcome` — время входа нового устройства по Welcome.
//!
//! Каждая итерация стартует со снимка состояния, чтобы операции не накапливали эпохи.

use std::time::Duration;

use criterion::{criterion_group, criterion_main, BatchSize, BenchmarkId, Criterion};
use s1_mls_core::fixture::{Group, GROUP_ID};
use s1_mls_core::{CommitOutput, Device};

const SIZES: [usize; 3] = [10, 100, 1000];

struct Fixture {
    n: usize,
    group: Group,
    newcomer: Device,
    key_package: Vec<u8>,
}

fn fixtures() -> Vec<Fixture> {
    SIZES
        .into_iter()
        .map(|n| {
            let group = Group::new(n).expect("группа");
            let newcomer = Device::new("newcomer").expect("устройство");
            let key_package = newcomer.key_package().expect("KeyPackage");
            Fixture {
                n,
                group,
                newcomer,
                key_package,
            }
        })
        .collect()
}

fn bench(c: &mut Criterion) {
    let mut fixtures = fixtures();

    let mut add = c.benchmark_group("commit_add_one");
    add.sample_size(20)
        .measurement_time(Duration::from_secs(10));
    for f in &fixtures {
        add.bench_with_input(BenchmarkId::from_parameter(f.n), &f.n, |b, _| {
            b.iter_batched(
                || f.group.creator.snapshot().expect("снимок"),
                |mut creator| {
                    creator
                        .add_members(GROUP_ID, std::slice::from_ref(&f.key_package))
                        .expect("commit")
                },
                BatchSize::LargeInput,
            )
        });
    }
    add.finish();

    // Один реальный commit на каждую группу — его обрабатывают получатели.
    let outputs: Vec<CommitOutput> = fixtures
        .iter_mut()
        .map(|f| {
            let out = f
                .group
                .creator
                .add_members(GROUP_ID, std::slice::from_ref(&f.key_package))
                .expect("commit");
            f.group
                .creator
                .merge_pending_commit(GROUP_ID)
                .expect("merge");
            out
        })
        .collect();

    let mut process = c.benchmark_group("process_commit");
    process
        .sample_size(20)
        .measurement_time(Duration::from_secs(10));
    for (f, out) in fixtures.iter().zip(&outputs) {
        process.bench_with_input(BenchmarkId::from_parameter(f.n), &f.n, |b, _| {
            b.iter_batched(
                || f.group.observer.snapshot().expect("снимок"),
                |mut observer| observer.receive(&out.commit).expect("commit применён"),
                BatchSize::LargeInput,
            )
        });
    }
    process.finish();

    let mut join = c.benchmark_group("join_welcome");
    join.sample_size(20)
        .measurement_time(Duration::from_secs(10));
    for (f, out) in fixtures.iter().zip(&outputs) {
        let welcome = out.welcome.as_ref().expect("Welcome");
        join.bench_with_input(BenchmarkId::from_parameter(f.n), &f.n, |b, _| {
            b.iter_batched(
                || f.newcomer.snapshot().expect("снимок"),
                |mut d| d.join(welcome).expect("вход"),
                BatchSize::LargeInput,
            )
        });
    }
    join.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
