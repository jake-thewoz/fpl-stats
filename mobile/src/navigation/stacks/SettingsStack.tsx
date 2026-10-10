import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from '../../screens/SettingsScreen';
import type { SettingsStackParamList } from '../types';
import { gameweekBannerLayout } from './gameweekBannerLayout';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  return (
    <Stack.Navigator
      screenLayout={gameweekBannerLayout}
      screenOptions={{ headerTitleAlign: 'center' }}
    >
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Stack.Navigator>
  );
}
