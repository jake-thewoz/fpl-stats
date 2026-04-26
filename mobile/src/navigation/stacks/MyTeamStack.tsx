import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MyTeamScreen from '../../screens/MyTeamScreen';
import GameweekScreen from '../../screens/GameweekScreen';
import type { MyTeamStackParamList } from '../types';

const Stack = createNativeStackNavigator<MyTeamStackParamList>();

export function MyTeamStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
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
