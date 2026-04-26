import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AnalyticsScreenProps } from '../navigation/types';
import { colors } from '../theme';

// Placeholder for #39 — the bottom-tab nav is shipping in #94, but the
// Analytics tab needs a screen so the layout is final from day one.
// Replaced when #39 lands the transfer-suggestions view.
export default function AnalyticsScreen(_props: AnalyticsScreenProps) {
  return (
    <View style={styles.container}>
      <Ionicons
        name="analytics-outline"
        size={64}
        color={colors.textMuted}
        style={styles.icon}
      />
      <Text style={styles.title}>Coming soon</Text>
      <Text style={styles.body}>
        Transfer suggestions and other analytics for your squad will live
        here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
