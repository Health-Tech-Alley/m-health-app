/**
 * Emergency screening lexicon — deterministic, no NLU/ML.
 *
 * Phrases are matched longest-first with token boundaries (see
 * screenForEmergency) so paraphrases hit without substring false positives.
 * Phrase strings must be lowercase; apostrophes are normalized to a space
 * before matching (e.g. "can't" → "can t").
 */

export type EmergencySignalGroup = {
  id: string;
  /** Canonical caregiver-facing label (also returned as matchedPhrase). */
  label: string;
  /** Normalized phrases (lowercase). */
  phrases: string[];
};

export const EMERGENCY_SIGNALS: EmergencySignalGroup[] = [
  {
    id: 'breathing_arrest',
    label: 'not breathing',
    phrases: [
      'not breathing',
      "isn't breathing",
      'isnt breathing',
      'stopped breathing',
      "can't breathe",
      'cannot breathe',
      "can't catch her breath",
      "can't catch his breath",
      "can't get a breath",
      "can't get any air",
      'agonal breathing',
      'gasping for air',
      'gasping for breath',
      'struggling to breathe',
    ],
  },
  {
    id: 'cyanosis',
    label: 'turning blue',
    phrases: [
      'turning blue',
      'turned blue',
      'lips turning blue',
      'lips are blue',
      'blue around the mouth',
      'cyanotic',
    ],
  },
  {
    id: 'unresponsive',
    label: 'unresponsive',
    phrases: [
      'unresponsive',
      "won't wake up",
      'will not wake up',
      "won't wake",
      "can't wake her",
      "can't wake him",
      'not waking up',
      'unconscious',
    ],
  },
  {
    id: 'no_pulse',
    label: 'no pulse',
    phrases: ["can't feel a pulse", 'no pulse', 'no heartbeat', 'heart stopped'],
  },
  {
    id: 'severe_chest_pain',
    label: 'severe chest pain',
    phrases: [
      'severe chest pain',
      'crushing chest pain',
      'pressing chest pain',
      'chest pain and crushing',
      'chest pain and cannot breathe',
    ],
  },
  {
    id: 'choking',
    label: 'choking',
    phrases: ['choking and cannot breathe', 'choking and can t breathe', 'is choking', 'choking right now'],
  },
  {
    id: 'active_seizure',
    label: 'having a seizure',
    phrases: [
      'active seizure lasting',
      'seizure lasting',
      'having a seizure',
      'having a seizure right now',
      'seizure right now',
      'seizing right now',
      'still seizing',
      "seizure won't stop",
    ],
  },
  {
    id: 'call_emergency',
    label: 'call 911 now',
    phrases: [
      'call 911 now',
      'call 911',
      'needs 911',
      'call an ambulance',
      'call the ambulance',
      'get an ambulance',
      'going to er now',
      'emergency right now',
    ],
  },
];

/**
 * Negation / safe-context guards. When any matches, the text is not an
 * emergency (e.g. "is he breathing fine", "choking hazard precautions").
 */
export const EMERGENCY_NEGATION_GUARDS: RegExp[] = [
  /\b(is|are|was|were|seems?|looks?)\s+(breathing|respirating)\s+(fine|ok|okay|normal|well|good)\b/,
  /\bno\s+(chest\s+)?pain\b/,
  /\bnot\s+(choking|seizing|unresponsive|blue)\b/,
  /\bbreathing\s+(exercises?|exercise routine|routine|practice|techniques?)\b/,
  /\bbreathing\s+(is\s+)?(fine|ok|okay|normal)\b/,
  /\bpulse\s+(oximeter|ox)\b/,
  /\bchoking\s+(hazards?|risks?|precautions?|safety|game)\b/,
];
