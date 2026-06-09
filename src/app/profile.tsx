import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function ProfileScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView>
        <ThemedText type="title">Profile</ThemedText>
        {name && <ThemedText>{name}</ThemedText>}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
});