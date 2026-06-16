/**
 * Seed the local database from the onboarding profile.
 *
 * This is a one-way migration from the in-memory onboarding profile to the
 * persistent SQLite schema. It should run once after onboarding completes,
 * or whenever the profile is updated.
 */

import type { OnboardingProfile } from '@/services/onboarding/onboardingService';

import {
  upsertCaregiver,
  upsertCondition,
  upsertMedication,
  upsertPatient,
} from '../repositories/patientRepository';
import { replaceThresholdsForVital } from '../repositories/thresholdRepository';
import type { Threshold } from '../types';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

const DEFAULT_PATIENT_ID = 'default-patient';
const DEFAULT_CAREGIVER_ID = 'default-caregiver';

export function seedDatabaseFromProfile(
  profile: OnboardingProfile,
  patientId = DEFAULT_PATIENT_ID,
): string {
  const now = new Date().toISOString();
  const caregiverId = DEFAULT_CAREGIVER_ID;

  upsertPatient({
    patientId,
    name: profile.patient.name,
    age: profile.patient.age,
    conditions: profile.patient.conditions,
    baselineDailyRoutine: profile.patient.baselineDailyRoutine,
    currentMedications: profile.patient.currentMedications,
    spo2Cutoff: profile.patient.spo2Cutoff,
    baselineHeartRate: profile.patient.baselineHeartRate,
    createdAt: profile.completedAt ?? now,
    updatedAt: now,
  });

  upsertCaregiver({
    caregiverId,
    patientId,
    name: profile.caregiver.name,
    relationship: profile.caregiver.relationship,
    experience: profile.caregiver.experience,
    availability: profile.caregiver.availability,
    languagePreference: profile.caregiver.languagePreference,
    medicalComfortLevel: profile.caregiver.medicalComfortLevel,
    hobbiesOrRoutines: profile.caregiver.hobbiesOrRoutines,
    mainConcern: profile.caregiver.mainConcern,
    stressOrSupportNeeds: profile.caregiver.stressOrSupportNeeds,
    backupCaregiver: profile.caregiver.backupCaregiver,
    createdAt: now,
  });

  // Seed conditions from the comma-separated conditions string.
  const conditionNames = profile.patient.conditions
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  for (const name of conditionNames) {
    upsertCondition({
      conditionId: makeId('condition'),
      patientId,
      name,
      onsetDate: undefined,
    });
  }

  // Seed medications from the comma-separated medications string.
  const medNames = (profile.patient.currentMedications ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  for (const name of medNames) {
    upsertMedication({
      medicationId: makeId('med'),
      patientId,
      name,
      active: true,
    });
  }

  // Seed initial thresholds from the profile where we can parse numbers.
  const thresholds: Threshold[] = [];
  const spo2Cutoff = parseThresholdValue(profile.patient.spo2Cutoff);
  if (spo2Cutoff !== null) {
    thresholds.push({
      thresholdId: makeId('threshold'),
      patientId,
      vitalType: 'spo2',
      value: spo2Cutoff,
      direction: 'below',
      severity: 3,
      source: 'pcp_careplan',
      createdAt: now,
    });
  }

  const hrBaseline = parseHeartRateBaseline(profile.patient.baselineHeartRate);
  if (hrBaseline !== null) {
    thresholds.push(
      {
        thresholdId: makeId('threshold'),
        patientId,
        vitalType: 'heart_rate',
        value: hrBaseline.upper + 30,
        direction: 'above',
        severity: 2,
        source: 'ml_baseline',
        createdAt: now,
      },
      {
        thresholdId: makeId('threshold'),
        patientId,
        vitalType: 'heart_rate',
        value: hrBaseline.lower - 20,
        direction: 'below',
        severity: 2,
        source: 'ml_baseline',
        createdAt: now,
      },
    );
  }

  if (thresholds.length > 0) {
    // Group by vital; replaceThresholdsForVital handles superseding old ones.
    const byVital: Record<string, Threshold[]> = {};
    for (const t of thresholds) {
      byVital[t.vitalType] = byVital[t.vitalType] ?? [];
      byVital[t.vitalType].push(t);
    }
    for (const vitalType of Object.keys(byVital)) {
      replaceThresholdsForVital(patientId, vitalType, byVital[vitalType]);
    }
  }

  return patientId;
}

function parseThresholdValue(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

function parseHeartRateBaseline(value: string | undefined): { lower: number; upper: number } | null {
  if (!value) return null;
  const match = value.match(/(\d+)[^\d]+(\d+)/);
  if (!match) return null;
  return { lower: parseInt(match[1], 10), upper: parseInt(match[2], 10) };
}
