/**
 * HEDIS measure table.
 *
 * HEDIS (Healthcare Effectiveness Data and Information Set) is the NCQA tool
 * used by >90% of US health plans to measure performance. This file maps a
 * subset of HEDIS measure domains to:
 *   - the patient population they apply to (via `appliesTo`)
 *   - the clinical question the bundler should pull evidence for
 *   - the care-plan goal the measure implies
 *   - the PubMed query to use when the bundler fetches evidence
 *
 * Per planning/32 §11 (D7), all seven measure domains are wired. P5a ships
 * the four core domains (COPD/asthma med ratio, BP control, immunization,
 * smoking cessation); P5b adds the secondary three (beta-blocker persistence
 * after MI, comprehensive diabetes care, antidepressant med management).
 *
 * The bundler calls `measuresForPatient(patient)` per patient and adds the
 * matching measures to the cache + care plan.
 */

import type { PatientRecordSnapshot } from '@/data/repositories/patientRecordRepository';

export interface HedisMeasure {
  id: string;
  domain: string;
  appliesTo: (snapshot: PatientRecordSnapshot) => boolean;
  clinicalQuestion: string;
  carePlanGoal: string;
  sourceQuery: { pubmed: string; medlineplus?: string };
}

function ageBand(age: string | undefined, min?: number, max?: number): boolean {
  if (!age) return true; // unknown age: don't gate
  const n = parseInt(age ?? '', 10);
  if (Number.isNaN(n)) return true;
  if (min !== undefined && n < min) return false;
  if (max !== undefined && n > max) return false;
  return true;
}

function hasCondition(
  snapshot: PatientRecordSnapshot,
  matchers: (name: string) => boolean,
): boolean {
  return snapshot.conditions.some((c) => !c.needsReview && matchers(c.name));
}

export const HEDIS_MEASURES: HedisMeasure[] = [
  // P5a — core four
  {
    id: 'hedis-copd-asthma-med-ratio',
    domain: 'Asthma/COPD medication ratio (AMR)',
    appliesTo: (s) => hasCondition(s, (n) => /copd|chronic obstructive|asthma/i.test(n)),
    clinicalQuestion: 'Inhaler regimen adherence + rescue-to-controller ratio for COPD or asthma',
    carePlanGoal: 'Maintain an inhaled-controller-to-rescue ratio ≥0.5 over the rolling 12 months. Contact care team if rescue use exceeds 3x/week.',
    sourceQuery: {
      pubmed: 'COPD asthma medication ratio adherence',
      medlineplus: 'COPD medicines',
    },
  },
  {
    id: 'hedis-controlling-high-bp',
    domain: 'Controlling high blood pressure (CBP)',
    appliesTo: (s) =>
      ageBand(s.patient?.age, 18, 85) &&
      (hasCondition(s, (n) => /hypertension|high blood pressure|stroke|cva|tia/i.test(n)) ||
        hasCondition(s, (n) => /copd|chronic obstructive|post.stroke|cerebral/i.test(n))),
    clinicalQuestion: 'Lifestyle + pharmacologic BP control target for the patient\u2019s age + comorbidities',
    carePlanGoal: 'Maintain BP < 130/80 mmHg (or per care plan). Home BP log reviewed monthly. Salt restriction + medication adherence.',
    sourceQuery: {
      pubmed: 'controlling high blood pressure adults target',
      medlineplus: 'High blood pressure',
    },
  },
  {
    id: 'hedis-immunization-status',
    domain: 'Immunization status (AIS / IMA)',
    appliesTo: (s) => ageBand(s.patient?.age, 18),
    clinicalQuestion: 'Annual adult immunization schedule: influenza, COVID-19, Tdap, pneumococcal (PCV15/PCV20/PPSV23), RSV (≥60), shingles (≥50)',
    carePlanGoal: 'Annual influenza + COVID-19 vaccines each fall. Pneumococcal + RSV per age. Document all vaccines in the care log; flag overdue items at quarterly PCP visits.',
    sourceQuery: {
      pubmed: 'adult immunization schedule 2025',
      medlineplus: 'Adult immunizations',
    },
  },
  {
    id: 'hedis-smoking-cessation',
    domain: 'Smoking cessation (MSC)',
    appliesTo: (s) => {
      // Heuristic: if the patient has COPD, the conversation about smoking
      // is part of standard care. We don't ask caregivers to disclose tobacco
      // use; we surface the topic whenever a respiratory / cardiac condition
      // is present so the SLM can offer evidence-based quit resources.
      return hasCondition(s, (n) => /copd|chronic obstructive|asthma|cardiac|heart|cva|stroke/i.test(n));
    },
    clinicalQuestion: 'Evidence-based smoking cessation: behavioral counseling + pharmacotherapy (varenicline, bupropion, NRT)',
    carePlanGoal: 'If applicable, offer referral to quitline (1-800-QUIT-NOW) + clinician-guided pharmacotherapy at every visit. Track readiness-to-quit stage in the care log.',
    sourceQuery: {
      pubmed: 'smoking cessation pharmacotherapy behavioral',
      medlineplus: 'Quitting smoking',
    },
  },

  // P5b — secondary three
  {
    id: 'hedis-beta-blocker-persistence-post-mi',
    domain: 'Persistence of beta-blocker treatment after MI (BPC)',
    appliesTo: (s) =>
      hasCondition(s, (n) => /myocardial infarction|post-MI|MI\b|cardiac|coronary|ischemic heart/i.test(n)),
    clinicalQuestion: 'Beta-blocker persistence ≥6 months post-MI; titration to target dose',
    carePlanGoal: 'Continue beta-blocker for ≥6 months post-MI without interruption. Review dose at quarterly PCP visit. Do not stop without prescriber direction.',
    sourceQuery: {
      pubmed: 'beta-blocker persistence post myocardial infarction',
    },
  },
  {
    id: 'hedis-comprehensive-diabetes-care',
    domain: 'Comprehensive diabetes care (CDC)',
    appliesTo: (s) => hasCondition(s, (n) => /diabetes|diabetic|type 2 diabetes|T2DM/i.test(n)),
    clinicalQuestion: 'A1c < 8% (individualized), annual retinal exam, annual foot exam, statin use, BP control',
    carePlanGoal: 'A1c at individualized target (commonly < 8%). Annual dilated retinal exam, foot exam, lipid panel. Daily foot checks at home.',
    sourceQuery: {
      pubmed: 'comprehensive diabetes care A1c targets',
      medlineplus: 'Diabetes',
    },
  },
  {
    id: 'hedis-antidepressant-med-mgmt',
    domain: 'Antidepressant medication management (AMM)',
    appliesTo: (s) => {
      // Surface this for any patient on a long-term medication regimen where
      // caregiver stress / depression is plausible (EHR case), and when
      // the care plan mentions mood / stress. Heuristic: the caregiver's
      // stressOrSupportNeeds being set is the strongest signal.
      const stress = s.caregiver?.mainConcern ?? '';
      return Boolean(stress) && /stress|burnout|overwhelm|anxiety|dep|mental health/i.test(stress);
    },
    clinicalQuestion: 'Antidepressant adherence ≥12 weeks (acute) and ≥6 months (continuation)',
    carePlanGoal: 'Continue antidepressant ≥6 months per clinical guidance. Track mood / sleep weekly; flag suicidal ideation to the prescriber immediately.',
    sourceQuery: {
      pubmed: 'antidepressant medication management adherence',
      medlineplus: 'Depression medicines',
    },
  },
];

export function measuresForPatient(snapshot: PatientRecordSnapshot): HedisMeasure[] {
  return HEDIS_MEASURES.filter((m) => m.appliesTo(snapshot));
}
