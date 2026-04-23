import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PlayersScreen from './src/screens/PlayersScreen';
import GameweekScreen from './src/screens/GameweekScreen';
import MyTeamScreen from './src/screens/MyTeamScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { LoadingView } from './src/components/LoadingView';
import { getFplTeamId, getOnboardingSeen } from './src/storage/user';
import { colors } from './src/theme';

export type RootStackParamList = {
  Onboarding: undefined;
  Players: undefined;
  Gameweek: undefined;
  MyTeam: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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
        initialRoute: id || seen ? 'Players' : 'Onboarding',
      });
    });
  }, []);

  if (bootstrap.status === 'loading') {
    return <LoadingView />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName={bootstrap.initialRoute}
        screenOptions={{ headerTitleAlign: 'center' }}
      >
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Players"
          component={PlayersScreen}
          options={{ title: 'FPL Stats' }}
        />
        <Stack.Screen name="Gameweek" component={GameweekScreen} />
        <Stack.Screen
          name="MyTeam"
          component={MyTeamScreen}
          options={{ title: 'My Team' }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}
