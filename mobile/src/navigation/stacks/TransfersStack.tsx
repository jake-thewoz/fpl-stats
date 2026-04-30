import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TransfersScreen from '../../screens/TransfersScreen';
import type { TransfersStackParamList } from '../types';

const Stack = createNativeStackNavigator<TransfersStackParamList>();

export function TransfersStack() {
  return (
    <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen
        name="Transfers"
        component={TransfersScreen}
        options={{ title: 'Transfers' }}
      />
    </Stack.Navigator>
  );
}
