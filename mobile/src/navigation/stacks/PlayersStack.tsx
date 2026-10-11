import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PlayersScreen from '../../screens/PlayersScreen';
import type { PlayersStackParamList } from '../types';
import { HelpButton } from '../../help/HelpButton';
import { gameweekBannerLayout } from './gameweekBannerLayout';
import { useStackHeaderOptions } from './headerOptions';

const Stack = createNativeStackNavigator<PlayersStackParamList>();

export function PlayersStack() {
  const header = useStackHeaderOptions();
  return (
    <Stack.Navigator screenLayout={gameweekBannerLayout} screenOptions={header.stack}>
      <Stack.Screen
        name="Players"
        component={PlayersScreen}
        options={header.tabRoot('Players', () => (
          <HelpButton topic="players" />
        ))}
      />
    </Stack.Navigator>
  );
}
