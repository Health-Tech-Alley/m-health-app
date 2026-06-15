import * as SecureStore from 'expo-secure-store';

const HF_TOKEN_KEY = 'hf_access_token';

export async function getHfToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(HF_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setHfToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(HF_TOKEN_KEY, token);
}

export async function deleteHfToken(): Promise<void> {
  await SecureStore.deleteItemAsync(HF_TOKEN_KEY);
}
