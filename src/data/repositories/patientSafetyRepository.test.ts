import { MIGRATIONS } from '../migrations';
import {
  getPatientSafetyProfileForPatient,
  upsertPatientSafetyProfileForPatient,
} from './patientSafetyRepository';
import { replacePatientSafetyNotesForPatient } from './patientRepository';

type SafetyRow = {
  patientId: string;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  emergencyInstructions: string | null;
  emergencyDisclaimerAccepted: number | null;
  updatedAt: string;
};

const rows = new Map<string, SafetyRow>();
const patientRows = new Map<
  string,
  {
    patientId: string;
    name: string;
    safetyNotes: string | null;
    createdAt: string;
    updatedAt: string;
  }
>();

const mockDb = {
  getFirstSync: jest.fn((sql: string, patientId: string) => {
    if (sql.includes('FROM patients WHERE patient_id')) {
      return patientRows.get(patientId) ?? null;
    }
    return rows.get(patientId) ?? null;
  }),
  runSync: jest.fn((_sql: string, ...args: unknown[]) => {
    if (_sql.includes('UPDATE patients SET safety_notes')) {
      const [safetyNotes, updatedAt, patientId] = args;
      const existing = patientRows.get(String(patientId));
      if (existing) {
        patientRows.set(String(patientId), {
          ...existing,
          safetyNotes: safetyNotes === null ? null : String(safetyNotes),
          updatedAt: String(updatedAt),
        });
      }
      return;
    }

    const [
      patientId,
      emergencyContactName,
      emergencyContactRelationship,
      emergencyContactPhone,
      emergencyInstructions,
      emergencyDisclaimerAccepted,
      updatedAt,
    ] = args;
    rows.set(String(patientId), {
      patientId: String(patientId),
      emergencyContactName: emergencyContactName ? String(emergencyContactName) : null,
      emergencyContactRelationship: emergencyContactRelationship
        ? String(emergencyContactRelationship)
        : null,
      emergencyContactPhone: emergencyContactPhone ? String(emergencyContactPhone) : null,
      emergencyInstructions: emergencyInstructions ? String(emergencyInstructions) : null,
      emergencyDisclaimerAccepted:
        emergencyDisclaimerAccepted === null ? null : Number(emergencyDisclaimerAccepted),
      updatedAt: String(updatedAt),
    });
  }),
};

jest.mock('../db', () => ({ getDatabase: () => mockDb }));

describe('patientSafetyRepository', () => {
  beforeEach(() => {
    rows.clear();
    patientRows.clear();
    jest.clearAllMocks();
  });

  it('creates the patient safety profile table after the provider migration', () => {
    const migration = MIGRATIONS.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.includes('patient_safety_profiles'),
    );

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS patient_safety_profiles');
    expect(migration).toContain('patient_id TEXT PRIMARY KEY');
    expect(migration).toContain('emergency_disclaimer_accepted INTEGER');
  });

  it('isolates safety profile reads by patient id', () => {
    rows.set('patient-a', {
      patientId: 'patient-a',
      emergencyContactName: 'A Contact',
      emergencyContactRelationship: null,
      emergencyContactPhone: null,
      emergencyInstructions: null,
      emergencyDisclaimerAccepted: 1,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });

    expect(getPatientSafetyProfileForPatient('patient-a')).toEqual(
      expect.objectContaining({
        patientId: 'patient-a',
        emergencyContactName: 'A Contact',
        emergencyDisclaimerAccepted: true,
      }),
    );
    expect(getPatientSafetyProfileForPatient('patient-b')).toBeNull();
  });

  it('preserves omitted fields and supports explicit clearing', () => {
    const first = upsertPatientSafetyProfileForPatient({
      patientId: 'patient-a',
      emergencyContactName: 'Maria',
      emergencyContactPhone: '(555) 010-1000',
      emergencyDisclaimerAccepted: true,
    });

    expect(first).toEqual(
      expect.objectContaining({
        emergencyContactName: 'Maria',
        emergencyContactPhone: '(555) 010-1000',
        emergencyDisclaimerAccepted: true,
      }),
    );

    const second = upsertPatientSafetyProfileForPatient({
      patientId: 'patient-a',
      emergencyContactPhone: '',
      emergencyDisclaimerAccepted: false,
    });

    expect(second.emergencyContactName).toBe('Maria');
    expect(second.emergencyContactPhone).toBeNull();
    expect(second.emergencyDisclaimerAccepted).toBe(false);

    const third = upsertPatientSafetyProfileForPatient({
      patientId: 'patient-a',
      emergencyDisclaimerAccepted: null,
    });

    expect(third.emergencyDisclaimerAccepted).toBeNull();
  });

  it('replaces and clears patient-wide safety notes explicitly', () => {
    patientRows.set('patient-a', {
      patientId: 'patient-a',
      name: 'Patient A',
      safetyNotes: 'Existing note',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });

    const replaced = replacePatientSafetyNotesForPatient(
      'patient-a',
      ' Updated note ',
    );

    expect(replaced.safetyNotes).toBe('Updated note');
    expect(patientRows.get('patient-a')?.safetyNotes).toBe('Updated note');

    const cleared = replacePatientSafetyNotesForPatient('patient-a', '');

    expect(cleared.safetyNotes).toBeNull();
    expect(patientRows.get('patient-a')?.safetyNotes).toBeNull();
  });
});
