import { Slot } from 'expo-router';
import { useColorScheme, View } from 'react-native';
import BottomNav from './bottom_nav';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <View style={{ flex: 1 }}>
      <Slot />
      <BottomNav />
    </View>
  );
}