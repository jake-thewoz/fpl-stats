import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Nested Pressable traps touches so the backdrop only dismisses when
            tapped outside the dialog surface. */}
        <Pressable style={styles.dialog} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btn,
                styles.btnSecondary,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.btnSecondaryText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDanger : styles.btnPrimary,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={destructive ? styles.btnDangerText : styles.btnPrimaryText}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxl,
    },
    dialog: {
      width: '100%',
      // 360px is the max-width cap for the centered dialog surface; the
      // scale above (radius.lg = 16) is too round for a small dialog so
      // 12 stays inline with the cap.
      maxWidth: 360,
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: spacing.xl2,
      gap: spacing.lg,
    },
    title: { fontSize: fontSize.lg2, fontWeight: '700', color: c.textPrimary },
    message: { fontSize: fontSize.md, color: c.textMuted, lineHeight: 20 },
    actions: { flexDirection: 'row', gap: spacing.base, marginTop: spacing.md },
    btn: {
      flex: 1,
      // 11px is a tight one-off button height between spacing.base (10)
      // and spacing.lg (12); leaving inline rather than promoting.
      paddingVertical: 11,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    btnSecondary: {
      backgroundColor: c.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    btnSecondaryText: {
      color: c.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    btnPrimary: { backgroundColor: c.accent },
    btnPrimaryText: { color: c.onAccent, fontSize: fontSize.base, fontWeight: '600' },
    btnDanger: { backgroundColor: c.danger },
    btnDangerText: { color: c.onDanger, fontSize: fontSize.base, fontWeight: '600' },
    pressed: effects.pressedSubtle,
  });
