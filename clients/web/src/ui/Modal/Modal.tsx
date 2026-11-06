// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

import type { CSSProperties, ReactNode } from "react";
import { Dialog, Heading, Modal as AriaModal, ModalOverlay } from "react-aria-components";
import { Button, IconButton } from "../Button/Button";
import { icons } from "../icons/icons";
import { Kbd } from "../Kbd/Kbd";
import { EscLayer, useEscapeLayer } from "../shortcuts/escape";
import { useUiStrings } from "../strings/UiProvider";
import { cx } from "../utils/cx";
import styles from "./Modal.module.css";

export interface ModalProps {
  isOpen: boolean;
  /** Запрос на закрытие: крестик, Esc, клик вне окна. */
  onClose: () => void;
  /**
   * `Modal/S` — 440; `Modal/M` — 600 (допуск 560–620 через `width`); `Modal/L` — 700, а с
   * `isWide` — 960.
   */
  size?: "s" | "m" | "l";
  /** Широкий вариант `Modal/L`: 960 (выбор источника стрима, полный профиль). */
  isWide?: boolean;
  /** Своя ширина в px в пределах допуска размера. */
  width?: number;
  /** Фиксированная высота в px (960×630, 960×720). */
  height?: number;
  /** Заголовок (Nunito 700, 20 px). */
  title: ReactNode;
  /** Заголовок слева или по центру (у мастеров). */
  titleAlign?: "start" | "center";
  children: ReactNode;
  /** Кнопки подвала: вторичная слева от главной. */
  footer?: ReactNode;
  /** `end` — кнопки справа; `split` — две кнопки на всю ширину пополам. */
  footerLayout?: "end" | "split";
  /** Закрывать кликом вне окна; по умолчанию да. */
  isDismissable?: boolean;
  /** `alertdialog` — для подтверждений необратимых действий. */
  role?: "dialog" | "alertdialog";
  className?: string;
}

/**
 * `Modal/S`, `Modal/M`, `Modal/L`: окно по центру с затемнением `--color-overlay`. Ловит фокус,
 * закрывается по Esc (в порядке `SHORTCUTS.md`) и возвращает фокус на источник.
 */
export function Modal({
  isOpen,
  onClose,
  size = "s",
  isWide,
  width,
  height,
  title,
  titleAlign = "start",
  children,
  footer,
  footerLayout = "end",
  isDismissable = true,
  role = "dialog",
  className,
}: ModalProps) {
  const strings = useUiStrings();
  useEscapeLayer(EscLayer.modal, onClose, isOpen);
  const style: CSSProperties = {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable={isDismissable}
      // Esc обрабатывает общий диспетчер: порядок слоёв задан SHORTCUTS.md.
      isKeyboardDismissDisabled
      className={styles.overlay}
    >
      <AriaModal
        className={cx(styles.modal, className)}
        data-size={size}
        data-wide={isWide || undefined}
        style={style}
      >
        <Dialog role={role} className={styles.dialog}>
          <header className={styles.header} data-align={titleAlign}>
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            <IconButton
              icon={icons.close}
              label={strings.common.close}
              onPress={onClose}
              className={styles.close}
            />
          </header>
          <div className={styles.body}>{children}</div>
          {footer && (
            <footer className={styles.footer} data-layout={footerLayout}>
              {footer}
            </footer>
          )}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Заголовок: «Удалить …». */
  title: ReactNode;
  /** Текст с жирным именем объекта. */
  children: ReactNode;
  /** Превью объекта: сообщение, роль. */
  preview?: ReactNode;
  /** Подпись кнопки подтверждения: «Удалить». */
  confirmLabel: string;
  /** Подпись кнопки отмены; по умолчанию «Отмена». */
  cancelLabel?: string;
  onConfirm: () => void;
  /** Подтверждение выполняется: кнопка показывает спиннер. */
  isPending?: boolean;
  /** Показывать фразу «Это действие нельзя отменить»; по умолчанию да. */
  isIrreversible?: boolean;
  /** Подсказка про Shift (только для сообщений). */
  showShiftHint?: boolean;
}

/**
 * `Modal/Confirm`: `Modal/S` для необратимого действия — заголовок, текст, превью объекта,
 * кнопки «Отмена» и `Button/Danger`.
 */
export function ConfirmModal({
  isOpen,
  onClose,
  title,
  children,
  preview,
  confirmLabel,
  cancelLabel,
  onConfirm,
  isPending,
  isIrreversible = true,
  showShiftHint,
}: ConfirmModalProps) {
  const strings = useUiStrings();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="s"
      role="alertdialog"
      title={title}
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            {cancelLabel ?? strings.common.cancel}
          </Button>
          <Button variant="danger" isPending={isPending} onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.confirmText}>
        {children} {isIrreversible && strings.modal.irreversible}
      </div>
      {preview && <div className={styles.preview}>{preview}</div>}
      {showShiftHint && <p className={styles.hint}>{strings.modal.shiftHint}</p>}
    </Modal>
  );
}

export interface SettingsFrameProps {
  isOpen: boolean;
  /**
   * Запрос на закрытие (крестик, Esc). Если есть несохранённые изменения, не закрывай слой, а
   * заставь `SaveBar` вздрогнуть (`attention`).
   */
  onCloseRequest: () => void;
  /** Название слоя для экранного диктора: «Настройки», «Настройки сервера». */
  "aria-label": string;
  /** Левая навигация: карточка, поиск, список разделов. */
  navigation: ReactNode;
  /** Заголовок текущего раздела. */
  title: ReactNode;
  /** Содержимое раздела. */
  children: ReactNode;
  /** Плашка несохранённых изменений (`SaveBar`) внизу контента. */
  saveBar?: ReactNode;
}

function SettingsFrame({
  variant,
  isOpen,
  onCloseRequest,
  navigation,
  title,
  children,
  saveBar,
  "aria-label": ariaLabel,
}: SettingsFrameProps & { variant: "modal" | "overlay" }) {
  const strings = useUiStrings();
  useEscapeLayer(EscLayer.modal, onCloseRequest, isOpen);

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCloseRequest();
      }}
      isKeyboardDismissDisabled
      className={cx(styles.overlay, variant === "overlay" && styles.fullscreen)}
    >
      <AriaModal className={styles.settings} data-variant={variant}>
        <Dialog aria-label={ariaLabel} className={styles.settingsDialog}>
          <nav aria-label={strings.settings.navigation} className={styles.settingsNav}>
            {navigation}
          </nav>
          <section className={styles.settingsMain}>
            <header className={styles.settingsHeader}>
              <Heading slot="title" className={styles.title}>
                {title}
              </Heading>
              <span className={styles.settingsClose}>
                <IconButton
                  icon={icons.close}
                  label={strings.settings.close}
                  onPress={onCloseRequest}
                />
                {variant === "overlay" && <Kbd>Esc</Kbd>}
              </span>
            </header>
            <div className={styles.settingsScroll}>
              <div className={styles.settingsContent}>{children}</div>
            </div>
            {saveBar && <div className={styles.settingsSaveBar}>{saveBar}</div>}
          </section>
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

/**
 * `Modal/Settings`: модальное окно настроек пользователя почти на весь экран (отступ 40 от краёв),
 * навигация ~290 слева, контент шириной до 700 по центру (SCREENS/04).
 */
export function SettingsModal(props: SettingsFrameProps) {
  return <SettingsFrame {...props} variant="modal" />;
}

/**
 * `Overlay/Settings`: полноэкранный слой настроек сервера и канала — без рейла и колонок,
 * навигация слева, крестик с подписью `Esc` справа.
 */
export function SettingsOverlay(props: SettingsFrameProps) {
  return <SettingsFrame {...props} variant="overlay" />;
}
