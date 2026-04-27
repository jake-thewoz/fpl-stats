import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles, type Colors } from '../theme';

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
  visible, title, message,
  confirmLabel = 'OK', cancelLabel = 'Cancel',
  destructive = false,
  onConfirm, onCancel,
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
                styles.btn, styles.btnSecondary, pressed && styles.pressed,
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
      // Backdrop stays a fixed dark scrim across both themes — a theme-
      // tinted overlay would feel uncertain. Lower opacity reads as "dim
      // the world" rather than "I have no idea what's behind me".
      backgroundColor: 'rgba(7, 7, 7, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    dialog: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 20,
      gap: 12,
    },
    title: { fontSize: 17, fontWeight: '700', color: c.textPrimary },
    message: { fontSize: 14, color: c.textMuted, lineHeight: 20 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
    btn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 8,
      alignItems: 'center',
    },
    btnSecondary: {
      backgroundColor: c.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    btnSecondaryText: { color: c.textPrimary, fontSize: 15, fontWeight: '600' },
    btnPrimary: { backgroundColor: c.accent },
    btnPrimaryText: { color: c.onAccent, fontSize: 15, fontWeight: '600' },
    btnDanger: { backgroundColor: c.danger },
    btnDangerText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
