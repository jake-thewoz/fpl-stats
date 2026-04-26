import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PlayersScreen from '../../screens/PlayersScreen';
import type { PlayersStackParamList } from '../types';

const Stack = createNativeStackNavigator<PlayersStackParamList>();

export function PlayersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen
        name="Players"
        component={PlayersScreen}
        options={{ title: 'Players' }}
      />
    </Stack.Navigator>
  );
}
