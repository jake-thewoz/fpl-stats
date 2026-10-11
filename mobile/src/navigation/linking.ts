import { Platform } from 'react-native';
import {
  getStateFromPath,
  type LinkingOptions,
  type PathConfig,
} from '@react-navigation/native';
import type { FriendsStackParamList, RootStackParamList } from './types';

// React Navigation can't infer a nested stack's param list when one of its
// routes takes required params (FriendTeam), and would reject
// `initialRouteName` here. Typing it against the list directly restores
// the check.
const FRIENDS_PATHS: PathConfig<FriendsStackParamList> = {
  initialRouteName: 'Friends',
  screens: {
    Friends: 'friends',
    ManageFriends: 'friends/manage',
    AddFriend: 'friends/add',
    ImportLeague: 'friends/import',
    FriendTeam: 'friends/:teamId',
  },
};

/**
 * URL paths for every screen. On web this is what puts each navigation
 * into the browser's history, so the Android back button (or gesture) in
 * the installed web app steps back through screens instead of closing
 * the app. It also lets a reload or a shared link land on the same
 * screen. Native apps get back handling from the navigators themselves,
 * so linking stays off there.
 *
 * Amplify's `404-200` rewrite serves index.html for these paths.
 */
export function makeLinking(
  needsOnboarding: boolean,
): LinkingOptions<RootStackParamList> {
  return {
    enabled: Platform.OS === 'web',
    prefixes: [],
    // `initialRouteName`s put the tab under Gameweek, and the Friends list
    // under a friend's squad, when a reload or link opens one directly, so
    // back still has somewhere to go.
    config: {
      initialRouteName: 'Main',
      screens: {
        Onboarding: 'welcome',
        Gameweek: 'gameweek',
        Main: {
          screens: {
            MyTeamTab: { screens: { MyTeam: '' } },
            PlayersTab: { screens: { Players: 'players' } },
            TransfersTab: { screens: { Transfers: 'transfers' } },
            FriendsTab: FRIENDS_PATHS,
            SettingsTab: { screens: { Settings: 'settings' } },
          },
        },
      },
    },
    // A first-time visitor sees onboarding whatever the URL, as they did
    // before URLs mapped to screens.
    getStateFromPath: (path, options) =>
      needsOnboarding ? undefined : getStateFromPath(path, options),
  };
}
