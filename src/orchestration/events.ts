/**
 * Orchestration event types.
 *
 * These are the only messages that flow on the event bus. Services publish
 * events; the orchestrator and CEP subscribe to them.
 */

export type OrchestrationEvent =
  | { type: 'med_due'; medId: string; patientId: string; at: string }
  | { type: 'med_taken'; medId: string; patientId: string; at: string; byCaregiver: string }
  | { type: 'med_missed'; medId: string; patientId: string; at: string }
  | {
      type: 'vitals_sample';
      patientId: string;
      sampleId: string;
      sampleType: string;
      value: number;
      unit: string;
      recordedAt: string;
    }
  | {
      type: 'ml_alert_created';
      alertId: string;
      patientId: string;
      severity: 1 | 2 | 3;
      score: number;
      features: number[];
      at: string;
    }
  | {
      type: 'caregiver_override';
      alertId: string;
      patientId: string;
      action: 'ack' | 'override' | 'escalate';
      note?: string;
      at: string;
    }
  | {
      type: 'caregiver_ground_truth';
      alertId: string;
      patientId: string;
      observation: string;
      at: string;
    }
  | { type: 'slm_explain_requested'; alertId: string; patientId: string; at: string }
  | { type: 'appt_synced'; apptId: string; patientId: string; at: string }
  | { type: 'consent_changed'; patientId: string; scope: string; granted: boolean; at: string };
