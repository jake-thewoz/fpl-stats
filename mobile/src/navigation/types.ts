/**
 * Centralised param-list types for the bottom-tab + per-tab-stack
 * navigation structure. Defining these once keeps screen prop typing
 * consistent across the app and makes cross-tab navigation type-safe via
 * `CompositeScreenProps`.
 *
 * Layout:
 *
 *   RootStack
 *     ├─ Onboarding   (single screen, gates entry to the app)
 *     └─ Main         (bottom-tab navigator)
 *          ├─ MyTeamTab    -> MyTeamStack    (MyTeam, Gameweek)
 *          ├─ PlayersTab   -> PlayersStack   (Players)
 *          ├─ AnalyticsTab -> AnalyticsStack (Analytics)
 *          ├─ FriendsTab   -> FriendsStack   (Friends, ManageFriends, AddFriend, ImportLeague)
 *          └─ SettingsTab  -> SettingsStack  (Settings)
 */
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MyTeamStackParamList = {
  MyTeam: undefined;
  Gameweek: undefined;
};

export type PlayersStackParamList = {
  Players: undefined;
};

export type AnalyticsStackParamList = {
  Analytics: undefined;
};

export type FriendsStackParamList = {
  Friends: undefined;
  ManageFriends: undefined;
  AddFriend: undefined;
  ImportLeague: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
};

export type MainTabParamList = {
  MyTeamTab: NavigatorScreenParams<MyTeamStackParamList>;
  PlayersTab: NavigatorScreenParams<PlayersStackParamList>;
  AnalyticsTab: NavigatorScreenParams<AnalyticsStackParamList>;
  FriendsTab: NavigatorScreenParams<FriendsStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
};

export type RootStackParamList = {
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
};

// Per-screen prop helpers. Cross-tab navigation (e.g. MyTeam's NoTeamId
// view jumping to the Settings tab) uses `navigation.getParent()` to
// reach the tab navigator, so screens just need their own stack's typing.

export type MyTeamScreenProps = CompositeScreenProps<
  NativeStackScreenProps<MyTeamStackParamList, 'MyTeam'>,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, 'MyTeamTab'>,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export type GameweekScreenProps = NativeStackScreenProps<MyTeamStackParamList, 'Gameweek'>;

export type PlayersScreenProps = NativeStackScreenProps<PlayersStackParamList, 'Players'>;

export type AnalyticsScreenProps = NativeStackScreenProps<AnalyticsStackParamList, 'Analytics'>;

export type FriendsScreenProps = CompositeScreenProps<
  NativeStackScreenProps<FriendsStackParamList, 'Friends'>,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList, 'FriendsTab'>,
    NativeStackScreenProps<RootStackParamList>
  >
>;

export type ManageFriendsScreenProps = NativeStackScreenProps<FriendsStackParamList, 'ManageFriends'>;
export type AddFriendScreenProps = NativeStackScreenProps<FriendsStackParamList, 'AddFriend'>;
export type ImportLeagueScreenProps = NativeStackScreenProps<FriendsStackParamList, 'ImportLeague'>;
export type SettingsScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;
export type OnboardingScreenProps = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;
