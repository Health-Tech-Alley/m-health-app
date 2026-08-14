/**
 * Named caregiver-facing app surfaces for entity linking + soft routing.
 * User-facing terms only — no ADCP/UC/ML jargon (AGENTS.md terminology).
 */

export type AppSurfaceId =
  | 'priorities_list'
  | 'care_focus'
  | 'medication_watch_areas'
  | 'clinical_knowledge'
  | 'care_plan_changes'
  | 'care_plan'
  | 'therapy_progress'
  | 'monitoring_settings'
  | 'todays_logging'
  | 'handoff_summary'
  | 'dashboard'
  | 'care_tab'
  | 'medications_tab'
  | 'schedule_tab'
  | 'concierge_tab'
  | 'health_monitor'
  | 'what_changed'
  | 'data_entry_times'
  | 'backup_restore';

export type AppSurfaceEntry = {
  id: AppSurfaceId;
  /** Canonical label returned on LinkedEntity.label */
  label: string;
  /** Match phrases (lowercase). Longer phrases preferred by linker order. */
  aliases: string[];
  /**
   * Optional Care catalog intent when the caregiver is asking about this surface
   * in a plan-action way. Undefined = Concierge guidance only.
   */
  careIntentHint?:
    | 'explain_uc4_card'
    | 'promote_uc4_to_plan_task'
    | 'explain_uc3_result'
    | 'review_monitoring_contract'
    | 'suggest_todays_logging'
    | 'weekly_care_plan_review'
    | 'handoff_summary'
    | 'explain_uc2_alert';
};

export const APP_SURFACE_LEXICON: AppSurfaceEntry[] = [
  {
    id: 'priorities_list',
    label: 'priorities list',
    aliases: [
      'priorities list',
      'priority list',
      'care priorities',
      'today\'s priorities',
      'todays priorities',
      'your priorities',
    ],
    careIntentHint: 'explain_uc4_card',
  },
  {
    id: 'care_focus',
    label: 'care focus',
    aliases: ['care focus', 'focus items', 'focus item', 'micro priority', 'priority card'],
    careIntentHint: 'explain_uc4_card',
  },
  {
    id: 'medication_watch_areas',
    label: 'medication watch areas',
    aliases: [
      'medication watch areas',
      'med watch areas',
      'watch areas',
      'areas to watch',
      'medication watch',
    ],
  },
  {
    id: 'clinical_knowledge',
    label: 'clinical knowledge base',
    aliases: [
      'clinical knowledge base',
      'clinical knowledge',
      'knowledge base',
      'knowledge packs',
      'knowledge pack',
      'clinical evidence',
    ],
  },
  {
    id: 'care_plan_changes',
    label: 'care plan changes',
    aliases: [
      'care plan changes',
      'what changed',
      'plan changes',
      'plan history',
      'version changes',
    ],
    careIntentHint: 'weekly_care_plan_review',
  },
  {
    id: 'care_plan',
    label: 'care plan',
    aliases: ['living care plan', 'care plan', 'the plan'],
  },
  {
    id: 'therapy_progress',
    label: 'therapy progress',
    aliases: [
      'therapy progress',
      'rehab progress',
      'rehabilitation progress',
      'recovery trajectory',
      'therapy result',
      'walking progress',
    ],
    careIntentHint: 'explain_uc3_result',
  },
  {
    id: 'monitoring_settings',
    label: 'monitoring settings',
    aliases: [
      'monitoring settings',
      'monitoring thresholds',
      'oxygen thresholds',
      'vitals thresholds',
      'threshold settings',
    ],
    careIntentHint: 'review_monitoring_contract',
  },
  {
    id: 'todays_logging',
    label: "today's logging",
    aliases: [
      'what should i log',
      'log today',
      'care log',
      'daily log',
      'logging checklist',
      'data entry',
    ],
    careIntentHint: 'suggest_todays_logging',
  },
  {
    id: 'data_entry_times',
    label: 'data entry times',
    aliases: ['data entry times', 'entry times', 'log time', 'when i logged', 'logged at'],
    careIntentHint: 'suggest_todays_logging',
  },
  {
    id: 'handoff_summary',
    label: 'handoff summary',
    aliases: [
      'handoff summary',
      'handoff note',
      'handoff',
      'backup summary',
      'backup caregiver',
      'relief caregiver',
      'weekend note',
      'weekend summary',
    ],
    careIntentHint: 'handoff_summary',
  },
  {
    id: 'dashboard',
    label: 'dashboard',
    aliases: ['dashboard', 'home tab', 'home screen'],
  },
  {
    id: 'care_tab',
    label: 'care tab',
    aliases: ['care tab', 'care screen'],
  },
  {
    id: 'medications_tab',
    label: 'medications tab',
    aliases: ['medications tab', 'meds tab', 'medication list'],
  },
  {
    id: 'schedule_tab',
    label: 'schedule tab',
    aliases: ['schedule tab', 'appointments tab'],
  },
  {
    id: 'concierge_tab',
    label: 'concierge tab',
    aliases: ['concierge tab', 'assistant tab', 'chat tab'],
  },
  {
    id: 'health_monitor',
    label: 'health monitor',
    aliases: ['health monitor', 'monitor alert', 'vitals alert'],
    careIntentHint: 'explain_uc2_alert',
  },
  {
    id: 'what_changed',
    label: 'what changed',
    aliases: ['what changed sheet', 'what changed'],
    careIntentHint: 'weekly_care_plan_review',
  },
  {
    id: 'backup_restore',
    label: 'backup and restore',
    aliases: ['backup and restore', 'care plan backup', 'restore care plan', 'backup section'],
  },
];

/** Flat labels for PatientNluContext.appSurfaces. */
export const APP_SURFACE_LABELS: string[] = APP_SURFACE_LEXICON.map((e) => e.label);

export function findAppSurface(aliasNorm: string): AppSurfaceEntry | undefined {
  // Normalize both sides: lowercase + apostrophe-strip ("today's" → "today s")
  // so alias matching survives entity-linker punctuation removal.
  const norm = aliasNorm
    .toLowerCase()
    .replace(/[']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return undefined;
  // Prefer longer aliases first
  const sorted = [...APP_SURFACE_LEXICON].sort(
    (a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)),
  );
  for (const entry of sorted) {
    for (const alias of entry.aliases) {
      if (norm.includes(alias.toLowerCase().replace(/[']/g, ' '))) return entry;
    }
  }
  return undefined;
}
