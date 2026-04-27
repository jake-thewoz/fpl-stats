import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
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
  const tabOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: {
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
      },
    }),
    [colors],
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
