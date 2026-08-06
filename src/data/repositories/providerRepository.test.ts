import { MIGRATIONS } from '../migrations';
import { clearPrimaryProviderForPatient, getPrimaryProviderForPatient, getProvidersForPatient, setPrimaryProviderForPatient } from './providerRepository';

type DbRow = {
  provider_id: string; patient_id: string; name: string; phone: string | null;
  email: string | null; role: string | null; is_primary: number; created_at: string;
};

const rows: DbRow[] = [];
const iso = (day: number) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const row = (provider_id: string, patient_id: string, day: number, is_primary = 0): DbRow => ({
  provider_id,
  patient_id,
  name: `Dr. ${provider_id}`,
  phone: null,
  email: null,
  role: 'Primary care',
  is_primary,
  created_at: iso(day),
});
const map = (r: DbRow) => ({
  providerId: r.provider_id, patientId: r.patient_id, name: r.name,
  phone: r.phone, email: r.email, role: r.role, isPrimary: r.is_primary,
  createdAt: r.created_at,
});
const sorted = (patientId: unknown) =>
  rows
    .filter((r) => r.patient_id === patientId)
    .sort((a, b) => b.is_primary - a.is_primary || b.created_at.localeCompare(a.created_at));

const mockDb = {
  withTransactionSync: jest.fn((fn: () => void) => fn()),
  runSync: jest.fn((sql: string, ...args: unknown[]) => {
    if (/UPDATE providers SET is_primary = 0/.test(sql)) {
      rows.forEach((r) => {
        if (r.patient_id === args[0]) r.is_primary = 0;
      });
    }
    if (/INSERT INTO providers/.test(sql)) {
      const [providerId, patientId, name, phone, email, role, createdAt] = args;
      const i = rows.findIndex((r) => r.provider_id === providerId);
      const next = {
        provider_id: String(providerId),
        patient_id: String(patientId),
        name: String(name),
        phone: phone ? String(phone) : null,
        email: email ? String(email) : null,
        role: role ? String(role) : null,
        is_primary: 1,
        created_at: String(createdAt),
      };
      if (i >= 0) rows[i] = { ...rows[i], ...next, created_at: rows[i].created_at };
      else rows.push(next);
    }
  }),
  getFirstSync: jest.fn((sql: string, ...args: unknown[]) => {
    const found = /WHERE provider_id = \?/.test(sql)
      ? rows.find((r) => r.provider_id === args[0])
      : sorted(args[0])[0];
    return found ? map(found) : null;
  }),
  getAllSync: jest.fn((_sql: string, ...args: unknown[]) => sorted(args[0]).map(map)),
};

jest.mock('../db', () => ({ getDatabase: () => mockDb }));

describe('providerRepository', () => {
  beforeEach(() => {
    rows.length = 0;
    jest.clearAllMocks();
  });

  it('isolates provider reads by patient id', () => {
    rows.push(row('a', 'patient-a', 1), row('b', 'patient-b', 2, 1));

    expect(getProvidersForPatient('patient-a')).toEqual([
      expect.objectContaining({ providerId: 'a', patientId: 'patient-a' }),
    ]);
  });

  it('resolves explicit primary first, then newest existing row, then null', () => {
    rows.push(row('old-primary', 'patient-a', 1, 1), row('new-fallback', 'patient-a', 3));
    expect(getPrimaryProviderForPatient('patient-a')).toEqual(
      expect.objectContaining({ providerId: 'old-primary', isPrimary: true }),
    );

    rows.length = 0;
    rows.push(row('older', 'patient-a', 1), row('newer', 'patient-a', 4));
    expect(getPrimaryProviderForPatient('patient-a')).toEqual(
      expect.objectContaining({ providerId: 'newer', isPrimary: false }),
    );
    expect(getPrimaryProviderForPatient('patient-empty')).toBeNull();
  });

  it('sets and clears primary flags only for the requested patient', () => {
    rows.push(row('a-old', 'patient-a', 1, 1), row('a-next', 'patient-a', 2), row('b-primary', 'patient-b', 3, 1));

    setPrimaryProviderForPatient({
      patientId: 'patient-a',
      providerId: 'a-next',
      name: 'Dr. Next',
    });

    expect(mockDb.withTransactionSync).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.provider_id === 'a-old')?.is_primary).toBe(0);
    expect(rows.find((r) => r.provider_id === 'a-next')?.is_primary).toBe(1);
    expect(rows.find((r) => r.provider_id === 'b-primary')?.is_primary).toBe(1);

    clearPrimaryProviderForPatient('patient-a');
    expect(rows.find((r) => r.provider_id === 'a-next')?.is_primary).toBe(0);
    expect(rows.find((r) => r.provider_id === 'b-primary')?.is_primary).toBe(1);
  });

  it('adds the primary marker idempotently without rewriting existing rows', () => {
    const migration = MIGRATIONS.find(
      (candidate) =>
        typeof candidate === 'function' &&
        candidate
          .toString()
          .includes('ALTER TABLE providers ADD COLUMN is_primary'),
    );
    const execSync = jest.fn();
    expect(typeof migration).toBe('function');
    if (typeof migration === 'function') {
      migration({ getAllSync: () => [{ name: 'provider_id' }], execSync } as never);
    }
    expect(execSync).toHaveBeenCalledWith(
      'ALTER TABLE providers ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;',
    );

    execSync.mockClear();
    if (typeof migration === 'function') {
      migration({ getAllSync: () => [{ name: 'is_primary' }], execSync } as never);
    }
    expect(execSync).not.toHaveBeenCalled();
  });
});
