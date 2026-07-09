import { SecureMessagingRepository } from '@/data';
import { SecureMessagingService } from '@/data/SecureMessagingService';
import type { SecureMessage } from '@/features/messaging/types';

const DEMO_PATIENT_ID = 'demo-patient-001';
const DEMO_PROVIDER_ID = 'provider-martinez';

export async function seedDemoMessages(): Promise<{ rowCount: number; count: number }> {
  const seeds = [
    { text: "Elena's SpO2 has been stable at 96% today.", type: 'STANDARD_CHAT' as const },
    { text: 'Reminder: increase PEP therapy to 15 min BID per Dr. Patel.', type: 'STANDARD_CHAT' as const },
    {
      text: 'URGENT: Elena had a coughing episode at 2pm, lasted 8 min. SpO2 dipped to 91%, recovered to 96% with O2.',
      type: 'CLINICAL_ESCALATION' as const,
    },
  ];

  for (let i = 0; i < seeds.length; i++) {
    const seq = Date.now() + i;
    const encrypted = await SecureMessagingService.encryptMessage(seeds[i].text, seq);
    SecureMessagingRepository.insertMessage({
      message_id: `demo-seed-${seq}`,
      patient_id: DEMO_PATIENT_ID,
      recipient_provider_id: DEMO_PROVIDER_ID,
      encrypted_payload: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      ephemeral_public_key: '',
      message_type: seeds[i].type,
      consent_audit_token: 'demo-consent-token',
    });
  }

  return { rowCount: SecureMessagingRepository.countMessagesForPatient(DEMO_PATIENT_ID), count: seeds.length };
}

export async function encryptAndStore(plaintext: string): Promise<{
  ciphertext: string;
  iv: string;
  authTag: string;
  rowCount: number;
}> {
  const seq = Date.now();
  const encrypted = await SecureMessagingService.encryptMessage(plaintext, seq);
  SecureMessagingRepository.insertMessage({
    message_id: `demo-msg-${seq}`,
    patient_id: DEMO_PATIENT_ID,
    recipient_provider_id: DEMO_PROVIDER_ID,
    encrypted_payload: encrypted.ciphertext,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
    ephemeral_public_key: '',
    message_type: 'STANDARD_CHAT',
    consent_audit_token: 'demo-consent-token',
  });
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    rowCount: SecureMessagingRepository.countMessagesForPatient(DEMO_PATIENT_ID),
  };
}

export async function loadAndDecryptAll(): Promise<{ messages: SecureMessage[]; rowCount: number }> {
  const rows = SecureMessagingRepository.getMessagesForPatient(DEMO_PATIENT_ID);
  const messages: SecureMessage[] = [];
  for (const row of rows) {
    try {
      const text = await SecureMessagingService.decryptMessage({
        ciphertext: row.encrypted_payload,
        authTag: row.auth_tag,
        iv: row.iv,
        sequenceNumber: row.created_at,
        cipher: row.ephemeral_public_key === 'fallback' ? 'fallback' : 'native-aes',
      });
      messages.push({
        messageId: row.message_id,
        conversationId: row.recipient_provider_id,
        senderId: row.patient_id,
        body: text,
        createdAt: new Date(row.created_at).toISOString(),
        direction: 'outgoing',
        deliveryState: 'delivered',
      });
    } catch {
      // skip corrupt rows
    }
  }
  return { messages, rowCount: rows.length };
}

export function resetDemoData(): number {
  const rows = SecureMessagingRepository.getMessagesForPatient(DEMO_PATIENT_ID);
  for (const row of rows) {
    SecureMessagingRepository.deleteMessage(row.message_id);
  }
  return 0;
}
