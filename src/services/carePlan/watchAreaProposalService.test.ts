import {
  getActiveAdcpRevisionForPatient,
  listPendingProposals,
} from '@/data/repositories/adcpRepository';
import { enqueueProposal } from './mlPlanProposalService';
import {
  proposeMedicationWatchArea,
  watchAreaAlreadyPlanned,
} from './watchAreaProposalService';
import type { MedicationWatchArea } from './carePrioritiesService';

jest.mock('@/data/repositories/adcpRepository', () => ({
  getActiveAdcpRevisionForPatient: jest.fn(),
  listPendingProposals: jest.fn(),
}));

jest.mock('./mlPlanProposalService', () => ({
  enqueueProposal: jest.fn(),
}));

const mockGetPlan = getActiveAdcpRevisionForPatient as jest.Mock;
const mockListPending = listPendingProposals as jest.Mock;
const mockEnqueue = enqueueProposal as jest.Mock;

const AREA: MedicationWatchArea = {
  medicationId: 'med-1',
  medicationName: 'Baclofen',
  watchAreas: ['SLEEPINESS_FATIGUE', 'DIZZINESS_OR_LIGHTHEADEDNESS'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlan.mockReturnValue(null);
  mockListPending.mockReturnValue([]);
  mockEnqueue.mockImplementation((input) => ({
    proposalId: 'prop-1',
    status: 'awaiting_hitl',
    ...input,
  }));
});

describe('proposeMedicationWatchArea', () => {
  it('enqueues a caregiver-drafted priority_promote proposal vetted by next UC4 run', () => {
    const proposal = proposeMedicationWatchArea({ patientId: 'patient-1', area: AREA });

    expect(proposal).not.toBeNull();
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient-1',
        intent: 'promote_uc4_to_plan_task',
        section: 'carePriorities',
        kind: 'priority_promote',
        draftedBy: 'caregiver',
        mlVetRequirement: { kind: 'next_uc4_run' },
      }),
    );
    const payload = mockEnqueue.mock.calls[0][0].payload;
    expect(payload.kind).toBe('priority_promote');
    expect(payload.priority.priorityId).toBe('watch:med-1');
    expect(payload.priority.title).toContain('Baclofen');
    expect(payload.priority.description).toContain('does not mean the medication is causing');
    expect(payload.priority.status).toBe('active');
  });

  it('dedupes when the watch area is already on the active plan', () => {
    mockGetPlan.mockReturnValue({
      carePriorities: { priorities: [{ priorityId: 'watch:med-1' }] },
    });
    expect(proposeMedicationWatchArea({ patientId: 'patient-1', area: AREA })).toBeNull();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('dedupes when a matching proposal is already pending', () => {
    mockListPending.mockReturnValue([
      {
        status: 'awaiting_hitl',
        payload: {
          kind: 'priority_promote',
          priority: { priorityId: 'watch:med-1' },
        },
      },
    ]);
    expect(proposeMedicationWatchArea({ patientId: 'patient-1', area: AREA })).toBeNull();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('returns null without a patient or watch areas', () => {
    expect(proposeMedicationWatchArea({ patientId: '', area: AREA })).toBeNull();
    expect(
      proposeMedicationWatchArea({
        patientId: 'patient-1',
        area: { ...AREA, watchAreas: [] },
      }),
    ).toBeNull();
  });
});

describe('watchAreaAlreadyPlanned', () => {
  it('is false when neither plan nor pending proposals mention it', () => {
    expect(watchAreaAlreadyPlanned('patient-1', AREA)).toBe(false);
  });

  it('degrades to false when repositories fail', () => {
    mockGetPlan.mockImplementation(() => {
      throw new Error('db down');
    });
    mockListPending.mockImplementation(() => {
      throw new Error('db down');
    });
    expect(watchAreaAlreadyPlanned('patient-1', AREA)).toBe(false);
  });
});
