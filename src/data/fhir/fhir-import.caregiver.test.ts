import { normalizeActivePatient } from '@/hooks/useActivePatientView';

import type { PatientRecordSnapshot } from '../types';
import { saveFHIRBundleToDB } from './fhir-import';

jest.mock('@/store', () => ({
  store: { dispatch: jest.fn() },
}));
jest.mock('@/store/reducers/vitalsSlice', () => ({
  clearVitalsForPatient: jest.fn((payload) => ({ type: 'clearVitalsForPatient', payload })),
  hydrationFailed: jest.fn((payload) => ({ type: 'hydrationFailed', payload })),
  hydrationStarted: jest.fn((payload) => ({ type: 'hydrationStarted', payload })),
  hydrationSucceeded: jest.fn((payload) => ({ type: 'hydrationSucceeded', payload })),
}));

const mockRunSync = jest.fn();
const mockRawResources: { resourceType: string; resourceId: string; payloadJson: string }[] = [];

jest.mock('../db', () => ({
  getDatabase: () => ({
    withTransactionSync: (callback: () => void) => callback(),
    runSync: (sql: string, ...args: unknown[]) => {
      mockRunSync(sql, ...args);
      if (sql.includes('fhir_resources')) {
        mockRawResources.push({
          resourceType: String(args[0]),
          resourceId: String(args[1]),
          payloadJson: String(args[2]),
        });
      }
    },
  }),
}));

jest.mock('../repositories/carePlanRepository', () => ({
  upsertCarePlan: jest.fn(),
}));
jest.mock('../repositories/patientCareContextRepository', () => ({
  upsertPatientCareContextItem: jest.fn(),
}));
jest.mock('../repositories/patientLongitudinalObservationRepository', () => ({
  upsertPatientLongitudinalObservation: jest.fn(),
}));
jest.mock('../repositories/patientTimelineEventRepository', () => ({
  upsertPatientTimelineEvent: jest.fn(),
}));
jest.mock('../repositories/rehabilitationMeasurementRepository', () => ({
  upsertRehabilitationMeasurement: jest.fn(),
}));
jest.mock('../repositories/patientRepository', () => ({
  upsertCaregiver: jest.fn(),
}));

const { upsertCaregiver } = jest.requireMock('../repositories/patientRepository') as {
  upsertCaregiver: jest.Mock;
};
const { upsertCarePlan } = jest.requireMock('../repositories/carePlanRepository') as {
  upsertCarePlan: jest.Mock;
};

function relationshipBundle(patientId: string) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: `Patient/${patientId}`,
        resource: {
          resourceType: 'Patient',
          id: patientId,
          name: [{ given: ['Test'], family: 'Patient' }],
          contact: [
            {
              relationship: [{ text: 'Family caregiver' }],
              name: { text: 'FHIR Contact' },
              telecom: [{ system: 'phone', value: 'test-phone' }],
            },
          ],
        },
      },
      {
        fullUrl: `RelatedPerson/${patientId}-related`,
        resource: {
          resourceType: 'RelatedPerson',
          id: `${patientId}-related`,
          patient: { reference: `Patient/${patientId}` },
          relationship: [{ text: 'Caregiver' }],
          name: [{ text: 'FHIR Related Person' }],
        },
      },
    ],
  };
}

function carePlanBundle(patientId: string) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: `Patient/${patientId}`,
        resource: {
          resourceType: 'Patient',
          id: patientId,
          name: [{ given: ['Test'], family: 'Patient' }],
        },
      },
      {
        fullUrl: 'CarePlan/source-care-context',
        resource: {
          resourceType: 'CarePlan',
          id: 'source-care-context',
          status: 'active',
          intent: 'plan',
          title: 'Care Planning Context',
          description: 'Source-backed planning context from the imported record.',
          subject: { reference: `Patient/${patientId}` },
          period: { start: '2026-07-10' },
          activity: [
            {
              detail: {
                status: 'in-progress',
                description: 'Imported context activity',
              },
            },
          ],
        },
      },
    ],
  };
}

function observationBundle(patientId: string) {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: `Patient/${patientId}`,
        resource: {
          resourceType: 'Patient',
          id: patientId,
          name: [{ given: ['Test'], family: 'Patient' }],
        },
      },
      {
        fullUrl: 'Observation/heart-rate-observation',
        resource: {
          resourceType: 'Observation',
          id: 'heart-rate-observation',
          status: 'final',
          subject: { reference: `Patient/${patientId}` },
          code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] },
          valueQuantity: { value: 88, unit: 'beats/min' },
          effectiveDateTime: '2026-07-10T12:00:00.000Z',
        },
      },
    ],
  };
}

function snapshot(patientId: string, caregiver: PatientRecordSnapshot['caregiver']) {
  return {
    patient: {
      patientId,
      name: 'Test Patient',
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    caregiver,
    conditions: [],
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [],
    medicationSchedules: [],
    medicationConfirmationRequirements: {},
    thresholds: [],
    carePlans: [],
    knowledgeStats: { citationCount: 0, lastRetrievedAt: null },
    enrichmentStats: { status: 'idle', pendingCount: 0 },
    bundleStatus: { state: 'idle' },
    lastRefreshedAt: '2026-07-10T00:00:00.000Z',
  } as PatientRecordSnapshot;
}

describe('FHIR relationship import caregiver boundary', () => {
  beforeEach(() => {
    mockRunSync.mockClear();
    upsertCaregiver.mockClear();
    upsertCarePlan.mockClear();
    mockRawResources.length = 0;
  });

  it('does not create an active caregiver from Patient.contact or RelatedPerson', () => {
    const patientId = saveFHIRBundleToDB(relationshipBundle('patient-contact'));

    expect(patientId).toBe('patient-contact');
    expect(upsertCaregiver).not.toHaveBeenCalled();
    expect(
      mockRunSync.mock.calls.some((call) => String(call[0]).includes('caregivers')),
    ).toBe(false);
  });

  it('keeps raw FHIR relationship resources available in the raw-resource cache', () => {
    saveFHIRBundleToDB(relationshipBundle('patient-raw'));

    const patientResource = mockRawResources.find(
      (resource) => resource.resourceType === 'Patient' && resource.resourceId === 'patient-raw',
    );
    const relatedResource = mockRawResources.find(
      (resource) =>
        resource.resourceType === 'RelatedPerson' &&
        resource.resourceId === 'patient-raw-related',
    );

    expect(JSON.parse(patientResource?.payloadJson ?? '{}').contact).toHaveLength(1);
    expect(JSON.parse(relatedResource?.payloadJson ?? '{}').resourceType).toBe('RelatedPerson');
  });

  it('keeps valid imported CarePlan resources on the existing care-plan path', () => {
    const patientId = saveFHIRBundleToDB(carePlanBundle('patient-care-context'));

    expect(patientId).toBe('patient-care-context');
    expect(upsertCarePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'source-care-context',
        patientId: 'patient-care-context',
        title: 'Care Planning Context',
        activities: [
          expect.objectContaining({
            description: 'Imported context activity',
          }),
        ],
      }),
    );
  });

  it('persists imported baseline observations to repository-backed health samples', () => {
    const patientId = saveFHIRBundleToDB(observationBundle('patient-observations'));

    expect(patientId).toBe('patient-observations');
    expect(
      mockRunSync.mock.calls.some((call) => {
        const sql = String(call[0]);
        return (
          sql.includes('health_samples') &&
          call.includes('heart-rate-observation') &&
          call.includes('patient-observations') &&
          call.includes('heart_rate')
        );
      }),
    ).toBe(true);
  });

  it('does not expose another patient caregiver when the active snapshot has none', () => {
    const withCaregiver = normalizeActivePatient(
      snapshot('patient-with-caregiver', {
        caregiverId: 'manual-caregiver',
        patientId: 'patient-with-caregiver',
        name: 'Manual Caregiver',
        relationship: 'Family',
        createdAt: '2026-07-10T00:00:00.000Z',
      }),
      'patient-with-caregiver',
    );
    const withoutCaregiver = normalizeActivePatient(
      snapshot('patient-without-caregiver', null),
      'patient-without-caregiver',
    );

    expect(withCaregiver.caregiver?.name).toBe('Manual Caregiver');
    expect(withoutCaregiver.caregiver).toBeNull();
  });
});
