import * as SecureStore from 'expo-secure-store';

const UMLS_KEY = 'umls_api_key';

export async function getUmlsApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(UMLS_KEY);
  } catch {
    return null;
  }
}

export async function setUmlsApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(UMLS_KEY, key);
}

export async function clearUmlsApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(UMLS_KEY);
}
