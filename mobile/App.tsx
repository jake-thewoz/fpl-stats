import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { LoadingView } from './src/components/LoadingView';
import { getFplTeamId, getOnboardingSeen } from './src/storage/user';
import { MainTabs } from './src/navigation/MainTabs';
import type { RootStackParamList } from './src/navigation/types';
import { colors } from './src/theme';

// Re-export so screens can keep importing param-list types from `'../../App'`
// during the transition without churn. (`./src/navigation/types` is the
// new canonical home.)
export type { RootStackParamList } from './src/navigation/types';

const RootStack = createNativeStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
    notification: colors.accent,
  },
};

type BootstrapState =
  | { status: 'loading' }
  | { status: 'ready'; initialRoute: keyof RootStackParamList };

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([getFplTeamId(), getOnboardingSeen()]).then(([id, seen]) => {
      setBootstrap({
        status: 'ready',
        initialRoute: id || seen ? 'Main' : 'Onboarding',
      });
    });
  }, []);

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
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}
