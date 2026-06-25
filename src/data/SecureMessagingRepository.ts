import { SQLiteDatabase } from 'expo-sqlite';

export interface EncryptedPayloadBundle {
    encryptedPayload: string;
    iv: string;
    authTag: string;
    ephemeralPublicKey: string;
}

export interface StagedMessageRow {
    message_id: string;
    patient_id: string;
    recipient_provider_id: string;
    encrypted_payload: string;
    iv: string;
    auth_tag: string;
    ephemeral_public_key: string;
    message_type: 'CLINICAL_ESCALATION' | 'STANDARD_CHAT';
    sync_status: 'QUEUED' | 'SENDING' | 'SYNCED';
    created_at: number;
    consent_audit_token: string;
}

export class SecureMessagingRepository {
    private db: SQLiteDatabase;

    constructor(dbInstance: SQLiteDatabase) {
        this.db = dbInstance;
    }

    public queueEncryptedMessage(
        messageId: string,
        patientId: string,
        recipientProviderId: string,
        messageType: 'CLINICAL_ESCALATION' | 'STANDARD_CHAT',
        cryptoBundle: EncryptedPayloadBundle,
        consentAuditToken: string
    ): void {
        const query = `
      INSERT INTO secure_messaging_store (
        message_id, patient_id, recipient_provider_id, message_type,
        encrypted_payload, iv, auth_tag, ephemeral_public_key, 
        sync_status, created_at, consent_audit_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?);
    `;

        this.db.runSync(query, [
            messageId,
            patientId,
            recipientProviderId,
            messageType,
            cryptoBundle.encryptedPayload,
            cryptoBundle.iv,
            cryptoBundle.authTag,
            cryptoBundle.ephemeralPublicKey,
            Date.now(),
            consentAuditToken
        ]);
    }

    public getPendingOfflineMessages(): StagedMessageRow[] {
        const query = `
      SELECT * FROM secure_messaging_store 
      WHERE sync_status = 'QUEUED' 
      ORDER BY created_at ASC;
    `;
        return this.db.getAllSync<StagedMessageRow>(query);
    }

    public markAsSynced(messageId: string): void {
        const query = `
      UPDATE secure_messaging_store 
      SET sync_status = 'SYNCED' 
      WHERE message_id = ?;
    `;
        this.db.runSync(query, [messageId]);
    }
}