/**
 * SecureMessagingService — local encrypted messaging using AES-256-GCM.
 *
 * Uses expo-crypto's AESEncryptionKey for proper authenticated encryption.
 * The encryption key is generated once and stored in expo-secure-store
 * (iOS Keychain / Android Keystore). No transport layer — messages are
 * encrypted at rest locally and decrypted for display.
 *
 * Future work: real E2EE with X3DH + Double Ratchet (libsignal) + relay server.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export interface EncryptedMessageBundle {
  ciphertext: string;
  authTag: string;
  iv: string;
  sequenceNumber: number;
}

const ENCRYPTION_KEY_ALIAS = 'com.caregiverconcierge.messaging.aes_key';

export class SecureMessagingService {
  private static aesKey: Crypto.AESEncryptionKey | null = null;

  static async getOrCreateEncryptionKey(): Promise<Crypto.AESEncryptionKey> {
    if (this.aesKey) return this.aesKey;

    const storedKeyHex = await SecureStore.getItemAsync(ENCRYPTION_KEY_ALIAS);
    if (storedKeyHex) {
      this.aesKey = await Crypto.AESEncryptionKey.import(storedKeyHex, 'hex');
    } else {
      this.aesKey = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
      const keyHex = await this.aesKey.encoded('hex');
      await SecureStore.setItemAsync(ENCRYPTION_KEY_ALIAS, keyHex, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        requireAuthentication: false,
      });
    }
    return this.aesKey;
  }

  static async encryptMessage(
    plainText: string,
    sequenceNumber: number,
  ): Promise<EncryptedMessageBundle> {
    const key = await this.getOrCreateEncryptionKey();
    const plaintextBase64 = btoa(plainText);
    const sealedData = await Crypto.aesEncryptAsync(plaintextBase64, key);

    const ivBytes = await sealedData.iv('bytes');
    const ciphertextBytes = await sealedData.ciphertext({ encoding: 'bytes', includeTag: false });
    const authTagBytes = await sealedData.tag('bytes');

    const bytesToHex = (bytes: Uint8Array) =>
      Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    return {
      ciphertext: bytesToHex(ciphertextBytes),
      authTag: bytesToHex(authTagBytes),
      iv: bytesToHex(ivBytes),
      sequenceNumber,
    };
  }

  static async decryptMessage(bundle: EncryptedMessageBundle): Promise<string> {
    const key = await this.getOrCreateEncryptionKey();

    const hexToBytes = (hex: string) => {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    };

    const iv = hexToBytes(bundle.iv);
    const ciphertext = hexToBytes(bundle.ciphertext);
    const tag = hexToBytes(bundle.authTag);

    const sealedData = Crypto.AESSealedData.fromParts(iv, ciphertext, tag);
    const decryptedBase64 = await Crypto.aesDecryptAsync(sealedData, key, {
      output: 'base64',
    });

    return atob(decryptedBase64);
  }

  static async clearKey(): Promise<void> {
    this.aesKey = null;
    await SecureStore.deleteItemAsync(ENCRYPTION_KEY_ALIAS);
  }
}
