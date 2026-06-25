import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('secure_messaging_prod.db');

export interface LocalProductionMessage {
    message_id: string;
    recipient_id: string;
    ephemeral_public_key: string;
    sequence_number: number;
    ciphertext: string;
    auth_tag: string;
    sync_status: 'QUEUED' | 'SYNCED' | 'FAILED';
    created_at: number;
}

export class SecureMessagingRepository {
    public static initDatabase(): void {
        db.execSync(`
      CREATE TABLE IF NOT EXISTS production_messaging_store (
        message_id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        ephemeral_public_key TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        ciphertext TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        sync_status TEXT DEFAULT 'QUEUED',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secure_messaging_sequences (
        recipient_id TEXT PRIMARY KEY,
        last_sequence_number INTEGER NOT NULL DEFAULT 0
      );
    `);
    }

    public static queueSecureMessage(msg: Omit<LocalProductionMessage, 'sync_status' | 'created_at'>): void {
        db.runSync(
            `INSERT INTO production_messaging_store (message_id, recipient_id, ephemeral_public_key, sequence_number, ciphertext, auth_tag, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?);`,
            [msg.message_id, msg.recipient_id, msg.ephemeral_public_key, msg.sequence_number, msg.ciphertext, msg.auth_tag, Date.now()]
        );
    }

    public static getPendingQueue(): LocalProductionMessage[] {
        return db.getAllSync<LocalProductionMessage>(
            `SELECT * FROM production_messaging_store WHERE sync_status = 'QUEUED' ORDER BY sequence_number ASC;`
        );
    }

    public static markAsSynced(messageId: string): void {
        db.runSync(`UPDATE production_messaging_store SET sync_status = 'SYNCED' WHERE message_id = ?;`, [messageId]);
    }

    public static getNextSequenceNumber(recipientId: string): number {
        db.runSync(
            `INSERT OR IGNORE INTO secure_messaging_sequences (recipient_id, last_sequence_number) VALUES (?, 0);`,
            [recipientId]
        );
        db.runSync(
            `UPDATE secure_messaging_sequences SET last_sequence_number = last_sequence_number + 1 WHERE recipient_id = ?;`,
            [recipientId]
        );
        const result = db.getFirstSync<{ last_sequence_number: number }>(
            `SELECT last_sequence_number FROM secure_messaging_sequences WHERE recipient_id = ?;`,
            [recipientId]
        );
        return result ? result.last_sequence_number : 1;
    }
}