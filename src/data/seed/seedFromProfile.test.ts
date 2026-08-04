import type { PatientRecordSnapshot } from '../types';

import {
  getPatientRecordSnapshot,
} from '../repositories/patientRecordRepository';
import {
  getRehabExerciseAssignments,
  replaceRehabExerciseAssignments,
} from '../repositories/rehabExerciseAssignmentRepository';
import { seedDefaultUc3ExerciseAssignments } from './seedFromProfile';

jest.mock('../db', () => ({
  getDatabase: jest.fn(() => ({
    getAllSync: jest.fn(() => []),
    getFirstSync: jest.fn(() => null),
    runSync: jest.fn(),
    withTransactionSync: jest.fn((fn: () => void) => fn()),
  })),
}));

jest.mock('../repositories/patientRecordRepository', () => ({
  getPatientRecordSnapshot: jest.fn(),
}));

jest.mock('../repositories/rehabExerciseAssignmentRepository', () => ({
  getRehabExerciseAssignments: jest.fn(),
  replaceRehabExerciseAssignments: jest.fn(),
}));

const mockSnapshot = getPatientRecordSnapshot as jest.Mock;
const mockGetAssignments = getRehabExerciseAssignments as jest.Mock;
const mockReplaceAssignments = replaceRehabExerciseAssignments as jest.Mock;

function strokeSnapshot(
  overrides: Partial<PatientRecordSnapshot> = {},
): PatientRecordSnapshot {
  return {
    patient: {
      patientId: 'james-patient',
      name: 'James',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    safetyNotes: '',
    caregiver: null,
    conditions: [
      {
        conditionId: 'c1',
        patientId: 'james-patient',
        name: 'Cerebrovascular accident',
        snomedCode: '230690007',
        conditionRole: 'primary_diagnosis',
      },
    ],
    comorbidities: [],
    primaryCondition: null,
    pendingReviewConditions: [],
    symptoms: [],
    wearable: null,
    medications: [],
    medicationCandidates: [],
    medicationConfirmationRequirements: {},
    functionalObservations: [],
    thresholds: [],
    carePlan: {
      planId: 'careplan-james-post-stroke-rehab',
      patientId: 'james-patient',
      version: 1,
      effectiveDate: '2026-01-01',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      activities: [],
    },
    carePlans: [],
    rehabPlanMetrics: [],
    rehabExerciseAssignments: [],
    todayDailyCareEntry: null,
    rehabDailyEntries: [],
    latestUc3TrajectoryResult: null,
    latestUc4Run: null,
    latestUc4PriorityCards: [],
    recentUc4CaregiverResponses: [],
    careContextItems: [],
    timelineEvents: [],
    carePlanGoals: [],
    knowledgeStats: { total: 0, bySource: {} },
    enrichmentStats: { total: 0, bySource: {} },
    bundlePending: false,
    bundleStatus: { state: 'complete', chunksAdded: 0 },
    activeAdcpVersion: null,
    pendingPlanProposals: [],
    therapyContractPresent: true,
    lastRefreshedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as PatientRecordSnapshot;
}

describe('seedDefaultUc3ExerciseAssignments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('seeds all standard exercises for a UC3-eligible stroke patient with no assignments', () => {
    mockSnapshot.mockReturnValue(strokeSnapshot());
    mockGetAssignments.mockReturnValue([]);

    seedDefaultUc3ExerciseAssignments('james-patient');

    expect(mockReplaceAssignments).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'james-patient',
        carePlanId: 'careplan-james-post-stroke-rehab',
        exerciseKeys: expect.arrayContaining([
          'supported_arm_reach',
          'grasp_release',
          'sit_to_stand',
          'supported_weight_shift',
          'assisted_walking',
        ]),
      }),
    );
  });

  it('does not duplicate when assignments already exist', () => {
    mockSnapshot.mockReturnValue(strokeSnapshot());
    mockGetAssignments.mockReturnValue([
      {
        patientId: 'james-patient',
        carePlanId: 'careplan-james-post-stroke-rehab',
        exerciseKey: 'sit_to_stand',
        active: true,
        source: 'developer_uc3_v2',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    seedDefaultUc3ExerciseAssignments('james-patient');

    expect(mockReplaceAssignments).not.toHaveBeenCalled();
  });

  it('does not seed without an active care plan', () => {
    mockSnapshot.mockReturnValue(strokeSnapshot({ carePlan: null }));

    seedDefaultUc3ExerciseAssignments('james-patient');

    expect(mockReplaceAssignments).not.toHaveBeenCalled();
  });

  it('does not seed non-UC3 patients (no stroke rehab SNOMED)', () => {
    mockSnapshot.mockReturnValue(
      strokeSnapshot({
        conditions: [
          {
            conditionId: 'c2',
            patientId: 'james-patient',
            name: 'COPD',
            snomedCode: '13645005',
            conditionRole: 'primary_diagnosis',
          },
        ],
      }),
    );
    mockGetAssignments.mockReturnValue([]);

    seedDefaultUc3ExerciseAssignments('james-patient');

    expect(mockReplaceAssignments).not.toHaveBeenCalled();
  });

  it('does not throw when the snapshot read fails', () => {
    mockSnapshot.mockImplementation(() => {
      throw new Error('db unavailable');
    });

    expect(() => seedDefaultUc3ExerciseAssignments('james-patient')).not.toThrow();
    expect(mockReplaceAssignments).not.toHaveBeenCalled();
  });
});
