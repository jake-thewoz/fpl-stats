import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FriendsScreen from '../../screens/FriendsScreen';
import ManageFriendsScreen from '../../screens/ManageFriendsScreen';
import AddFriendScreen from '../../screens/AddFriendScreen';
import ImportLeagueScreen from '../../screens/ImportLeagueScreen';
import type { FriendsStackParamList } from '../types';

const Stack = createNativeStackNavigator<FriendsStackParamList>();

export function FriendsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen
        name="Friends"
        component={FriendsScreen}
        options={{ title: 'Friends' }}
      />
      <Stack.Screen
        name="ManageFriends"
        component={ManageFriendsScreen}
        options={{ title: 'Manage Friends' }}
      />
      <Stack.Screen
        name="AddFriend"
        component={AddFriendScreen}
        options={{ title: 'Add Friend' }}
      />
      <Stack.Screen
        name="ImportLeague"
        component={ImportLeagueScreen}
        options={{ title: 'Import from League' }}
      />
    </Stack.Navigator>
  );
}
