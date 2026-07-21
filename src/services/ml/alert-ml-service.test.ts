import { parseRawVitals } from '@/data/repositories/mlEventRepository';
import type { MlEvent } from '@/data/types';

import { MockAlertAutoencoder } from '@/ml-models/alert-autoencoder';

import { AlertMlService, buildMlRawVitalsInputEnvelope } from './alert-ml-service';

describe('AlertMlService raw vitals preservation', () => {
  it('serializes exact AppleWatchVitalsInput values and provenance without zero-filling missing fields', () => {
    const envelope = buildMlRawVitalsInputEnvelope({
      input: {
        patient_id: 'patient-1',
        timestamp: '2026-06-28T10:00:00.000Z',
        heart_rate: 88,
        blood_oxygen: 96,
      },
      provenance: {
        heart_rate: {
          source: 'mock',
          sampleId: 'sample-hr',
          recordedAt: '2026-06-28T09:59:00.000Z',
          receivedAt: '2026-06-28T09:59:03.000Z',
          unit: 'bpm',
          healthSampleType: 'heart_rate',
        },
      },
      evaluatedAt: '2026-06-28T10:00:00.000Z',
    });

    const persisted = JSON.parse(JSON.stringify(envelope));

    expect(persisted).toMatchObject({
      contract: 'AppleWatchVitalsInput',
      contractVersion: 1,
      input: {
        patient_id: 'patient-1',
        timestamp: '2026-06-28T10:00:00.000Z',
        heart_rate: 88,
        blood_oxygen: 96,
      },
      provenance: {
        heart_rate: {
          source: 'mock',
          sampleId: 'sample-hr',
          recordedAt: '2026-06-28T09:59:00.000Z',
          receivedAt: '2026-06-28T09:59:03.000Z',
          unit: 'bpm',
          healthSampleType: 'heart_rate',
        },
      },
      evaluatedAt: '2026-06-28T10:00:00.000Z',
    });
    expect(persisted.input).not.toHaveProperty('respiratory_rate');
    expect(persisted.provenance.heart_rate.source).toBe('mock');
    expect(persisted.provenance.heart_rate.source).not.toBe('apple-health');
  });

  it('parses legacy flat raw_vitals_json and the new input/provenance envelope', () => {
    const legacy = parseRawVitals({
      rawVitalsJson: JSON.stringify({ heart_rate: 88, blood_oxygen: 96 }),
    } as MlEvent);
    expect(legacy).toEqual({ heart_rate: 88, blood_oxygen: 96 });

    const envelope = buildMlRawVitalsInputEnvelope({
      input: {
        patient_id: 'patient-1',
        timestamp: '2026-06-28T10:00:00.000Z',
        heart_rate: 88,
      },
      provenance: {},
      evaluatedAt: '2026-06-28T10:00:00.000Z',
    });

    const parsed = parseRawVitals({
      rawVitalsJson: JSON.stringify(envelope),
    } as MlEvent);
    expect(parsed).toMatchObject({
      contract: 'AppleWatchVitalsInput',
      input: { heart_rate: 88 },
    });
  });
});

describe('AlertMlService legacy emergency fallback', () => {
  function service() {
    return new AlertMlService(new MockAlertAutoencoder());
  }

  it('returns the existing severity-3 emergency result for low blood oxygen', async () => {
    const result = await service().runDecisionLayer({
      patient_id: 'patient-1',
      timestamp: '2026-06-28T10:00:00.000Z',
      heart_rate: 80,
      blood_oxygen: 86,
    });

    expect(result?.emergencyResult).toMatchObject({
      emergency: true,
      severity: 3,
      reason: 'SpO2 86 <= 88',
      pipelinePath: 'RULE_ENGINE_EMERGENCY_FAST_PATH',
    });
    expect(result?.finalDecision).toMatchObject({
      final_notification_type: 'CRITICAL_EMERGENCY_ALERT',
      final_severity: 3,
      final_notification_title: 'Critical health alert',
    });
    expect(result?.isAnomaly).toBe(false);
    expect(result?.aeScore).toBeNull();
  });

  it('returns the existing severity-3 emergency result for extreme heart rate', async () => {
    const result = await service().runDecisionLayer({
      patient_id: 'patient-1',
      timestamp: '2026-06-28T10:00:00.000Z',
      heart_rate: 145,
      blood_oxygen: 97,
    });

    expect(result?.emergencyResult).toMatchObject({
      emergency: true,
      severity: 3,
      reason: 'Heart rate 145 >= 140',
      pipelinePath: 'RULE_ENGINE_EMERGENCY_FAST_PATH',
    });
    expect(result?.finalDecision.final_severity).toBe(3);
  });

  it('preserves the existing legacy severity-2 anomaly path when no emergency rule matches', async () => {
    const result = await service().runDecisionLayer({
      patient_id: 'patient-1',
      timestamp: '2026-06-28T10:00:00.000Z',
      heart_rate: 110,
      blood_oxygen: 89,
    });

    expect(result?.emergencyResult.emergency).toBe(false);
    expect(result?.isAnomaly).toBe(true);
    expect(result?.finalDecision).toMatchObject({
      final_notification_type: 'SLM_SUMMARY_AND_PROVIDER_NOTE',
      final_severity: 2,
      final_notification_title: 'Follow-up recommended',
      final_notification_body: 'An unusual pattern was detected by the anomaly model.',
    });
  });

  it('preserves normal legacy behavior when no emergency or anomaly matches', async () => {
    const result = await service().runDecisionLayer({
      patient_id: 'patient-1',
      timestamp: '2026-06-28T10:00:00.000Z',
      heart_rate: 72,
      blood_oxygen: 97,
    });

    expect(result?.emergencyResult.emergency).toBe(false);
    expect(result?.isAnomaly).toBe(false);
    expect(result?.finalDecision.final_severity).toBe(0);
  });
});