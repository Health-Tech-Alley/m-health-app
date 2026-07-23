import * as SecureStore from 'expo-secure-store';

const OPENFDA_KEY = 'openfda_api_key';

/**
 * OpenFDA API key — optional. Without a key the API allows 240 requests/min
 * per IP (120k/day); with a key the limits are higher. See
 * https://open.fda.gov/authentication/.
 */
export async function getOpenFdaApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(OPENFDA_KEY);
  } catch {
    return null;
  }
}

export async function setOpenFdaApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(OPENFDA_KEY, key);
}

export async function clearOpenFdaApiKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(OPENFDA_KEY);
  } catch {
    // already absent
  }
}
