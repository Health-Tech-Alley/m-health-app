// components/BottomNav.tsx
import { usePathname, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();

//   const go = (route: string) => router.push(route);

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', padding: 12, borderTopWidth: 1, borderColor: '#E5E7EB' }}>
      <Pressable onPress={() => router.push('/')}>
        <Text style={{ color: pathname === '/' ? 'blue' : 'gray' }}>
          Home
        </Text>
      </Pressable>

      <Pressable onPress={() => router.push('/dashboard')}>
        <Text style={{ color: pathname === '/dashboard' ? 'blue' : 'gray' }}>
          Dashboard
        </Text>
      </Pressable>

      <Pressable onPress={() => router.push('/ai')}>
        <Text>AI</Text>
      </Pressable>

      <Pressable onPress={() => router.push('/patientListScreen')}>
        <Text>Patients</Text>
      </Pressable>
    </View>
  );
}