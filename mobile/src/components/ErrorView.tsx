import { StyleSheet, View } from 'react-native';
import { ControlButton } from './ControlButton';
import { Text } from './Text';
import { fontRole, fontSize, spacing, useThemedStyles, type Colors } from '../theme';

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function ErrorView({ title, message, onRetry }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
      <ControlButton label="Retry" active onPress={onRetry} />
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
    title: {
      ...fontRole.display,
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.textPrimary,
    },
    body: { color: c.badText, textAlign: 'center' },
  });
