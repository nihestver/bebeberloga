// SPDX-FileCopyrightText: 2026 Bebeberloga contributors
// SPDX-License-Identifier: GPL-3.0-or-later WITH LicenseRef-Bebeberloga-AppStore-exception

// Дизайн-система Bebeberloga: компоненты каталога docs/spec/SCREENS/COMPONENTS.md.
// Стили подключаются отдельно: `import "@/ui/styles"` один раз в приложении.

export {
  Avatar,
  AVATAR_SIZES,
  COMMUNITY_ICON_SIZES,
  CommunityIcon,
  communityInitials,
} from "./Avatar/Avatar";
export type {
  AvatarProps,
  AvatarSize,
  AvatarStatus,
  CommunityIconProps,
  CommunityIconSize,
} from "./Avatar/Avatar";
export {
  AVATAR_TONES,
  builtinAvatarIds,
  builtinAvatarMarkup,
  defaultAvatarTone,
  FALLBACK_AVATAR_ID,
  isBuiltinAvatarId,
} from "./Avatar/builtin";
export type { BuiltinAvatarId } from "./Avatar/builtin";
export { CountBadge, E2EEBadge, formatCount, LiveBadge, PillBadge, UnreadPip } from "./Badge/Badge";
export type {
  CountBadgeProps,
  E2EEBadgeProps,
  E2EEState,
  LiveBadgeProps,
  PillBadgeProps,
  UnreadPipProps,
} from "./Badge/Badge";
export { Banner, SAVE_BAR_ALERT_MS, SaveBar } from "./Banner/Banner";
export type { BannerProps, SaveBarProps } from "./Banner/Banner";
export { Button, HangupButton, IconButton, IconToggleButton } from "./Button/Button";
export type {
  ButtonProps,
  ButtonVariant,
  HangupButtonProps,
  IconButtonProps,
  IconToggleButtonProps,
} from "./Button/Button";
export { Spinner } from "./Button/Spinner";
export type { SpinnerProps } from "./Button/Spinner";
export { SplitButton } from "./Button/SplitButton";
export type { SplitButtonProps } from "./Button/SplitButton";
export { CALL_TOAST_TIMEOUT_MS, CallToast } from "./CallToast/CallToast";
export type { CallToastProps } from "./CallToast/CallToast";
export { Card, LinkCard, Table } from "./Card/Card";
export type { CardProps, LinkCardProps, TableColumn, TableProps } from "./Card/Card";
export { Checkbox } from "./Checkbox/Checkbox";
export type { CheckboxProps } from "./Checkbox/Checkbox";
export { ChipGroup } from "./Chip/Chip";
export type { ChipGroupProps, ChipItem } from "./Chip/Chip";
export { CodeInput } from "./CodeInput/CodeInput";
export type { CodeInputProps } from "./CodeInput/CodeInput";
export { ColorSwatches, defaultSwatches } from "./ColorSwatches/ColorSwatches";
export type { ColorSwatchesProps } from "./ColorSwatches/ColorSwatches";
export { EmptyState, SearchingBear, SleepingBear } from "./EmptyState/EmptyState";
export type { EmptyStateProps } from "./EmptyState/EmptyState";
export { Icon, ICON_STROKE } from "./icons/Icon";
export type { IconComponent, IconGlyphProps, IconProps } from "./icons/Icon";
export { icons } from "./icons/icons";
export type { IconName } from "./icons/icons";
export { designIcon, designIconNames } from "./icons/designIcons";
export {
  ActionInput,
  CHANNEL_NAME_MAX,
  ChannelNameInput,
  normalizeChannelName,
  RichTextInput,
  SearchInput,
  Textarea,
  TextInput,
} from "./Input/Input";
export type {
  ActionInputProps,
  ChannelNameInputProps,
  RichTextFormat,
  RichTextInputProps,
  SearchInputProps,
  TextareaProps,
  TextInputProps,
} from "./Input/Input";
export { Kbd, KeyComboView, ShortcutKeys } from "./Kbd/Kbd";
export type { KbdProps, KeyComboViewProps, ShortcutKeysProps } from "./Kbd/Kbd";
export { KeyRecorder } from "./KeyRecorder/KeyRecorder";
export type { KeyRecorderProps } from "./KeyRecorder/KeyRecorder";
export { Divider, ListRow, RowList, SectionHeader } from "./List/List";
export type { DividerProps, ListRowProps, RowListProps, SectionHeaderProps } from "./List/List";
export {
  ContextMenu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  PopoverMenu,
  QuickReactions,
  SUBMENU_DELAY_MS,
  Submenu,
} from "./Menu/Menu";
export type {
  ContextMenuProps,
  MenuItemProps,
  MenuSectionProps,
  PopoverMenuProps,
  QuickReactionsProps,
  SubmenuProps,
} from "./Menu/Menu";
export { MINI_PLAYER_INSET, MiniPlayer, moveCorner, nearestCorner } from "./MiniPlayer/MiniPlayer";
export type { MiniPlayerCorner, MiniPlayerProps } from "./MiniPlayer/MiniPlayer";
export { ConfirmModal, Modal, SettingsModal, SettingsOverlay } from "./Modal/Modal";
export type { ConfirmModalProps, ModalProps, SettingsFrameProps } from "./Modal/Modal";
export { PopoverPanel } from "./Popover/PopoverPanel";
export type { PopoverPanelProps } from "./Popover/PopoverPanel";
export { PasswordStrength, ProgressBar, Skeleton, SkeletonText } from "./Progress/Progress";
export type {
  PasswordScore,
  PasswordStrengthProps,
  ProgressBarProps,
  SkeletonProps,
  SkeletonTextProps,
} from "./Progress/Progress";
export { QR_CENTER, QR_PADDING, QR_SIZE, QRCode, qrModules, qrPath } from "./QR/QRCode";
export type { QRCodeProps } from "./QR/QRCode";
export { defaultQRDecoder, QR_SCAN_INTERVAL_MS, QRScanner } from "./QR/QRScanner";
export type { QRDecoder, QRFrame, QRScannerProps, QRScannerState } from "./QR/QRScanner";
export { Radio, RadioCard, RadioGroup } from "./Radio/Radio";
export type { RadioCardProps, RadioGroupProps, RadioProps } from "./Radio/Radio";
export { SegmentedControl, TriState } from "./SegmentedControl/SegmentedControl";
export type {
  SegmentedControlProps,
  SegmentOption,
  TriStateProps,
  TriStateValue,
} from "./SegmentedControl/SegmentedControl";
export { Select, SELECT_SEARCH_THRESHOLD } from "./Select/Select";
export type { SelectOption, SelectProps } from "./Select/Select";
export { EscLayer, activeEscapeLayers, useEscapeLayer } from "./shortcuts/escape";
export type { EscLayerLevel } from "./shortcuts/escape";
export {
  comboFromEvent,
  comboLabels,
  detectPlatform,
  isEditableTarget,
  matchesCombo,
  parseCombo,
} from "./shortcuts/keys";
export type { KeyCombo, KeyEventLike, Platform } from "./shortcuts/keys";
export {
  knownSystemConflicts,
  knownTextEditingConflicts,
  scopeInput,
  shortcutCombos,
  shortcutDefinition,
  shortcutGroups,
  shortcutIds,
  shortcuts,
  systemReserved,
  textEditingReserved,
} from "./shortcuts/registry";
export type {
  ShortcutDefinition,
  ShortcutGroup,
  ShortcutId,
  ShortcutScope,
} from "./shortcuts/registry";
export { setShortcutPlatform, useShortcut } from "./shortcuts/useShortcut";
export type { UseShortcutOptions } from "./shortcuts/useShortcut";
export { LevelMeter, litBars, Slider, ThresholdSlider } from "./Slider/Slider";
export type { LevelMeterProps, SliderProps, ThresholdSliderProps } from "./Slider/Slider";
export { formatMessage, UiProvider, uiDictionaries, useUiStrings } from "./strings/UiProvider";
export type { UiLocale, UiProviderProps, UiStrings } from "./strings/UiProvider";
export { Tabs } from "./Tabs/Tabs";
export type { TabItem, TabsProps } from "./Tabs/Tabs";
export {
  createToastQueue,
  showToast,
  TOAST_LIMIT,
  TOAST_MAX_MS,
  TOAST_MIN_MS,
  toastQueue,
  ToastRegion,
} from "./Toast/Toast";
export type { ShowToastOptions, ToastMessage, ToastQueue, ToastRegionProps } from "./Toast/Toast";
export { Toggle } from "./Toggle/Toggle";
export type { ToggleProps } from "./Toggle/Toggle";
export {
  Tooltip,
  TOOLTIP_DELAY_MS,
  TOOLTIP_SUCCESS_MS,
  useSuccessTooltip,
} from "./Tooltip/Tooltip";
export type { TooltipProps } from "./Tooltip/Tooltip";
export { cssVar, themes, tokenValue } from "./tokens";
export type { ColorToken, RadiusToken, SpaceToken, Theme } from "./tokens";
export { cx } from "./utils/cx";
export {
  formatDuration,
  WAVEFORM_HEIGHT,
  WAVEFORM_WIDTH,
  WaveformTrimmer,
} from "./WaveformTrimmer/WaveformTrimmer";
export type { WaveformTrimmerProps } from "./WaveformTrimmer/WaveformTrimmer";
