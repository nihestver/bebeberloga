// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import decodeQR from "qr/decode.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./QR.module.css";

/** Как часто читается кадр с камеры, мс. */
export const QR_SCAN_INTERVAL_MS = 150;

export interface QRFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Распознаёт код в кадре; `undefined`, если кода нет. */
export type QRDecoder = (frame: QRFrame) => string | undefined;

/** Декодер по умолчанию — библиотека `qr` (ADR-0023). */
export const defaultQRDecoder: QRDecoder = (frame) => {
  try {
    return decodeQR(frame);
  } catch {
    return undefined;
  }
};

export type QRScannerState = "starting" | "active" | "denied" | "unavailable";

export interface QRScannerProps {
  /** Код распознан. Сканирование продолжается, пока компонент показан. */
  onDecode: (text: string) => void;
  /** Подсказка под областью камеры; по умолчанию «Наведи камеру на QR-код». */
  hint?: ReactNode;
  /** Своё получение потока камеры (тесты, выбор устройства). */
  getStream?: () => Promise<MediaStream>;
  decode?: QRDecoder;
  onStateChange?: (state: QRScannerState) => void;
  className?: string;
}

function requestCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });
}

function stateFromError(error: unknown): QRScannerState {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
}

/**
 * `QRScanner`: область камеры 4:3 с рамкой-прицелом Инеем и подсказкой под ней. Поток камеры
 * останавливается при размонтировании.
 */
export function QRScanner({
  onDecode,
  hint,
  getStream = requestCamera,
  decode = defaultQRDecoder,
  onStateChange,
  className,
}: QRScannerProps) {
  const strings = useUiStrings();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<QRScannerState>("starting");
  const latest = useRef({ onDecode, decode, onStateChange });
  useEffect(() => {
    latest.current = { onDecode, decode, onStateChange };
  });

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const canvas = document.createElement("canvas");

    const update = (next: QRScannerState) => {
      setState(next);
      latest.current.onStateChange?.(next);
    };

    const scan = () => {
      const player = video.current;
      if (!player || player.videoWidth === 0) return;
      canvas.width = player.videoWidth;
      canvas.height = player.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(player, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const text = latest.current.decode({
        width: image.width,
        height: image.height,
        data: image.data,
      });
      if (text) latest.current.onDecode(text);
    };

    // Синхронная ошибка (нет navigator.mediaDevices) превращается в отказ, как и NotFoundError.
    Promise.resolve()
      .then(getStream)
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const player = video.current;
        if (player) {
          player.srcObject = media;
          void player.play().catch(() => undefined);
        }
        update("active");
        timer = setInterval(scan, QR_SCAN_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (!cancelled) update(stateFromError(error));
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [getStream]);

  const message = {
    starting: strings.qr.starting,
    active: hint ?? strings.qr.scannerHint,
    denied: strings.qr.denied,
    unavailable: strings.qr.unavailable,
  }[state];

  return (
    <div className={cx(styles.scanner, className)} data-state={state}>
      <div className={styles.viewport}>
        {/* Поток с камеры без звука и без дорожек субтитров: описание даёт подпись ниже. */}
        <video
          ref={video}
          muted
          playsInline
          aria-label={strings.qr.video}
          className={styles.video}
        />
        <span className={styles.reticle} aria-hidden="true" />
      </div>
      <p className={styles.hint} role="status">
        {message}
      </p>
    </div>
  );
}
