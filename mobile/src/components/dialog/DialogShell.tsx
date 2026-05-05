import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../../theme';
import { WebShell } from '../WebShell';

export type DialogAction = {
  label: string;
  onPress: () => void;
  /** Disabled buttons show as dimmed and don't fire onPress. */
  disabled?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Secondary action shown on the left of the top bar. When absent
   *  a symmetric placeholder is reserved so the title stays centered. */
  leftAction?: DialogAction;
  /** Primary action shown on the right of the top bar. Always present. */
  rightAction: DialogAction;
  children: ReactNode;
};

/**
 * Shared chrome for the modal dialogs in the app.
 *
 * Owns the Modal, the WebShell wrapper, the container background, and
 * the top bar — including the symmetric-placeholder trick so dialogs
 * that don't have a Clear button (like ColumnPicker) keep the title
 * centered.
 *
 * Body content renders as-is. Dialogs that need scrolling wrap children
 * in their own ScrollView; dialogs with short fixed content (like
 * PositionFilterDialog) don't. Keeping the shell scroll-agnostic avoids
 * baking a layout decision into the chrome.
 */
export function DialogShell({
  visible,
  onClose,
  title,
  leftAction,
  rightAction,
  children,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <WebShell>
        <View style={styles.container}>
          <View style={styles.topBar}>
            {leftAction ? (
              <Pressable
                onPress={leftAction.onPress}
                hitSlop={8}
                disabled={leftAction.disabled}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionBtnSecondary,
                  leftAction.disabled && styles.actionBtnDisabled,
                  pressed && !leftAction.disabled && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.actionTextSecondary,
                    leftAction.disabled && styles.actionTextDisabled,
                  ]}
                >
                  {leftAction.label}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.actionPlaceholder} />
            )}
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={rightAction.onPress}
              hitSlop={8}
              disabled={rightAction.disabled}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionBtnPrimary,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.actionTextPrimary}>{rightAction.label}</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </WebShell>
    </Modal>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.safeTop,
      paddingBottom: spacing.lg,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    title: { fontSize: fontSize.lg2, fontWeight: '600', color: c.textPrimary },
    // Filled-button actions in the top bar — text-only labels were
    // too easy to miss in dark mode (#96 PR review).
    actionBtn: {
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      minWidth: 64,
      alignItems: 'center',
    },
    actionBtnPrimary: { backgroundColor: c.accent },
    actionBtnSecondary: {
      backgroundColor: c.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    actionBtnDisabled: effects.dimDisabled,
    actionTextPrimary: {
      color: c.onAccent,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    actionTextSecondary: {
      color: c.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '500',
    },
    actionTextDisabled: { color: c.textMuted },
    // Reserves space symmetrically opposite the right action so the
    // title stays centered when leftAction is absent.
    actionPlaceholder: {
      minWidth: 64,
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.md,
    },
    pressed: effects.pressed,
  });
