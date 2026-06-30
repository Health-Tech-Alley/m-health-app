// SecureMessagingService.ts
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export interface SignalSignalingBundle {
    ephemeralPublicKey: string;
    sequenceNumber: number;
    ciphertext: string;
    authTag: string;
}

export class SecureMessagingService {
    private static IDENTITY_KEY_ALIAS = 'com.healthcareapp.identity_private_key';

    public static async getOrCreateDeviceEnclaveIdentity(): Promise<string> {
        let privateKey = await SecureStore.getItemAsync(this.IDENTITY_KEY_ALIAS);

        if (!privateKey) {

            const rawBytes = await Crypto.getRandomBytesAsync(32);
            privateKey = Array.from(rawBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

            await SecureStore.setItemAsync(this.IDENTITY_KEY_ALIAS, privateKey, {
                keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
                requireAuthentication: false,
            });
        }
        return privateKey;
    }

    public static async encryptProductionBundle(
        plainText: string,
        recipientId: string,
        currentSequence: number
    ): Promise<SignalSignalingBundle> {
        const rootIdentity = await this.getOrCreateDeviceEnclaveIdentity();
        const ephemeralRaw = await Crypto.getRandomBytesAsync(16);
        const ephemeralPublicKey = Array.from(ephemeralRaw).map((b: number) => b.toString(16).padStart(2, '0')).join('');

        // Symmetric shared secret using sorted IDs (sender root identity + recipientId)
        const sortedIds = [rootIdentity.substring(0, 10), recipientId].sort().join('-');
        const sharedSecret = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            `${ephemeralPublicKey}-${sortedIds}`
        );

        const kdfInput = `${sharedSecret}-${currentSequence}`;
        const messageKey = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, kdfInput);

        // Convert messageKey (hex string) to 32-byte key material
        const keyBytes = new Uint8Array(messageKey.length / 2);
        for (let i = 0; i < messageKey.length; i += 2) {
            keyBytes[i / 2] = parseInt(messageKey.substring(i, i + 2), 16);
        }

        const aesKey = await crypto.subtle.importKey(
            'raw',
            keyBytes.buffer as any,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );

        // Generate a random 12-byte IV for AES-GCM
        const iv = await Crypto.getRandomBytesAsync(12);

        const plaintextBytes = new TextEncoder().encode(plainText);
        const encryptedBuffer = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as any,
                tagLength: 128
            },
            aesKey,
            plaintextBytes.buffer as any
        );

        const encryptedBytes = new Uint8Array(encryptedBuffer);
        const ciphertextBytes = encryptedBytes.slice(0, encryptedBytes.length - 16);
        const authTagBytes = encryptedBytes.slice(encryptedBytes.length - 16);

        const bytesToHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

        // Prepend the IV to the ciphertext to ensure recipient has it for decryption
        const finalCiphertext = bytesToHex(iv) + bytesToHex(ciphertextBytes);
        const finalAuthTag = bytesToHex(authTagBytes);

        return {
            ephemeralPublicKey,
            sequenceNumber: currentSequence,
            ciphertext: finalCiphertext,
            authTag: finalAuthTag
        };
    }

    public static async decryptProductionBundle(
        bundle: SignalSignalingBundle,
        senderId: string
    ): Promise<string> {
        const rootIdentity = await this.getOrCreateDeviceEnclaveIdentity();

        // Re-derive the same symmetric shared secret
        const sortedIds = [rootIdentity.substring(0, 10), senderId].sort().join('-');
        const sharedSecret = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            `${bundle.ephemeralPublicKey}-${sortedIds}`
        );

        const kdfInput = `${sharedSecret}-${bundle.sequenceNumber}`;
        const messageKey = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, kdfInput);

        const hexToBytes = (hex: string) => {
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
                bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
            }
            return bytes;
        };

        const keyBytes = hexToBytes(messageKey);
        const aesKey = await crypto.subtle.importKey(
            'raw',
            keyBytes.buffer as any,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );

        const cipherBytes = hexToBytes(bundle.ciphertext);
        const iv = cipherBytes.slice(0, 12);
        const ciphertextBytes = cipherBytes.slice(12);
        const authTagBytes = hexToBytes(bundle.authTag);

        // Combine ciphertext and auth tag for WebCrypto decrypt
        const encryptedBytes = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
        encryptedBytes.set(ciphertextBytes, 0);
        encryptedBytes.set(authTagBytes, ciphertextBytes.length);

        const decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as any,
                tagLength: 128
            },
            aesKey,
            encryptedBytes.buffer as any
        );

        return new TextDecoder().decode(decryptedBuffer);
    }
}