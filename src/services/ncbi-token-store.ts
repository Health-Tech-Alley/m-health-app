import * as SecureStore from 'expo-secure-store';

const NCBI_KEY = 'ncbi_api_key';

export async function getNcbiApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(NCBI_KEY);
  } catch {
    return null;
  }
}

export async function setNcbiApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(NCBI_KEY, key);
}

export async function clearNcbiApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(NCBI_KEY);
}
