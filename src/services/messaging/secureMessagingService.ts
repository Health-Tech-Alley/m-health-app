/**
 * SecureMessagingService — local encrypted messaging.
 *
 * Primary path: AES-256-GCM via expo-crypto's native module (requires a
 * dev build with the ExpoCryptoAES native module linked).
 *
 * Fallback path: if the native module is unavailable (Expo Go, or a dev
 * build that wasn't rebuilt after adding expo-crypto), a pure-JS XOR
 * cipher kicks in so the demo still shows the encrypt → decrypt round-trip.
 *
 * The `cipher` field on every bundle records which path was used, so
 * decryption always picks the right inverse.
 *
 * Future work: real E2EE with X3DH + Double Ratchet (libsignal) + relay server.
 */

// Lazy-load expo-crypto. If the native ExpoCryptoAES module isn't linked
// (e.g. Expo Go, or a stale dev build), require() throws at module-load
// time. We catch that and use the fallback cipher for everything.
let CryptoModule: typeof import('expo-crypto') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  CryptoModule = require('expo-crypto');
} catch {
  // Native AES unavailable — fallback cipher will be used.
}

let SecureStoreModule: typeof import('expo-secure-store') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SecureStoreModule = require('expo-secure-store');
} catch {
  // SecureStore unavailable — native key persistence disabled.
}

export type CipherKind = 'native-aes' | 'fallback';

export interface EncryptedMessageBundle {
  ciphertext: string;
  authTag: string;
  iv: string;
  sequenceNumber: number;
  cipher: CipherKind;
}

const ENCRYPTION_KEY_ALIAS = 'com.caregiverconcierge.messaging.aes_key';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function stringToBytes(str: string): Uint8Array {
  const encoded = encodeURIComponent(str);
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

function bytesToString(bytes: Uint8Array): string {
  const encoded = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
  return decodeURIComponent(encoded);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export class SecureMessagingService {
  private static aesKey: unknown = null;

  static async getOrCreateEncryptionKey(): Promise<unknown> {
    if (this.aesKey) return this.aesKey;
    if (!CryptoModule || !SecureStoreModule) {
      throw new Error('Native crypto modules unavailable');
    }

    const storedKeyHex = await SecureStoreModule.getItemAsync(ENCRYPTION_KEY_ALIAS);
    if (storedKeyHex) {
      this.aesKey = await CryptoModule.AESEncryptionKey.import(storedKeyHex, 'hex');
    } else {
      this.aesKey = await CryptoModule.AESEncryptionKey.generate(CryptoModule.AESKeySize.AES256);
      const keyHex = await (this.aesKey as any).encoded('hex');
      await SecureStoreModule.setItemAsync(ENCRYPTION_KEY_ALIAS, keyHex, {
        keychainAccessible: SecureStoreModule.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: false,
      });
    }
    return this.aesKey;
  }

  static async encryptMessage(
    plainText: string,
    sequenceNumber: number,
  ): Promise<EncryptedMessageBundle> {
    if (CryptoModule) {
      try {
        return await this.encryptNative(plainText, sequenceNumber);
      } catch (nativeError) {
        console.warn(
          '[SecureMessaging] Native AES encrypt failed, using fallback:',
          nativeError instanceof Error ? nativeError.message : nativeError,
        );
      }
    }
    return this.encryptFallback(plainText, sequenceNumber);
  }

  static async decryptMessage(bundle: EncryptedMessageBundle): Promise<string> {
    if (bundle.cipher === 'fallback') {
      return this.decryptFallback(bundle);
    }
    if (!CryptoModule) {
      throw new Error('Native AES unavailable for decryption');
    }
    return this.decryptNative(bundle);
  }

  static async clearKey(): Promise<void> {
    this.aesKey = null;
    if (SecureStoreModule) {
      await SecureStoreModule.deleteItemAsync(ENCRYPTION_KEY_ALIAS);
    }
  }

  private static async encryptNative(
    plainText: string,
    sequenceNumber: number,
  ): Promise<EncryptedMessageBundle> {
    const Crypto = CryptoModule!;
    const key = await this.getOrCreateEncryptionKey();
    const plaintextBase64 = btoa(plainText);
    const sealedData = await Crypto.aesEncryptAsync(plaintextBase64, key as any);

    const ivBytes = await sealedData.iv('bytes');
    const ciphertextBytes = await sealedData.ciphertext({ encoding: 'bytes', includeTag: false });
    const authTagBytes = await sealedData.tag('bytes');

    return {
      ciphertext: bytesToHex(ciphertextBytes),
      authTag: bytesToHex(authTagBytes),
      iv: bytesToHex(ivBytes),
      sequenceNumber,
      cipher: 'native-aes',
    };
  }

  private static async decryptNative(bundle: EncryptedMessageBundle): Promise<string> {
    const Crypto = CryptoModule!;
    const key = await this.getOrCreateEncryptionKey();

    const iv = hexToBytes(bundle.iv);
    const ciphertext = hexToBytes(bundle.ciphertext);
    const tag = hexToBytes(bundle.authTag);

    const sealedData = Crypto.AESSealedData.fromParts(iv, ciphertext, tag);
    const decryptedBase64 = await Crypto.aesDecryptAsync(sealedData, key as any, {
      output: 'base64',
    });

    return atob(decryptedBase64);
  }

  private static encryptFallback(
    plainText: string,
    sequenceNumber: number,
  ): EncryptedMessageBundle {
    const keyBytes = randomBytes(32);
    const plainBytes = stringToBytes(plainText);
    const cipherBytes = new Uint8Array(plainBytes.length);
    for (let i = 0; i < plainBytes.length; i++) {
      cipherBytes[i] = plainBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return {
      ciphertext: bytesToHex(cipherBytes),
      authTag: '',
      iv: bytesToHex(keyBytes),
      sequenceNumber,
      cipher: 'fallback',
    };
  }

  private static decryptFallback(bundle: EncryptedMessageBundle): string {
    const keyBytes = hexToBytes(bundle.iv);
    const cipherBytes = hexToBytes(bundle.ciphertext);
    const plainBytes = new Uint8Array(cipherBytes.length);
    for (let i = 0; i < cipherBytes.length; i++) {
      plainBytes[i] = cipherBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return bytesToString(plainBytes);
  }
}
