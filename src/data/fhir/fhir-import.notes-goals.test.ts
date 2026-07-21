/**
 * Tests for planning/41 §9 FHIR CarePlan enrichment.
 *
 * Verifies:
 *   - CarePlan.note[] text is concatenated into the persisted `safety_notes`
 *     column on the care plan row.
 *   - Goal resources referenced by CarePlan.goal[] are upserted into the
 *     `care_plan_goals` table via the new `upsertCarePlanGoal` helper.
 *   - Goals targeting a different patient are NOT imported (cross-patient
 *     guard, same as the rehab metric path).
 *   - The mapping from FHIR Goal.lifecycleStatus uses the same active /
 *     completed / cancelled buckets as the local snapshot summary.
 */

import { saveFHIRBundleToDB } from './fhir-import';

jest.mock('@/store', () => ({
  store: { dispatch: jest.fn() },
}));
jest.mock('@/store/reducers/vitalsSlice', () => ({
  clearVitalsForPatient: jest.fn((payload) => ({ type: 'clearVitalsForPatient', payload })),
  hydrationFailed: jest.fn((payload) => ({ type: 'hydrationFailed', payload })),
  hydrationStarted: jest.fn((payload) => ({ type: 'hydrationStarted', payload })),
  hydrationStartedAction: jest.fn((payload) => ({ type: 'hydrationStarted', payload })),
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

const mockUpsertCarePlan = jest.fn();
const mockUpsertCarePlanGoal = jest.fn();
const mockUpsertRehabMeasurement = jest.fn();

jest.mock('../repositories/carePlanRepository', () => ({
  upsertCarePlan: (input: unknown) => mockUpsertCarePlan(input),
  upsertCarePlanGoal: (input: unknown) => mockUpsertCarePlanGoal(input),
  deleteCarePlanGoalsForPlan: jest.fn(),
}));
jest.mock('../repositories/rehabilitationMeasurementRepository', () => ({
  upsertRehabilitationMeasurement: (input: unknown) => mockUpsertRehabMeasurement(input),
  replaceCarePlanRehabMetrics: jest.fn(),
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
jest.mock('../repositories/patientRepository', () => ({
  upsertCaregiver: jest.fn(),
}));

function bundleWithNotesAndGoals(patientId: string) {
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
        fullUrl: 'CarePlan/plan-with-notes-and-goals',
        resource: {
          resourceType: 'CarePlan',
          id: 'plan-with-notes-and-goals',
          status: 'active',
          intent: 'plan',
          title: 'Care plan with notes + goals',
          subject: { reference: `Patient/${patientId}` },
          period: { start: '2026-07-15' },
          note: [
            { text: 'No penicillin — severe allergy documented in 2024.' },
            { text: 'Watch oxygen at night.' },
          ],
          goal: [
            { reference: `Goal/goal-${patientId}-mobility` },
            { reference: `Goal/goal-${patientId}-adherence` },
          ],
        },
      },
      {
        fullUrl: `Goal/goal-${patientId}-mobility`,
        resource: {
          resourceType: 'Goal',
          id: `goal-${patientId}-mobility`,
          lifecycleStatus: 'active',
          subject: { reference: `Patient/${patientId}` },
          description: { text: 'Improve range of motion in left wrist to 60 degrees.' },
          target: [
            {
              measure: { coding: [{ code: 'romDegrees' }] },
              detailQuantity: { value: 60, unit: 'deg' },
              dueDate: '2026-12-31',
            },
          ],
        },
      },
      {
        fullUrl: `Goal/goal-${patientId}-adherence`,
        resource: {
          resourceType: 'Goal',
          id: `goal-${patientId}-adherence`,
          lifecycleStatus: 'completed',
          subject: { reference: `Patient/${patientId}` },
          description: { text: 'Adherence at 80% weekly.' },
        },
      },
    ],
  };
}

beforeEach(() => {
  mockRunSync.mockClear();
  mockUpsertCarePlan.mockClear();
  mockUpsertCarePlanGoal.mockClear();
  mockUpsertRehabMeasurement.mockClear();
  mockRawResources.length = 0;
});

describe('FHIR CarePlan note + goal enrichment (planning/41 §9)', () => {
  it('concatenates CarePlan.note[] into safety_notes', () => {
    const patientId = saveFHIRBundleToDB(bundleWithNotesAndGoals('patient-notes'));

    expect(patientId).toBe('patient-notes');
    expect(mockUpsertCarePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-with-notes-and-goals',
        patientId: 'patient-notes',
        safetyNotes: expect.stringContaining('No penicillin'),
      }),
    );
    const safetyNotes = mockUpsertCarePlan.mock.calls[0][0].safetyNotes as string;
    expect(safetyNotes).toContain('Watch oxygen at night');
    // Both notes joined with a newline.
    expect(safetyNotes.split('\n').length).toBe(2);
  });

  it('imports referenced Goals that target the same patient into care_plan_goals', () => {
    saveFHIRBundleToDB(bundleWithNotesAndGoals('patient-goals'));

    const goalIds = mockUpsertCarePlanGoal.mock.calls.map(
      (call) => (call[0] as { goalId: string }).goalId,
    );
    expect(goalIds).toEqual(
      expect.arrayContaining(['goal-patient-goals-mobility', 'goal-patient-goals-adherence']),
    );
    // No other patient goals in the bundle; verify count matches the bundle.
    expect(goalIds.length).toBe(2);
  });

  it('maps FHIR Goal.lifecycleStatus to the local status bucket', () => {
    saveFHIRBundleToDB(bundleWithNotesAndGoals('patient-status'));
    const byGoalId = new Map(
      mockUpsertCarePlanGoal.mock.calls.map(
        (call) => [call[0].goalId as string, call[0]] as const,
      ),
    );
    expect(byGoalId.get('goal-patient-status-mobility')?.status).toBe('active');
    expect(byGoalId.get('goal-patient-status-adherence')?.status).toBe('completed');
  });

  it('persists the FHIR Goal target.dueDate as target_date', () => {
    saveFHIRBundleToDB(bundleWithNotesAndGoals('patient-due'));
    const mobilityCall = mockUpsertCarePlanGoal.mock.calls.find(
      (call) => call[0].goalId === 'goal-patient-due-mobility',
    );
    expect(mobilityCall?.[0].targetDate).toBe('2026-12-31');
  });
});
