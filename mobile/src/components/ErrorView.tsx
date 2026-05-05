import { Button, StyleSheet, Text, View } from 'react-native';
import { fontSize, spacing, useTheme, useThemedStyles, type Colors } from '../theme';

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function ErrorView({ title, message, onRetry }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
      <Button title="Retry" onPress={onRetry} color={colors.accent} />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxl,
      gap: spacing.lg,
      backgroundColor: c.background,
    },
    title: { fontSize: fontSize.xl, fontWeight: '600', color: c.textPrimary },
    body: { color: c.danger, textAlign: 'center' },
  });
