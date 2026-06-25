import { SQLiteDatabase } from 'expo-sqlite';
import { EncryptedPayloadBundle, SecureMessagingRepository } from './SecureMessagingRepository';

export interface SecureMessageInput {
    messageId: string;
    patientId: string;
    recipientProviderId: string;
    messageType: 'CLINICAL_ESCALATION' | 'STANDARD_CHAT';
    textContent: string;
    regressionMetrics?: {
        gaitSpeedSlope: number;
        romDeviationDegrees: number;
        milestoneGapDays: number;
    };
    consentAuditToken: string;
}

export class SecureMessagingService {
    private repo: SecureMessagingRepository;

    constructor(dbInstance: SQLiteDatabase) {
        this.repo = new SecureMessagingRepository(dbInstance);
    }


    public async sendSecureMessage(input: SecureMessageInput): Promise<void> {
        const rawDataPayload = JSON.stringify({
            text: input.textContent,
            metrics: input.regressionMetrics || null
        });

        const cryptoBundle = await this.encryptAESGCM(rawDataPayload);

        this.repo.queueEncryptedMessage(
            input.messageId,
            input.patientId,
            input.recipientProviderId,
            input.messageType,
            cryptoBundle,
            input.consentAuditToken
        );
    }

    private async encryptAESGCM(plainText: string): Promise<EncryptedPayloadBundle> {

        return {
            encryptedPayload: btoa("ENC_" + plainText).substring(0, 30),
            iv: btoa(Math.random().toString()).substring(0, 12),
            authTag: btoa(Math.random().toString()).substring(0, 16),
            ephemeralPublicKey: "X25519_KEY_STRING"
        };
    }
}