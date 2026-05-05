import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { spacing, useTheme, useThemedStyles, type Colors } from '../theme';

export function LoadingView() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accent} />
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
      backgroundColor: c.background,
    },
  });
