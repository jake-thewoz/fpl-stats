import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { LoadingView } from './src/components/LoadingView';
import { getFplTeamId, getOnboardingSeen } from './src/storage/user';
import { MainTabs } from './src/navigation/MainTabs';
import type { RootStackParamList } from './src/navigation/types';
import { ThemeProvider, useTheme } from './src/theme';

// Re-export so screens can keep importing param-list types from `'../../App'`
// during the transition without churn. (`./src/navigation/types` is the
// new canonical home.)
export type { RootStackParamList } from './src/navigation/types';

const RootStack = createNativeStackNavigator<RootStackParamList>();

type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; initialRoute: keyof RootStackParamList };

export default function App() {
  return (
    <ThemeProvider>
      <ThemedAppRoot />
    </ThemeProvider>
  );
}

/** Inner shell — runs inside ThemeProvider so it can derive the
 *  React Navigation theme + status bar style reactively. */
function ThemedAppRoot() {
  const { colors, effectiveMode } = useTheme();
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([getFplTeamId(), getOnboardingSeen()]).then(([id, seen]) => {
      setBootstrap({
        status: 'ready',
        initialRoute: id || seen ? 'Main' : 'Onboarding',
      });
    });
  }, []);

  // Recompute the React Navigation theme whenever our palette changes
  // — headers, tab bar, back buttons all pick up the new colors via
  // NavigationContainer's `theme` prop.
  const navTheme = useMemo<Theme>(
    () => ({
      ...DefaultTheme,
      dark: effectiveMode === 'dark',
      colors: {
        ...DefaultTheme.colors,
        background: colors.background,
        card: colors.surface,
        text: colors.textPrimary,
        border: colors.border,
        primary: colors.accent,
        notification: colors.accent,
      },
    }),
    [colors, effectiveMode],
  );

  if (bootstrap.status === 'loading') {
    return <LoadingView />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <RootStack.Navigator
        initialRouteName={bootstrap.initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
        <RootStack.Screen name="Main" component={MainTabs} />
      </RootStack.Navigator>
      {/* Status bar inverts with the theme — light glyphs on dark bg,
          dark glyphs on light bg. */}
      <StatusBar style={effectiveMode === 'dark' ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}
