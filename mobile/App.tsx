import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from './src/config';

type HealthResponse = { ok: boolean; time: string };

type State =
  | { status: 'loading' }
  | { status: 'ok'; time: string }
  | { status: 'error'; message: string };

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!API_BASE_URL) {
      setState({
        status: 'error',
        message: 'EXPO_PUBLIC_API_BASE_URL is not set. See mobile/.env.example.',
      });
      return;
    }

    fetch(`${API_BASE_URL}/health`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as HealthResponse;
        if (!body.ok) throw new Error('Health response returned ok=false');
        setState({ status: 'ok', time: body.time });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', message });
      });
  }, []);

  return (
    <View style={styles.container}>
      {state.status === 'loading' && <ActivityIndicator />}
      {state.status === 'ok' && <Text>OK: {state.time}</Text>}
      {state.status === 'error' && (
        <Text style={styles.error}>Error: {state.message}</Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  error: {
    color: '#b00020',
    textAlign: 'center',
  },
});
