import { Button, StyleSheet, Text, View } from 'react-native';

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function ErrorView({ title, message, onRetry }: Props) {
  return (
    <View style={styles.centered}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
      <Button title="Retry" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '600' },
  body: { color: '#b00020', textAlign: 'center' },
});
