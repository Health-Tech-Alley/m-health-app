import { getDatabase } from '../db';
import type { Provider } from '../types';

type ProviderRow = Omit<Provider, 'isPrimary'> & { isPrimary: number | boolean };

const PROVIDER_COLUMNS =
  `provider_id AS providerId, patient_id AS patientId, name, phone, email, role,
   is_primary AS isPrimary, created_at AS createdAt`;

export type UpsertPrimaryProviderInput = Pick<Provider, 'patientId' | 'name'> &
  Partial<Pick<Provider, 'providerId' | 'phone' | 'email' | 'role'>>;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

function requirePatientId(patientId: string): string {
  const normalized = patientId.trim();
  if (!normalized) {
    throw new Error('patientId is required for provider operations.');
  }
  return normalized;
}

function mapProvider(row: ProviderRow): Provider {
  return {
    ...row,
    isPrimary: Boolean(row.isPrimary),
  };
}

function getProviderById(providerId: string): Provider | null {
  const db = getDatabase();
  const row = db.getFirstSync<ProviderRow>(
    `SELECT ${PROVIDER_COLUMNS} FROM providers WHERE provider_id = ? LIMIT 1;`,
    providerId,
  );
  return row ? mapProvider(row) : null;
}

export function getProvidersForPatient(patientId: string): Provider[] {
  const db = getDatabase();
  const scopedPatientId = requirePatientId(patientId);
  return db
    .getAllSync<ProviderRow>(
      `SELECT ${PROVIDER_COLUMNS}
       FROM providers WHERE patient_id = ?
       ORDER BY is_primary DESC, created_at DESC, provider_id DESC;`,
      scopedPatientId,
    )
    .map(mapProvider);
}

export function getPrimaryProviderForPatient(patientId: string): Provider | null {
  const db = getDatabase();
  const scopedPatientId = requirePatientId(patientId);
  const row = db.getFirstSync<ProviderRow>(
    `SELECT ${PROVIDER_COLUMNS}
     FROM providers WHERE patient_id = ?
     ORDER BY is_primary DESC, created_at DESC, provider_id DESC
     LIMIT 1;`,
    scopedPatientId,
  );
  return row ? mapProvider(row) : null;
}

export function setPrimaryProviderForPatient(
  input: UpsertPrimaryProviderInput,
): Provider {
  const patientId = requirePatientId(input.patientId);
  const name = input.name.trim();
  if (!name) {
    throw new Error('Provider name is required.');
  }

  const existing = input.providerId
    ? getProviderById(input.providerId)
    : getPrimaryProviderForPatient(patientId);
  if (existing && existing.patientId !== patientId) {
    throw new Error('Cannot update a provider that belongs to another patient.');
  }

  const db = getDatabase();
  const providerId = existing?.providerId ?? input.providerId ?? makeId('provider');
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const next: Provider = {
    providerId,
    patientId,
    name,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    role: input.role?.trim() || null,
    isPrimary: true,
    createdAt,
  };

  db.withTransactionSync(() => {
    db.runSync(`UPDATE providers SET is_primary = 0 WHERE patient_id = ?;`, patientId);
    db.runSync(
      `INSERT INTO providers
        (provider_id, patient_id, name, phone, email, role, is_primary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(provider_id) DO UPDATE SET
         patient_id = excluded.patient_id,
         name = excluded.name,
         phone = excluded.phone,
         email = excluded.email,
         role = excluded.role,
         is_primary = 1;`,
      next.providerId,
      next.patientId,
      next.name,
      next.phone ?? null,
      next.email ?? null,
      next.role ?? null,
      next.createdAt,
    );
  });

  return next;
}

export function clearPrimaryProviderForPatient(patientId: string): void {
  const db = getDatabase();
  db.runSync(`UPDATE providers SET is_primary = 0 WHERE patient_id = ?;`, requirePatientId(patientId));
}
