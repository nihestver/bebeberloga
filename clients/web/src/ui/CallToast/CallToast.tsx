// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Icon } from "../icons/Icon";
import { icons } from "../icons/icons";
import { EscLayer, useEscapeLayer } from "../shortcuts/escape";
import { formatMessage, useUiStrings } from "../strings/UiProvider";
import { Tooltip } from "../Tooltip/Tooltip";
import { cx } from "../utils/cx";
import styles from "./CallToast.module.css";

/** Сколько длится входящий звонок без ответа, мс (COMPONENTS §4). */
export const CALL_TOAST_TIMEOUT_MS = 30_000;

export interface CallToastProps {
  /** Имя звонящего. */
  name: string;
  /** Аватар 48 (`<Avatar size={48} />`); кольцо вокруг него пульсирует. */
  avatar: ReactNode;
  onAccept: () => void;
  onDecline: () => void;
  /** Звонок остался без ответа: прошло `timeoutMs`. */
  onTimeout?: () => void;
  timeoutMs?: number;
  className?: string;
}

/**
 * `CallToast`: карточка 320×96 в правом нижнем углу окна поверх всего, без затемнения — аватар с
 * пульсирующим кольцом, «<имя> звонит», круглые кнопки «Отклонить» и «Ответить». Esc отклоняет
 * звонок, только когда фокус на карточке. Рингтон проигрывает вызывающий (звонки — B11).
 */
export function CallToast({
  name,
  avatar,
  onAccept,
  onDecline,
  onTimeout,
  timeoutMs = CALL_TOAST_TIMEOUT_MS,
  className,
}: CallToastProps) {
  const strings = useUiStrings();
  const [hasFocus, setHasFocus] = useState(false);
  useEscapeLayer(EscLayer.incomingCall, onDecline, hasFocus);

  const timeoutHandler = useRef(onTimeout);
  useEffect(() => {
    timeoutHandler.current = onTimeout;
  });
  useEffect(() => {
    const timer = setTimeout(() => timeoutHandler.current?.(), timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs]);

  const title = formatMessage(strings.callToast.calling, { name });
  return (
    <div
      role="alertdialog"
      aria-label={title}
      className={cx(styles.toast, className)}
      onFocus={() => setHasFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
      }}
    >
      <span className={styles.avatar}>{avatar}</span>
      <div className={styles.main}>
        <span className={styles.title}>{title}</span>
        <div className={styles.buttons}>
          <Tooltip content={strings.callToast.decline}>
            <AriaButton
              aria-label={strings.callToast.decline}
              onPress={onDecline}
              className={styles.button}
              data-tone="decline"
            >
              <Icon icon={icons.hangup} />
            </AriaButton>
          </Tooltip>
          <Tooltip content={strings.callToast.accept}>
            <AriaButton
              aria-label={strings.callToast.accept}
              onPress={onAccept}
              className={styles.button}
              data-tone="accept"
            >
              <Icon icon={icons.call} />
            </AriaButton>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
