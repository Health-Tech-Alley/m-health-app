/**
 * Next-step action taxonomy for the anomaly-detection flow.
 *
 * The SLM may propose any subset of these actions after explaining an alert.
 * The action set is constrained — the SLM cannot invent arbitrary actions.
 * Each action may be wired to a native deep-link (dialer, maps) or an in-app
 * flow, and may require consent or location access.
 */

import type { NextStepActionId } from '@/data/types';

export type NextStepMeta = {
  actionId: NextStepActionId;
  label: string;
  requiresConsent?: boolean;
  consentScope?: string;
  requiresLocation?: boolean;
  deepLink?: boolean;
  severity3Always?: boolean;
  order: number;
};

export const NEXT_STEP_TAXONOMY: NextStepMeta[] = [
  {
    actionId: 'call_911',
    label: 'Call 911',
    deepLink: true,
    severity3Always: true,
    order: 0,
  },
  {
    actionId: 'go_to_er',
    label: 'Go to nearest ER',
    deepLink: true,
    requiresLocation: true,
    severity3Always: true,
    order: 1,
  },
  {
    actionId: 'contact_pcp',
    label: 'Contact primary care provider',
    deepLink: true,
    order: 2,
  },
  {
    actionId: 'geofence_service',
    label: 'Find nearby pharmacy or urgent care',
    deepLink: true,
    requiresLocation: true,
    order: 3,
  },
  {
    actionId: 'schedule_urgent_appt',
    label: 'Schedule an urgent appointment',
    order: 4,
  },
  {
    actionId: 'share_record',
    label: 'Securely share this with the care team',
    requiresConsent: true,
    consentScope: 'ccda_export',
    order: 5,
  },
  {
    actionId: 'monitor_home',
    label: 'Continue monitoring at home',
    order: 6,
  },
  {
    actionId: 'log_note',
    label: 'Add a note',
    order: 7,
  },
];

const TAXONOMY_MAP = new Map(
  NEXT_STEP_TAXONOMY.map((t) => [t.actionId, t]),
);

export function getNextStepMeta(actionId: string): NextStepMeta | undefined {
  return TAXONOMY_MAP.get(actionId as NextStepActionId);
}

export function isValidActionId(id: string): id is NextStepActionId {
  return TAXONOMY_MAP.has(id as NextStepActionId);
}

export const ALL_ACTION_IDS = NEXT_STEP_TAXONOMY.map((t) => t.actionId);

export const NEXT_STEP_PROMPT_CONTRACT = `Then, recommend 1–4 next steps for the caregiver as multiple-choice options.
Format exactly:
NEXT_STEPS:
- [call_911] Call 911
- [contact_pcp] Contact Dr. Reynolds
- [monitor_home] Continue monitoring at home

Only use action ids from: call_911, go_to_er, contact_pcp, geofence_service, schedule_urgent_appt, share_record, monitor_home, log_note.
Order by urgency. For severity-3 alerts, always include call_911 and/or go_to_er.`;
