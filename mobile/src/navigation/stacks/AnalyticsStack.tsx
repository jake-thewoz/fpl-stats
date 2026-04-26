import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AnalyticsScreen from '../../screens/AnalyticsScreen';
import type { AnalyticsStackParamList } from '../types';

const Stack = createNativeStackNavigator<AnalyticsStackParamList>();

export function AnalyticsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{ title: 'Analytics' }}
      />
    </Stack.Navigator>
  );
}
