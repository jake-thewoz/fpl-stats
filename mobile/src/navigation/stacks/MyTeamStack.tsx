import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyTeamScreen from '../../screens/MyTeam';
import GameweekScreen from '../../screens/GameweekScreen';
import type { MyTeamStackParamList } from '../types';
import { gameweekBannerLayout } from './gameweekBannerLayout';

const Stack = createNativeStackNavigator<MyTeamStackParamList>();

export function MyTeamStack() {
  return (
    <Stack.Navigator
      screenLayout={gameweekBannerLayout}
      screenOptions={{ headerTitleAlign: 'center' }}
    >
      <Stack.Screen
        name="MyTeam"
        component={MyTeamScreen}
        options={{ title: 'My Team' }}
      />
      <Stack.Screen
        name="Gameweek"
        component={GameweekScreen}
        options={{ title: 'Gameweek' }}
      />
    </Stack.Navigator>
  );
}
