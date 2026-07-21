import { getDatabase } from '../../data/db';
import { getCurrentPatientSnapshot } from '../../contexts/patient-record-context';
import { evaluateAndPersistUc4Priorities } from './uc4EvaluationService';
import {
  evaluateUc4OnCareFocus,
  isUc4FocusEvalDue,
  UC4_FOCUS_EVAL_MIN_INTERVAL_MS,
} from './uc4TriggerService';

jest.mock('../../data/db', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../contexts/patient-record-context', () => ({
  getCurrentPatientSnapshot: jest.fn(),
}));

jest.mock('./uc4EvaluationService', () => ({
  evaluateAndPersistUc4Priorities: jest.fn(),
}));

const mockGetDatabase = getDatabase as jest.Mock;
const mockGetSnapshot = getCurrentPatientSnapshot as jest.Mock;
const mockEvaluate = evaluateAndPersistUc4Priorities as jest.Mock;

const runSync = jest.fn();
const getFirstSync = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDatabase.mockReturnValue({ runSync, getFirstSync });
  mockGetSnapshot.mockReturnValue({ patient: { patientId: 'patient-1' } });
  mockEvaluate.mockReturnValue({
    status: 'success',
    runStatus: 'completed',
    cards: [{ cardId: 'card-1' }],
  });
});

describe('isUc4FocusEvalDue', () => {
  it('is due when no previous run is recorded', () => {
    getFirstSync.mockReturnValue(null);
    expect(isUc4FocusEvalDue('patient-1')).toBe(true);
  });

  it('is not due inside the throttle window', () => {
    getFirstSync.mockReturnValue({
      value_json: JSON.stringify(new Date(Date.now() - 1000).toISOString()),
    });
    expect(isUc4FocusEvalDue('patient-1')).toBe(false);
  });

  it('is due after the throttle window', () => {
    getFirstSync.mockReturnValue({
      value_json: JSON.stringify(
        new Date(Date.now() - UC4_FOCUS_EVAL_MIN_INTERVAL_MS - 1000).toISOString(),
      ),
    });
    expect(isUc4FocusEvalDue('patient-1')).toBe(true);
  });
});

describe('evaluateUc4OnCareFocus', () => {
  it('skips when there is no active patient', () => {
    mockGetSnapshot.mockReturnValue(null);
    expect(evaluateUc4OnCareFocus().kind).toBe('skipped_no_patient');
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('skips when throttled', () => {
    getFirstSync.mockReturnValue({
      value_json: JSON.stringify(new Date().toISOString()),
    });
    const outcome = evaluateUc4OnCareFocus();
    expect(outcome.kind).toBe('skipped_throttled');
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('evaluates and records the run when due', () => {
    getFirstSync.mockReturnValue(null);
    const outcome = evaluateUc4OnCareFocus();
    expect(outcome).toEqual({ kind: 'evaluated', runStatus: 'completed', cardCount: 1 });
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO app_settings'),
      'uc4_last_focus_eval:patient-1',
      expect.any(String),
      expect.any(String),
    );
  });

  it('bypasses the throttle when forced', () => {
    getFirstSync.mockReturnValue({
      value_json: JSON.stringify(new Date().toISOString()),
    });
    expect(evaluateUc4OnCareFocus({ force: true }).kind).toBe('evaluated');
  });

  it('records the attempt even when the adapter is not ready', () => {
    getFirstSync.mockReturnValue(null);
    mockEvaluate.mockReturnValue({ status: 'not_ready' });
    expect(evaluateUc4OnCareFocus().kind).toBe('not_ready');
    expect(runSync).toHaveBeenCalled();
  });

  it('degrades quietly on evaluation errors', () => {
    getFirstSync.mockReturnValue(null);
    mockEvaluate.mockImplementation(() => {
      throw new Error('boom');
    });
    const outcome = evaluateUc4OnCareFocus();
    expect(outcome).toEqual({ kind: 'error', message: 'boom' });
    expect(runSync).toHaveBeenCalled();
  });
});
