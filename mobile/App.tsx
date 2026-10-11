import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import OnboardingScreen from './src/screens/OnboardingScreen';
import GameweekScreen from './src/screens/GameweekScreen';
import { LoadingView } from './src/components/LoadingView';
import { WebShell } from './src/components/WebShell';
import { getFplTeamId, getOnboardingSeen } from './src/storage/user';
import { MainTabs } from './src/navigation/MainTabs';
import { makeLinking } from './src/navigation/linking';
import { useStackHeaderOptions } from './src/navigation/stacks/headerOptions';
import type { RootStackParamList } from './src/navigation/types';
import {
  CustomFontsContext,
  FONT_ASSETS,
  ThemeProvider,
  resolveFontFace,
  useCustomFontsLoaded,
  useTheme,
  type FontRole,
} from './src/theme';
import { persistOptions, queryClient, subscribeToAppFocus } from './src/query/client';
import { APP_NAME } from './src/config';

// Re-export so screens can keep importing param-list types from `'../../App'`
// during the transition without churn. (`./src/navigation/types` is the
// new canonical home.)
export type { RootStackParamList } from './src/navigation/types';

const RootStack = createNativeStackNavigator<RootStackParamList>();

const ONBOARDING_TITLE = 'Welcome';
const GAMEWEEK_TITLE = 'Gameweek';
const DOCUMENT_TITLE_SEPARATOR = ' · ';

// Browser tab and history titles on web, e.g. "Players · Captain's Log".
const documentTitle = {
  formatter: (options?: { title?: string }) =>
    options?.title ? `${options.title}${DOCUMENT_TITLE_SEPARATOR}${APP_NAME}` : APP_NAME,
};

// Hold the native splash until the fonts settle, so the first frame
// isn't drawn in the system font. A no-op on web.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden (e.g. after a fast refresh) — nothing to hold.
});

// Each face already is its weight, so the navigator's own weight stays
// regular rather than asking for a bolder variant of a bold face.
const FACE_WEIGHT = '400';

function navigationFont(role: FontRole, weight: number) {
  return { fontFamily: resolveFontFace(role, weight), fontWeight: FACE_WEIGHT } as const;
}

// Header titles take the display font; tab labels and back buttons body.
const NAVIGATION_FONTS: Theme['fonts'] = {
  regular: navigationFont('body', 400),
  medium: navigationFont('body', 500),
  bold: navigationFont('display', 700),
  heavy: navigationFont('display', 800),
};

type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; initialRoute: keyof RootStackParamList };

export default function App() {
  useEffect(subscribeToAppFocus, []);
  const [fontsLoaded, fontsError] = useFonts(FONT_ASSETS);
  // A failed load still lets the app start; `Text` falls back to the
  // system font when the context below says the fonts aren't there.
  const fontsSettled = fontsLoaded || fontsError != null;

  useEffect(() => {
    if (fontsSettled) {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden — nothing to do.
      });
    }
  }, [fontsSettled]);

  if (!fontsSettled) {
    return null;
  }

  // SafeAreaProvider must wrap anything that calls useSafeAreaInsets()
  // (notably the bottom tab bar in MainTabs.tsx). Without it, insets fall
  // back to 0 on real devices, which would clip content under the home
  // indicator.
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SafeAreaProvider>
        <ThemeProvider>
          <CustomFontsContext.Provider value={fontsLoaded}>
            <WebShell>
              <ThemedAppRoot />
            </WebShell>
          </CustomFontsContext.Provider>
        </ThemeProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}

/** Inner shell — runs inside ThemeProvider so it can derive the
 *  React Navigation theme + status bar style reactively. */
function ThemedAppRoot() {
  const { colors, effectiveMode } = useTheme();
  const customFontsLoaded = useCustomFontsLoaded();
  const header = useStackHeaderOptions();
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
      fonts: customFontsLoaded ? NAVIGATION_FONTS : DefaultTheme.fonts,
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
    [colors, effectiveMode, customFontsLoaded],
  );

  const linking = useMemo(
    () =>
      bootstrap.status === 'ready'
        ? makeLinking(bootstrap.initialRoute === 'Onboarding')
        : undefined,
    [bootstrap],
  );

  if (bootstrap.status === 'loading') {
    return <LoadingView />;
  }

  return (
    <NavigationContainer theme={navTheme} documentTitle={documentTitle} linking={linking}>
      <RootStack.Navigator
        initialRouteName={bootstrap.initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <RootStack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ title: ONBOARDING_TITLE }}
        />
        <RootStack.Screen name="Main" component={MainTabs} />
        <RootStack.Screen
          name="Gameweek"
          component={GameweekScreen}
          options={{ ...header.stack, headerShown: true, title: GAMEWEEK_TITLE }}
        />
      </RootStack.Navigator>
      {/* Status bar inverts with the theme — light glyphs on dark bg,
          dark glyphs on light bg. */}
      <StatusBar style={effectiveMode === 'dark' ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}
