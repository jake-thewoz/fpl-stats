import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from '../../screens/SettingsScreen';
import type { SettingsStackParamList } from '../types';
import { gameweekBannerLayout } from './gameweekBannerLayout';
import { useStackHeaderOptions } from './headerOptions';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  const header = useStackHeaderOptions();
  return (
    <Stack.Navigator screenLayout={gameweekBannerLayout} screenOptions={header.stack}>
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={header.tabRoot('Settings')}
      />
    </Stack.Navigator>
  );
}
