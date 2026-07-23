/**
 * Care plan → FHIR CarePlan + Goal mapper.
 *
 * Implements the HL7 CDA-ccda CarePlan profile: a CarePlan carries the
 * problem (addresses → Condition), the goal (target outcome → Goal), and
 * instructions (activity.detail with SNOMED CT activity codes). Thresholds
 * become monitoring activities with a reference range; medications become
 * medication-administration activities.
 */

import type { Medication, Threshold } from '../types';
import {
  SNOMED_CT_URI,
  loincVitalCode,
  snomedActivityCode,
} from './codes';
import { toFhirId, toFhirReference } from './identifiers';
import type {
  FhirCarePlan,
  FhirCarePlanActivity,
  FhirGoal,
  FhirGoalTarget,
} from './types';

export interface CarePlanRow {
  planId: string;
  patientId: string;
  version: number;
  effectiveDate: string;
  safetyNotes?: string;
  emergencyContact?: string;
  createdAt?: string;
}

export interface CarePlanGoalRow {
  goalId: string;
  planId: string;
  description: string;
  targetDate?: string;
  status: string;
}

const GOAL_LIFECYCLE_MAP: Record<string, FhirGoal['lifecycleStatus']> = {
  active: 'active',
  proposed: 'proposed',
  planned: 'planned',
  accepted: 'accepted',
  completed: 'completed',
  cancelled: 'cancelled',
  on_hold: 'on-hold',
  onhold: 'on-hold',
  rejected: 'rejected',
};

export function toFhirGoal(
  goal: CarePlanGoalRow,
  patientId: string,
): FhirGoal {
  const lifecycleStatus = GOAL_LIFECYCLE_MAP[goal.status?.toLowerCase()] ?? 'active';
  const target: FhirGoalTarget[] = [];
  if (goal.targetDate) target.push({ dueDate: goal.targetDate });
  return {
    resourceType: 'Goal',
    id: toFhirId(goal.goalId, 'Goal'),
    meta: { versionId: '1' },
    lifecycleStatus,
    description: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/goal-description',
          code: undefined,
          display: goal.description,
        },
      ],
      text: goal.description,
    },
    subject: toFhirReference('Patient', patientId),
    target: target.length ? target : undefined,
  };
}

function thresholdToActivity(threshold: Threshold): FhirCarePlanActivity {
  const vitalCode = loincVitalCode(threshold.vitalType as never);
  const description = `Monitor ${threshold.vitalType}: ${threshold.direction} ${threshold.value} (severity ${threshold.severity})`;

  return {
    detail: {
      code: snomedActivityCode('vitalSignsMonitoring'),
      status: 'in-progress',
      description,
      scheduledTiming: {
        repeat: { frequency: 1, period: 1, periodUnit: 'h' },
      },
      reference: vitalCode
        ? {
            reference: `ObservationDefinition/${threshold.vitalType}`,
            display: vitalCode.text,
          }
        : undefined,
    },
    reference: toFhirReference('Observation', `${threshold.vitalType}-${threshold.thresholdId}`),
  };
}

function medicationToActivity(med: Medication): FhirCarePlanActivity {
  return {
    detail: {
      code: snomedActivityCode('medicationAdministration'),
      status: med.active ? 'in-progress' : 'completed',
      description: [med.name, med.dosage, med.frequency].filter(Boolean).join(' · '),
      scheduledTiming: med.frequency
        ? {
            repeat: { frequency: 1, period: 1, periodUnit: 'd' },
            code: {
              coding: [{ system: SNOMED_CT_URI, display: med.frequency }],
              text: med.frequency,
            },
          }
        : undefined,
      reference: toFhirReference('MedicationStatement', med.medicationId, med.name),
    },
  };
}

export interface ToFhirCarePlanParams {
  patientId: string;
  carePlan?: CarePlanRow;
  goals: CarePlanGoalRow[];
  thresholds: Threshold[];
  medications: Medication[];
  conditionRefs?: { conditionId: string; name: string }[];
  contributorRefs?: { resourceType: 'Practitioner' | 'RelatedPerson'; rowId: string; display?: string }[];
}

export function toFhirCarePlan(params: ToFhirCarePlanParams): FhirCarePlan {
  const {
    patientId,
    carePlan,
    goals,
    thresholds,
    medications,
    conditionRefs = [],
    contributorRefs = [],
  } = params;

  const planId = carePlan?.planId ?? `careplan-${patientId}`;
  const version = carePlan?.version ?? 1;

  const addresses = conditionRefs.map((c) =>
    toFhirReference('Condition', c.conditionId, c.name),
  );

  const goalRefs = goals.map((g) => toFhirReference('Goal', g.goalId, g.description));

  const activities: FhirCarePlanActivity[] = [
    ...thresholds.map(thresholdToActivity),
    ...medications.map(medicationToActivity),
  ];

  const notes: { text: string }[] = [];
  if (carePlan?.safetyNotes) notes.push({ text: `Safety: ${carePlan.safetyNotes}` });
  if (carePlan?.emergencyContact) notes.push({ text: `Emergency contact: ${carePlan.emergencyContact}` });
  notes.push({ text: `Care plan version ${version}, effective ${carePlan?.effectiveDate ?? 'unknown'}.` });

  return {
    resourceType: 'CarePlan',
    id: toFhirId(planId, 'CarePlan'),
    meta: {
      versionId: String(version),
      lastUpdated: carePlan?.createdAt ?? carePlan?.effectiveDate,
      profile: ['http://hl7.org/fhir/us/ccda/StructureDefinition/CarePlan'],
    },
    status: 'active',
    intent: 'plan',
    subject: toFhirReference('Patient', patientId),
    addresses: addresses.length ? addresses : undefined,
    goal: goalRefs.length ? goalRefs : undefined,
    activity: activities.length ? activities : undefined,
    contributor: contributorRefs.map((c) =>
      toFhirReference(c.resourceType, c.rowId, c.display),
    ),
    note: notes,
  };
}
