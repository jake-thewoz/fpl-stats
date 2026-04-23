import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

export function LoadingView() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
});
