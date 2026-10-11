import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyTeamScreen from '../../screens/MyTeam';
import GameweekScreen from '../../screens/GameweekScreen';
import type { MyTeamStackParamList } from '../types';
import { HelpButton } from '../../help/HelpButton';
import { gameweekBannerLayout } from './gameweekBannerLayout';
import { useStackHeaderOptions } from './headerOptions';

const Stack = createNativeStackNavigator<MyTeamStackParamList>();

export function MyTeamStack() {
  const header = useStackHeaderOptions();
  return (
    <Stack.Navigator screenLayout={gameweekBannerLayout} screenOptions={header.stack}>
      <Stack.Screen
        name="MyTeam"
        component={MyTeamScreen}
        options={header.tabRoot('My Team', () => (
          <HelpButton topic="myTeam" />
        ))}
      />
      <Stack.Screen
        name="Gameweek"
        component={GameweekScreen}
        options={{ title: 'Gameweek' }}
      />
    </Stack.Navigator>
  );
}
