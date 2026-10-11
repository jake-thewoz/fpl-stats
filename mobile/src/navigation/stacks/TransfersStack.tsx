import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TransfersScreen from '../../screens/Transfers';
import type { TransfersStackParamList } from '../types';
import { HelpButton } from '../../help/HelpButton';
import { gameweekBannerLayout } from './gameweekBannerLayout';
import { useStackHeaderOptions } from './headerOptions';

const Stack = createNativeStackNavigator<TransfersStackParamList>();

export function TransfersStack() {
  const header = useStackHeaderOptions();
  return (
    <Stack.Navigator screenLayout={gameweekBannerLayout} screenOptions={header.stack}>
      <Stack.Screen
        name="Transfers"
        component={TransfersScreen}
        options={header.tabRoot('Transfers', () => (
          <HelpButton topic="transfers" />
        ))}
      />
    </Stack.Navigator>
  );
}
