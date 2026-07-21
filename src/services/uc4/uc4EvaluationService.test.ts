import type { PatientRecordSnapshot } from '../../data/types';
import { getOpenAlerts } from '../../data/repositories/alertRepository';
import { getPreviousUc4Priorities, saveUc4Run } from '../../data/repositories/uc4PriorityRepository';
import { runUC4StructuredMicroPriorities } from '../../ml-models/uc4-micro-priorities';
import { getEventBus } from '../../orchestration/event-bus';
import { dispatchImmediate } from '../notifications';
import { adaptPatientRecordSnapshotToUC4Input } from './uc4PatientStateAdapter';
import { evaluateAndPersistUc4Priorities } from './uc4EvaluationService';

jest.mock('../../data/repositories/alertRepository', () => ({
  getOpenAlerts: jest.fn(),
}));

jest.mock('../../data/repositories/uc4PriorityRepository', () => ({
  getPreviousUc4Priorities: jest.fn(),
  saveUc4Run: jest.fn(),
}));

jest.mock('../../ml-models/uc4-micro-priorities', () => ({
  runUC4StructuredMicroPriorities: jest.fn(),
  UC4_ENGINE_VERSION: 'engine',
  UC4_RULE_REGISTRY_VERSION: 'rules',
  UC4_SCHEMA_VERSION: 'schema',
  UC4_SCORING_VERSION: 'scoring',
  UC4_TEMPLATE_REGISTRY_VERSION: 'templates',
}));

jest.mock('../../orchestration/event-bus', () => ({
  getEventBus: jest.fn(),
}));

jest.mock('../notifications', () => ({
  dispatchImmediate: jest.fn(),
}));

jest.mock('./uc4PatientStateAdapter', () => ({
  adaptPatientRecordSnapshotToUC4Input: jest.fn(),
}));

const mockGetOpenAlerts = getOpenAlerts as jest.Mock;
const mockGetPrevious = getPreviousUc4Priorities as jest.Mock;
const mockSaveRun = saveUc4Run as jest.Mock;
const mockRunner = runUC4StructuredMicroPriorities as jest.Mock;
const mockBus = getEventBus as jest.Mock;
const mockDispatch = dispatchImmediate as jest.Mock;
const mockAdapter = adaptPatientRecordSnapshotToUC4Input as jest.Mock;

const snapshot = { patient: { patientId: 'patient-1' } } as PatientRecordSnapshot;

const card = {
  patientId: 'patient-1',
  templateId: 'THERAPY_REHAB_ROUTINE_DIFFICULTY',
  title: 'Track therapy routine',
  body: 'Track when therapy is difficult.',
  priorityKind: 'recurring_concern',
  domain: 'rehab',
  score: 0.8,
  firedRuleCodes: ['R_THERAPY'],
  evidence: [],
  whatToLogNextSchema: [],
  freeTextUsedForScoring: false,
  safetyBoundary: 'Observation support only.',
  generatedAtIso: '2026-07-17T12:00:00.000Z',
  versions: {
    schema: 'schema',
    templateRegistry: 'templates',
    ruleRegistry: 'rules',
    scoring: 'scoring',
    engine: 'engine',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpenAlerts.mockReturnValue([]);
  mockGetPrevious.mockReturnValue([]);
  mockAdapter.mockReturnValue({
    status: 'ready',
    input: {
      patient: { patientId: 'patient-1' },
      medications: [],
      recentEvents: [],
      previousPriorities: [],
      uc1ActiveEmergency: false,
      currentSeverityContext: 'routine',
      nowIso: '2026-07-17T12:00:00.000Z',
    },
    warnings: [],
  });
  mockRunner.mockReturnValue({
    patientId: 'patient-1',
    paused: false,
    candidates: [],
    selectedCards: [card],
    auditRecords: [],
  });
  mockBus.mockReturnValue({ publish: jest.fn() });
});

describe('evaluateAndPersistUc4Priorities', () => {
  it('runs Jay UC4 from the state adapter, persists the run, publishes, and sends a routine notification', () => {
    const result = evaluateAndPersistUc4Priorities(snapshot, {
      nowIso: '2026-07-17T12:00:00.000Z',
      runId: 'run-1',
    });

    expect(mockAdapter).toHaveBeenCalledWith(expect.objectContaining({
      snapshot,
      activeAlerts: [],
      previousPriorities: [],
      nowIso: '2026-07-17T12:00:00.000Z',
    }));
    expect(mockRunner).toHaveBeenCalled();
    expect(mockSaveRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      patientId: 'patient-1',
      status: 'completed',
      cards: [card],
      engineVersion: 'engine',
    }));
    expect(mockBus().publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'uc4_priorities_evaluated',
      status: 'completed',
      cardCount: 1,
    }));
    // Notification is the orchestrator's job: it reacts to the
    // uc4_priorities_evaluated event and dispatches a consent-gated standard
    // notification. The service itself never notifies directly.
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'success',
      runStatus: 'completed',
      cards: [card],
    });
  });

  it('persists paused runs and does not notify when no cards are shown', () => {
    mockRunner.mockReturnValue({
      patientId: 'patient-1',
      paused: true,
      pauseReason: 'active emergency',
      candidates: [],
      selectedCards: [],
      auditRecords: [],
    });

    const result = evaluateAndPersistUc4Priorities(snapshot, {
      nowIso: '2026-07-17T12:00:00.000Z',
      runId: 'run-paused',
    });

    expect(mockSaveRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-paused',
      status: 'paused',
      pauseReason: 'active emergency',
      cards: [],
    }));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'success',
      runStatus: 'paused',
      paused: true,
    });
  });

  it('stops without running Jay when adapter is not ready', () => {
    mockAdapter.mockReturnValue({
      status: 'not_ready',
      errors: [{ code: 'missing_patient_identity', message: 'Patient required.' }],
      warnings: [],
    });

    const result = evaluateAndPersistUc4Priorities(snapshot);

    expect(mockRunner).not.toHaveBeenCalled();
    expect(mockSaveRun).not.toHaveBeenCalled();
    expect(result.status).toBe('not_ready');
  });
});
