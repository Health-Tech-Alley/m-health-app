import type { Provider } from '../types';
import { getPatientRecordSnapshot } from './patientRecordRepository';

const mockProvider: Provider = {
  providerId: 'provider-a',
  patientId: 'patient-a',
  name: 'Dr. Scoped',
  phone: '(555) 010-1000',
  email: 'scoped@example.com',
  role: 'Primary care',
  isPrimary: true,
  createdAt: '2026-07-01T00:00:00.000Z',
};
const mockGetPrimaryProviderForPatient = jest.fn((patientId: string) =>
  patientId === 'patient-a' ? mockProvider : null,
);

jest.mock('../db', () => ({
  getDatabase: () => ({ getAllSync: () => [], getFirstSync: () => null, runSync: () => undefined }),
}));
jest.mock('./providerRepository', () => ({
  getPrimaryProviderForPatient: (patientId: string) => mockGetPrimaryProviderForPatient(patientId),
}));
jest.mock('./patientRepository', () => ({
  getPatient: (patientId: string) => ({
    patientId,
    name: `Patient ${patientId}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }),
  getCaregiverForPatient: () => null,
  getConditionsForPatient: () => [],
  getActiveMedications: () => [],
}));
jest.mock('./carePlanRepository', () => ({ getActiveCarePlanForPatient: () => null, getCarePlansForPatient: () => [] }));
jest.mock('./carePlanRehabMetricRepository', () => ({ getCarePlanRehabMetrics: () => [] }));
jest.mock('./dailyCareEntryRepository', () => ({ getDailyCareEntry: () => null, getDailyCareEntries: () => [] }));
jest.mock('./fhirResourceRepository', () => ({ getMedicationCandidatesForPatient: () => [] }));
jest.mock('./knowledgeCacheRepository', () => ({ getKnowledgeCacheStats: () => ({ total: 0, bySource: {} }) }));
jest.mock('./medicationConfirmationRequirementRepository', () => ({ getMedicationConfirmationRequirementsForPatient: () => ({}) }));
jest.mock('./patientCareContextRepository', () => ({ getPatientCareContextItems: () => [] }));
jest.mock('./patientEnrichmentLogRepository', () => ({ getEnrichmentStats: () => ({ total: 0, bySource: {} }) }));
jest.mock('./patientLongitudinalObservationRepository', () => ({ getPatientLongitudinalObservations: () => [] }));
jest.mock('./patientTimelineEventRepository', () => ({ getPatientTimelineEvents: () => [] }));
jest.mock('./rehabExerciseAssignmentRepository', () => ({ getRehabExerciseAssignments: () => [] }));
jest.mock('./symptomRepository', () => ({ getSymptomsForPatient: () => [] }));
jest.mock('./thresholdRepository', () => ({ getActiveThresholds: () => [] }));
jest.mock('./wearableDeviceRepository', () => ({ getPrimaryWearableForPatient: () => null }));
jest.mock('./uc3TrajectoryResultRepository', () => ({ getLatestActiveUc3TrajectoryResultSummary: () => null }));
jest.mock('./uc4PriorityRepository', () => ({
  getActiveUc4PriorityCardSummaries: () => [],
  getLatestUc4RunSummary: () => null,
  getUc4CaregiverResponses: () => [],
}));
jest.mock('./adcpRepository', () => ({
  getActiveAdcpRevisionForPatient: () => null,
  getActiveAdcpVersionSummary: () => null,
  listPendingProposalSummaries: () => [],
  planHasTherapyContract: () => false,
}));

describe('patientRecordRepository provider hydration', () => {
  beforeEach(() => mockGetPrimaryProviderForPatient.mockClear());

  it('hydrates the requested patient PCP or null', () => {
    expect(getPatientRecordSnapshot('patient-a').primaryCareProvider).toEqual(mockProvider);
    expect(mockGetPrimaryProviderForPatient).toHaveBeenCalledWith('patient-a');

    expect(getPatientRecordSnapshot('patient-empty').primaryCareProvider).toBeNull();
    expect(mockGetPrimaryProviderForPatient).toHaveBeenCalledWith('patient-empty');
  });
});
