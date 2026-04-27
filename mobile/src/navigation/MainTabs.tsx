import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainTabParamList } from './types';
import { MyTeamStack } from './stacks/MyTeamStack';
import { PlayersStack } from './stacks/PlayersStack';
import { AnalyticsStack } from './stacks/AnalyticsStack';
import { FriendsStack } from './stacks/FriendsStack';
import { SettingsStack } from './stacks/SettingsStack';
import { useTheme } from '../theme';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const { colors } = useTheme();
  // Each tab's stack already provides headers (per-screen titles), so the
  // tab navigator itself shouldn't render a second header. headerShown:false
  // is set at the tab level and the stack-level headers stay.
  // Re-derive on every theme change so the tab bar tints + background flip
  // immediately when the user toggles theme.
  //
  // Tab item sizing is driven by the bar's *content area* (the bar's
  // height minus paddingBottom). Each tab item adds its own padding: 5
  // top + 5 bottom internally (per @react-navigation/bottom-tabs's
  // BottomTabItem styles), so its inner content gets `content_area − 10`.
  // The default icon (25) + label fontSize 12 with line-height padding
  // (~14) needs ~42 px of inner content to render without clipping;
  // we give it 50 px for comfort.
  //
  // Bar bottom padding follows the device's safe-area inset (≈34 on a
  // home-indicator iPhone) so the bar doesn't sit on top of the
  // indicator. On emulators / web that inset is 0, so we floor it at
  // MIN_BOTTOM_PADDING for breathing room. The padding pushes tab items
  // up but doesn't shrink them — bar height stretches to compensate.
  const insets = useSafeAreaInsets();
  const MIN_BOTTOM_PADDING = 16;
  const BAR_CONTENT_AREA = 60;
  const bottomPadding = Math.max(insets.bottom, MIN_BOTTOM_PADDING);
  const tabOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: {
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        height: BAR_CONTENT_AREA + bottomPadding,
        paddingBottom: bottomPadding,
      },
    }),
    [colors, bottomPadding],
  );

  return (
    <Tab.Navigator
      initialRouteName="MyTeamTab"
      screenOptions={tabOptions}
    >
      <Tab.Screen
        name="MyTeamTab"
        component={MyTeamStack}
        options={{
          title: 'My Team',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'shirt' : 'shirt-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="PlayersTab"
        component={PlayersStack}
        options={{
          title: 'Players',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'list' : 'list-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="AnalyticsTab"
        component={AnalyticsStack}
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'analytics' : 'analytics-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="FriendsTab"
        component={FriendsStack}
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
