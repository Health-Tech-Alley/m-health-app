import { getEventBus } from '@/orchestration/event-bus';
import type { OrchestrationEvent } from '@/orchestration/events';
import type { RehabDecision } from '@/ml-models/uc3-rehab-trajectory';

export interface PublishUc3AlertOptions {
  patientId: string;
  resultId: string;
  decision: RehabDecision;
  caregiverMessage: string;
}

function mapUc3SeverityToAlertSeverity(severity: string): 1 | 2 | 3 {
  switch (severity) {
    case 'urgent':
      return 3;
    case 'non_emergency':
      return 2;
    case 'informational':
      return 1;
    default:
      return 1;
  }
}

export function publishUc3ResultAsAlert(options: PublishUc3AlertOptions): string | undefined {
  const { patientId, resultId, decision, caregiverMessage } = options;

  const severity = mapUc3SeverityToAlertSeverity(decision.severity);
  if (severity < 1) return undefined;

  try {
    const bus = getEventBus();
    const now = new Date().toISOString();
    const alertId = `uc3-alert-${patientId}-${Date.now()}`.replace(/[^A-Za-z0-9_.:-]/g, '-');

    const event: Extract<OrchestrationEvent, { type: 'ml_alert_created' }> = {
      type: 'ml_alert_created',
      alertId,
      patientId,
      severity: severity as 1 | 2 | 3,
      score: decision.reviewPriorityScore,
      features: [],
      at: now,
      eventType: `UC3_${decision.eventType}`,
      modelVersion: decision.modelVersion,
      threshold: undefined,
      topFeatures: decision.reasonCodes.map((code) => [code, 1.0] as [string, number]),
      ruleEngine: {
        is_emergency: decision.emergencyThresholdBreach,
        severity,
        reasons: decision.reasonCodes,
      },
      caregiverBlock: {
        action: 'requires_review',
        confirmed: false,
        observations: decision.reasonCodes,
      },
      rawVitals: {
        contract: 'UC3TrajectoryDecision',
        contractVersion: 1,
        input: {
          patientId,
          resultId,
          eventType: decision.eventType,
          reviewPriorityScore: decision.reviewPriorityScore,
          metricAnalyses: decision.metricAnalyses,
        },
        provenance: {},
        evaluatedAt: now,
      },
      notificationTitle: decision.emergencyThresholdBreach
        ? 'Urgent: Safety concern in rehab log'
        : 'Rehab trajectory needs your review',
      notificationBody: caregiverMessage.slice(0, 200),
      pipelinePath: 'uc3_rehab_trajectory',
      initialAnomalyType: decision.eventType,
      postHitlAnomalyType: decision.eventType,
      scoreRatio: decision.reviewPriorityScore,
    };

    bus.publish(event);
    return alertId;
  } catch (err) {
    console.warn('[publishUc3ResultAsAlert] failed:', err);
    return undefined;
  }
}
