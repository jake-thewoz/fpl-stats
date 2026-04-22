import { StyleSheet, Text, View } from 'react-native';

export default function PlayersScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Players</Text>
      <Text style={styles.body}>Player list will go here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: { fontSize: 28, fontWeight: '600' },
  body: { textAlign: 'center' },
});
