/**
 * Synthetic medication → watch-area mapping for UC4 demos.
 * Not clinical guidance. Production mapping must be clinician/pharmacist reviewed.
 */
import type { MedicationWatchCode } from './uc4Types';

const CLASS_WATCH: Record<string, MedicationWatchCode[]> = {
  antispasticity: [
    'SLEEPINESS_FATIGUE',
    'WEAKNESS_OR_LOW_TONE_CONCERN',
    'DIZZINESS_OR_LIGHTHEADEDNESS',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
  anticonvulsant: [
    'SLEEPINESS_FATIGUE',
    'MOOD_BEHAVIOR_CHANGE',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
  opioid: [
    'SLEEPINESS_FATIGUE',
    'BREATHING_CONCERN',
    'BOWEL_CHANGE',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
  benzodiazepine: [
    'SLEEPINESS_FATIGUE',
    'WEAKNESS_OR_LOW_TONE_CONCERN',
    'BREATHING_CONCERN',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
  anticholinergic: [
    'APPETITE_OR_HYDRATION_CHANGE',
    'BOWEL_CHANGE',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
  beta_blocker: [
    'HEART_RATE_OR_BP_CONCERN',
    'DIZZINESS_OR_LIGHTHEADEDNESS',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
  bronchodilator: [
    'HEART_RATE_OR_BP_CONCERN',
    'BREATHING_CONCERN',
    'MEDICATION_TIMING_CONTEXT_NEEDED',
  ],
};

const NAME_HINTS: { pattern: RegExp; watch: MedicationWatchCode[] }[] = [
  {
    pattern: /baclofen|tizanidine|dantrolene|botox|onabotulinum/i,
    watch: CLASS_WATCH.antispasticity,
  },
  {
    pattern: /levetiracetam|keppra|lamotrigine|valpro|carbamazepine|oxcarbazepine|clobazam/i,
    watch: CLASS_WATCH.anticonvulsant,
  },
  {
    pattern: /morphine|oxycodone|hydrocodone|tramadol|fentanyl/i,
    watch: CLASS_WATCH.opioid,
  },
  {
    pattern: /diazepam|lorazepam|clonazepam|midazolam|alprazolam/i,
    watch: CLASS_WATCH.benzodiazepine,
  },
  {
    pattern: /glycopyrrolate|oxybutynin|scopolamine|atropine/i,
    watch: CLASS_WATCH.anticholinergic,
  },
  {
    pattern: /propranolol|metoprolol|atenolol|carvedilol/i,
    watch: CLASS_WATCH.beta_blocker,
  },
  {
    pattern: /albuterol|salbutamol|ipratropium|tiotropium|budesonide/i,
    watch: CLASS_WATCH.bronchodilator,
  },
];

export function mapMedicationNameToWatchAreas(
  medicationName: string,
): MedicationWatchCode[] {
  const name = medicationName?.trim() ?? '';
  if (!name) return [];
  for (const hint of NAME_HINTS) {
    if (hint.pattern.test(name)) {
      return [...hint.watch];
    }
  }
  return ['MEDICATION_TIMING_CONTEXT_NEEDED', 'MISSED_OR_DELAYED_DOSE'];
}
