# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Образ сервера Bebeberloga: один статический бинарник в образе без оболочки и пакетов.
# Контекст сборки — корень репозитория; в него попадает только server/ (Dockerfile.dockerignore):
#
#   docker build -f server/Dockerfile --build-arg VERSION=dev-local -t bebeberloga/server:dev .
#
# Сборка идёт на платформе сборщика и кросс-компилирует под целевую (amd64, arm64):
# в итоговом слое нет RUN, поэтому эмуляция не нужна.

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src/server
COPY server/ ./
ARG TARGETOS
ARG TARGETARCH
# Версия в ответе /api/v1/health и в `bebeberloga-server version`; .git в контекст не входит,
# поэтому её передаёт сборка (CI — dev-<ревизия>, релиз — тег).
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -buildvcs=false \
      -ldflags "-s -w -X github.com/nihestver/bebeberloga/server/internal/buildinfo.version=${VERSION}" \
      -o /out/bebeberloga-server ./cmd/bebeberloga-server

# distroless static: сертификаты CA, tzdata, /etc/passwd с пользователем nonroot (65532) — и больше ничего.
FROM gcr.io/distroless/static-debian13:nonroot
# Постоянные метки; ревизию, версию и дату сборки добавляет CI (deploy-test.yml).
LABEL org.opencontainers.image.title="bebeberloga-server" \
      org.opencontainers.image.description="Сервер Bebeberloga: self-hosted общение со сквозным шифрованием" \
      org.opencontainers.image.source="https://github.com/nihestver/bebeberloga" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=build /out/bebeberloga-server /usr/local/bin/bebeberloga-server
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/bebeberloga-server"]
CMD ["serve"]
