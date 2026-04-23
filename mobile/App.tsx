import { StatusBar } from 'expo-status-bar';
import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PlayersScreen from './src/screens/PlayersScreen';
import GameweekScreen from './src/screens/GameweekScreen';
import { colors } from './src/theme';

export type RootStackParamList = {
  Players: undefined;
  Gameweek: undefined;
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

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName="Players">
        <Stack.Screen
          name="Players"
          component={PlayersScreen}
          options={{ title: 'FPL Stats' }}
        />
        <Stack.Screen name="Gameweek" component={GameweekScreen} />
      </Stack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}
