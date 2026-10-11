import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FriendsScreen from '../../screens/FriendsScreen';
import FriendTeamScreen from '../../screens/FriendTeamScreen';
import ManageFriendsScreen from '../../screens/ManageFriendsScreen';
import AddFriendScreen from '../../screens/AddFriendScreen';
import ImportLeagueScreen from '../../screens/ImportLeagueScreen';
import type { FriendsStackParamList } from '../types';
import { gameweekBannerLayout } from './gameweekBannerLayout';
import { useStackHeaderOptions } from './headerOptions';

const Stack = createNativeStackNavigator<FriendsStackParamList>();

export function FriendsStack() {
  const header = useStackHeaderOptions();
  return (
    <Stack.Navigator screenLayout={gameweekBannerLayout} screenOptions={header.stack}>
      <Stack.Screen
        name="Friends"
        component={FriendsScreen}
        options={header.tabRoot('Friends')}
      />
      <Stack.Screen
        name="FriendTeam"
        component={FriendTeamScreen}
        options={({ route }) => ({ title: route.params.name })}
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
