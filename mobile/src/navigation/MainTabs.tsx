import { useMemo, type ComponentProps, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainTabParamList } from './types';
import { MyTeamStack } from './stacks/MyTeamStack';
import { PlayersStack } from './stacks/PlayersStack';
import { TransfersStack } from './stacks/TransfersStack';
import { FriendsStack } from './stacks/FriendsStack';
import { SettingsStack } from './stacks/SettingsStack';
import { GameweekStatusProvider } from '../gameweek/GameweekStatusProvider';
import { Text } from '../components/Text';
import {
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type TabDefinition = {
  name: keyof MainTabParamList;
  title: string;
  component: ComponentType;
  icon: IconName;
  focusedIcon: IconName;
};

const TABS: readonly TabDefinition[] = [
  {
    name: 'MyTeamTab',
    title: 'My Team',
    component: MyTeamStack,
    icon: 'shirt-outline',
    focusedIcon: 'shirt',
  },
  {
    name: 'PlayersTab',
    title: 'Players',
    component: PlayersStack,
    icon: 'list-outline',
    focusedIcon: 'list',
  },
  {
    name: 'TransfersTab',
    title: 'Transfers',
    component: TransfersStack,
    icon: 'swap-horizontal-outline',
    focusedIcon: 'swap-horizontal',
  },
  {
    name: 'FriendsTab',
    title: 'Friends',
    component: FriendsStack,
    icon: 'people-outline',
    focusedIcon: 'people',
  },
  {
    name: 'SettingsTab',
    title: 'Settings',
    component: SettingsStack,
    icon: 'settings-outline',
    focusedIcon: 'settings',
  },
];

// Material 3 navigation-bar proportions: a capsule wider than tall
// behind the active icon.
const ICON_SIZE = 22;
const CAPSULE_WIDTH = 56;
const CAPSULE_HEIGHT = 30;

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
    <GameweekStatusProvider>
      <Tab.Navigator initialRouteName="MyTeamTab" screenOptions={tabOptions}>
        {TABS.map((tab) => (
          <Tab.Screen
            key={tab.name}
            name={tab.name}
            component={tab.component}
            options={{
              title: tab.title,
              tabBarIcon: ({ focused }) => <TabIcon tab={tab} focused={focused} />,
              tabBarLabel: ({ focused }) => (
                <TabLabel title={tab.title} focused={focused} />
              ),
            }}
          />
        ))}
      </Tab.Navigator>
    </GameweekStatusProvider>
  );
}

function TabIcon({ tab, focused }: { tab: TabDefinition; focused: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.capsule, focused && styles.capsuleFocused]}>
      <Ionicons
        name={focused ? tab.focusedIcon : tab.icon}
        size={ICON_SIZE}
        color={focused ? colors.accentText : colors.textMuted}
      />
    </View>
  );
}

function TabLabel({ title, focused }: { title: string; focused: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={[styles.label, focused && styles.labelFocused]} numberOfLines={1}>
      {title}
    </Text>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    capsule: {
      width: CAPSULE_WIDTH,
      height: CAPSULE_HEIGHT,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    capsuleFocused: { backgroundColor: colors.accentSoft },
    label: {
      fontSize: fontSize.xs,
      fontWeight: '500',
      color: colors.textMuted,
      marginTop: spacing.hairline,
    },
    labelFocused: { fontWeight: '700', color: colors.textPrimary },
  });
