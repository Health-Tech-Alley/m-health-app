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
      source?: import('@/data/types').HealthSampleSource;
      receivedAt?: string;
    }
  | {
      type: 'ml_alert_created';
      alertId: string;
      patientId: string;
      severity: 1 | 2 | 3;
      score: number;
      features: number[];
      at: string;
      // ── ML → SLM bridge (Phase 4): structured payload from the ML model ──
      // These fields carry the full output shape (Jay's sample JSON). Optional
      // so the existing AlertMlService doesn't break; populated when the model
      // emits the rich format.
      deviceId?: string;
      queueType?: string; // 'SLM_HEURISTIC_REFINEMENT' | ...
      eventType?: string; // 'TRIGGER_WORKFLOW_ANOMALY_TYPE_04' | ...
      modelVersion?: string;
      threshold?: number;
      personalizedThreshold?: number;
      reconstructionError?: number;
      inputHash?: string;
      topFeatures?: [string, number][]; // [["stress_level",23.19], ...]
      ruleEngine?: { is_emergency: boolean; severity: number; reasons: string[] };
      caregiverBlock?: { action?: string; confirmed?: boolean; observations?: string[] };
      rawVitals?: unknown;
      trainingLabelProxy?: { health_event: number; event_label: number };
      // ── UC2 decision-layer fields (planning/23 §4) ──
      pipelinePath?: string;
      initialAnomalyType?: string;
      postHitlAnomalyType?: string;
      featureQuality?: Record<string, string>;
      scoreRatio?: number;
      notificationTitle?: string;
      notificationBody?: string;
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
      action?: 'confirm_critical_hypothetical' | 'dismiss_critical_hypothetical' | string;
      at: string;
    }
  | { type: 'slm_explain_requested'; alertId: string; patientId: string; at: string }
  | {
      type: 'uc3_trajectory_evaluated';
      patientId: string;
      resultId: string;
      carePlanId: string;
      eventType: string;
      severity: string;
      requiresHumanReview: boolean;
      emergencyThresholdBreach: boolean;
      inserted?: boolean;
      generatedAt: string;
      at: string;
    }
  | {
      type: 'uc4_priorities_evaluated';
      patientId: string;
      runId: string;
      status: 'completed' | 'paused' | 'no_cards' | 'error';
      paused: boolean;
      pauseReason?: string | null;
      cardCount: number;
      at: string;
    }
  | {
      type: 'uc4_caregiver_response';
      patientId: string;
      responseId: string;
      cardId?: string | null;
      action: string;
      at: string;
    }
  | { type: 'appt_synced'; apptId: string; patientId: string; at: string }
  | { type: 'consent_changed'; patientId: string; scope: string; granted: boolean; at: string }
  | {
      type: 'slm_hypothetical_critical';
      alertId: string;
      patientId: string;
      hypotheticalVitals: Partial<Record<'heart_rate' | 'blood_oxygen' | 'blood_pressure_systolic' | 'blood_pressure_diastolic' | 'glucose_level' | 'body_temperature' | 'respiratory_rate', number>>;
      mlResult: { severity: number; aeScore: number | null; threshold: number; isAnomaly: boolean; emergency: boolean; topFeatures: [string, number][] };
      requiresCaregiverConfirm: true;
      at: string;
    }
  | {
      type: 'uc3_trajectory_evaluated';
      patientId: string;
      resultId: string;
      eventType: string;
      severity: string;
      requiresHumanReview: boolean;
      emergencyThresholdBreach: boolean;
      linkedAlertId?: string;
      at: string;
    }
  | {
      type: 'uc4_priorities_evaluated';
      patientId: string;
      runId: string;
      paused: boolean;
      cardCount: number;
      at: string;
    }
  | {
      type: 'uc4_caregiver_response';
      patientId: string;
      cardId: string;
      action: string;
      at: string;
    };
