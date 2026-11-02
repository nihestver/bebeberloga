# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: CC0-1.0
#
# Dev-контейнер x86_64 для Bebeberloga: Rust (+ цель Android aarch64), Go, Node, pnpm,
# Android NDK, Kotlin и JNA для проверки uniffi-привязок. На Apple Silicon образ
# выполняется под Rosetta/QEMU (platform=linux/amd64), поэтому сборка медленнее хоста.
# Версии закреплены явно; обновлять — в одном месте через ARG.

FROM --platform=linux/amd64 debian:bookworm-slim

ARG ANDROID_CMDLINE_TOOLS=11076708
ARG ANDROID_NDK_VERSION=27.2.12479018
ARG KOTLIN_VERSION=2.1.20
ARG JNA_VERSION=5.14.0
ARG KOTLINX_COROUTINES_VERSION=1.9.0

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_NDK_HOME=/opt/android-sdk/ndk/${ANDROID_NDK_VERSION} \
    KOTLIN_HOME=/opt/kotlinc \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    CLASSPATH=/opt/jars/jna.jar:/opt/jars/kotlinx-coroutines-core-jvm.jar

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git build-essential clang lld pkg-config cmake \
        libssl-dev unzip zip xz-utils python3 openjdk-17-jdk-headless sudo \
    && rm -rf /var/lib/apt/lists/*

# Android: только командные инструменты и NDK (платформы SDK спайку не нужны).
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && cd /tmp \
    && curl -fsSL -o tools.zip \
        "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS}_latest.zip" \
    && unzip -q tools.zip -d ${ANDROID_HOME}/cmdline-tools \
    && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
    && rm tools.zip \
    && yes | ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_HOME} --licenses >/dev/null \
    && ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --sdk_root=${ANDROID_HOME} "ndk;${ANDROID_NDK_VERSION}"

# Kotlin-компилятор и jar-ы для запуска uniffi-привязок на JVM.
RUN cd /tmp \
    && curl -fsSL -o kotlin.zip \
        "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" \
    && unzip -q kotlin.zip -d /opt && rm kotlin.zip \
    && mkdir -p /opt/jars \
    && curl -fsSL -o /opt/jars/jna.jar \
        "https://repo1.maven.org/maven2/net/java/dev/jna/jna/${JNA_VERSION}/jna-${JNA_VERSION}.jar" \
    && curl -fsSL -o /opt/jars/kotlinx-coroutines-core-jvm.jar \
        "https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/${KOTLINX_COROUTINES_VERSION}/kotlinx-coroutines-core-jvm-${KOTLINX_COROUTINES_VERSION}.jar"

# Пользователь без root, как у devcontainers.
RUN useradd -m -s /bin/bash -u 1000 dev && echo 'dev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dev
USER dev
WORKDIR /home/dev

# mise ставит версии из mise.toml (go, node, pnpm, golangci-lint, rust через rustup).
RUN curl -fsSL https://mise.run | sh
ENV PATH=/home/dev/.local/bin:/home/dev/.local/share/mise/shims:/home/dev/.cargo/bin:${KOTLIN_HOME}/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${PATH}
COPY --chown=dev:dev mise.toml /home/dev/.config/mise/config.toml
RUN mise trust /home/dev/.config/mise/config.toml && mise install -y \
    && mise exec -- rustup target add aarch64-linux-android

# Линкер и архиватор NDK для цели Android; cargo читает эти переменные без доп. конфигурации.
ENV CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang \
    AR_aarch64_linux_android=${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar
