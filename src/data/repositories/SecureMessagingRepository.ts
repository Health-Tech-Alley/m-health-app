/**
 * SecureMessagingRepository — SQLite persistence for encrypted messages.
 *
 * Uses the main app database (caregiver-concierge.db) and the
 * `secure_messaging_store` table created by migrations. Messages are
 * encrypted by SecureMessagingService before being persisted.
 */
import { getDatabase } from '../db';

export interface SecureMessageRow {
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

export type InsertSecureMessageInput = Omit<
  SecureMessageRow,
  'sync_status' | 'created_at'
> & {
  sync_status?: SecureMessageRow['sync_status'];
  created_at?: number;
};

export class SecureMessagingRepository {
  static insertMessage(msg: InsertSecureMessageInput): void {
    const db = getDatabase();
    db.runSync(
      `INSERT INTO secure_messaging_store
        (message_id, patient_id, recipient_provider_id, encrypted_payload,
         iv, auth_tag, ephemeral_public_key, message_type, sync_status,
         created_at, consent_audit_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      msg.message_id,
      msg.patient_id,
      msg.recipient_provider_id,
      msg.encrypted_payload,
      msg.iv,
      msg.auth_tag,
      msg.ephemeral_public_key,
      msg.message_type,
      msg.sync_status ?? 'QUEUED',
      msg.created_at ?? Date.now(),
      msg.consent_audit_token,
    );
  }

  static getMessagesForPatient(
    patientId: string,
    recipientProviderId?: string,
  ): SecureMessageRow[] {
    const db = getDatabase();
    if (recipientProviderId) {
      return db.getAllSync<SecureMessageRow>(
        `SELECT * FROM secure_messaging_store
         WHERE patient_id = ? AND recipient_provider_id = ?
         ORDER BY created_at ASC;`,
        patientId,
        recipientProviderId,
      );
    }
    return db.getAllSync<SecureMessageRow>(
      `SELECT * FROM secure_messaging_store
       WHERE patient_id = ?
       ORDER BY created_at ASC;`,
      patientId,
    );
  }

  static getMessageById(messageId: string): SecureMessageRow | null {
    const db = getDatabase();
    return (
      db.getFirstSync<SecureMessageRow>(
        `SELECT * FROM secure_messaging_store WHERE message_id = ?;`,
        messageId,
      ) ?? null
    );
  }

  static updateSyncStatus(
    messageId: string,
    status: SecureMessageRow['sync_status'],
  ): void {
    const db = getDatabase();
    db.runSync(
      `UPDATE secure_messaging_store SET sync_status = ? WHERE message_id = ?;`,
      status,
      messageId,
    );
  }

  static deleteMessage(messageId: string): void {
    const db = getDatabase();
    db.runSync(
      `DELETE FROM secure_messaging_store WHERE message_id = ?;`,
      messageId,
    );
  }

  static countMessagesForPatient(patientId: string): number {
    const db = getDatabase();
    const row = db.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM secure_messaging_store WHERE patient_id = ?;`,
      patientId,
    );
    return row?.count ?? 0;
  }
}
