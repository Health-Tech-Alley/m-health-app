/**
 * Patient-State Agent.
 *
 * Maintains and summarizes patient context from the local SQLite cache.
 * It does not call the SLM; it returns a deterministic summary proposal.
 */

import { getPatient, getActiveThresholds, getConditionsForPatient, getRecentHealthSamples } from '@/data';
import type { HealthSampleType } from '@/data';

import type { Agent, AgentContext, AgentProposalInternal } from './agent-types';

export class PatientStateAgent implements Agent {
  readonly name = 'patient-state-agent';

  async propose(context: AgentContext): Promise<AgentProposalInternal> {
    const patient = getPatient(context.patientId);
    const conditions = getConditionsForPatient(context.patientId);
    const thresholds = getActiveThresholds(context.patientId);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const types: HealthSampleType[] = ['spo2', 'heart_rate', 'respiratory_rate', 'temperature'];
    const recentVitals: Record<string, { latest?: number; unit: string; samples: number }> = {};
    for (const type of types) {
      const samples = getRecentHealthSamples(context.patientId, type, since, 100);
      if (samples.length > 0) {
        recentVitals[type] = {
          latest: samples[0].value,
          unit: samples[0].unit,
          samples: samples.length,
        };
      }
    }

    const notes: string[] = [];
    if (patient?.spo2Cutoff) {
      notes.push(`Patient SpO2 cutoff is ${patient.spo2Cutoff}.`);
    }
    if (thresholds.some((t) => t.severity === 3)) {
      notes.push('Patient has active severity-3 thresholds.');
    }

    return {
      agent: this.name,
      message: `Patient ${patient?.name ?? 'Unknown'} has conditions: ${conditions.map((c) => c.name).join(', ') || 'none documented'}. Recent vitals summarized.`,
      proposedActions: [],
      citations: [],
      safetyNotes: notes,
    };
  }
}
