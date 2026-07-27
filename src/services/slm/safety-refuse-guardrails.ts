/**
 * Deterministic refuse gates for Concierge chat.
 *
 * Unknown / invented clinical protocols (ACL Safety Exhibit: "Protocol 9-Delta")
 * must never reach the generative model — models often improvise setup steps.
 * Dose-change requests are also refused here so boundary tests are stable.
 */

export type SafetyRefuseKind =
  | 'unknown_protocol'
  | 'medication_dose_change'
  | 'auto_emergency_action'
  | 'diagnosis_request';

export type SafetyRefuseResult = {
  refuse: true;
  kind: SafetyRefuseKind;
  /** Caregiver-facing markdown reply (verbatim for audit / ACL logs). */
  message: string;
};

export type SafetyAllowResult = {
  refuse: false;
};

export type SafetyGateResult = SafetyRefuseResult | SafetyAllowResult;

const UNKNOWN_PROTOCOL_MESSAGE = [
  "I don't have a protocol named that, and I won't invent or apply unknown procedures.",
  '',
  'Concierge only uses guidance grounded in this app\'s care context and clinical knowledge — not external or made-up protocol codes.',
  '',
  'Tell me what you\'re trying to do in plain language (for example secretions, oxygen levels, medications, or the care plan), or contact the care team if a clinician gave you a specific protocol name.',
  '',
  'Nothing was changed in the session.',
].join('\n');

const DOSE_CHANGE_MESSAGE = [
  "I can't change medication doses or start a new regimen.",
  '',
  'Dose changes need the prescribing clinician. I can help you list current medications from the care record, common labeled side effects, or draft questions for the care team — nothing is applied automatically.',
].join('\n');

const AUTO_EMERGENCY_MESSAGE = [
  "I can't place emergency calls or act without you.",
  '',
  'If this is an emergency, call 911 or go to the ER yourself. Concierge can suggest next steps, but you always decide.',
].join('\n');

const DIAGNOSIS_MESSAGE = [
  "I can't diagnose or choose between medical conditions.",
  '',
  "I'm a caregiver support guide, not a clinician. I can help you note what you're seeing, compare it to known red flags in the care plan, and suggest when to contact the care team or seek urgent care — but I won't name a diagnosis or say which illness it is.",
  '',
  'If symptoms are severe or getting worse fast, call 911 or go to the ER.',
].join('\n');

/** Normalize for matching: lowercase, collapse whitespace, strip most punctuation. */
export function normalizeSafetyText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[""'']/g, "'")
    .replace(/[^a-z0-9\s.+%-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the user asks to apply/run/execute an unknown named protocol
 * (including the ACL "Protocol 9-Delta" exhibit).
 */
export function isUnknownProtocolRequest(text: string): boolean {
  const n = normalizeSafetyText(text);
  if (!n) return false;

  // Explicit ACL exhibit + close variants
  if (
    /\bprotocol\s*9[\s-]*delta\b/.test(n) ||
    /\b9[\s-]*delta\b/.test(n) && /\bprotocol\b/.test(n)
  ) {
    return true;
  }

  // "Apply/run/execute Protocol <code>" where code is not a known in-app skill
  const applyProtocol =
    /\b(apply|run|execute|enable|activate|start|load|initiate|invoke)\b.{0,40}\bprotocol\b/.test(
      n,
    ) || /\bprotocol\b.{0,40}\b(apply|run|execute|enable|activate|start|load)\b/.test(n);

  if (!applyProtocol) return false;

  // Allow plain language about real care topics that happen to say "protocol"
  // only when clearly educational and not commanding apply — already gated by apply verbs.
  // Block alphanumeric / code-like protocol names (9-delta, xyz-12, bravo-7).
  if (/\bprotocol\s+[a-z]*\d[\w-]*\b/.test(n)) return true;
  if (/\bprotocol\s+[a-z]{1,12}[\s-]+\d[\w-]*\b/.test(n)) return true;
  if (/\bprotocol\s+[a-z]+-[a-z0-9]+\b/.test(n)) return true;

  return false;
}

/** True when user asks Concierge to change / start / stop a medication dose. */
export function isMedicationDoseChangeRequest(text: string): boolean {
  const n = normalizeSafetyText(text);
  if (!n) return false;

  const doseVerb =
    /\b(increase|decrease|raise|lower|double|halve|stop|discontinue|start|begin|change|adjust|titrate|up\s*the|bump)\b/.test(
      n,
    );
  const medCue =
    /\b(dose|dosage|mg|mcg|units?|tablet|capsule|tid|bid|qid|qhs|prn|medication|meds?|baclofen|gabapentin|midazolam|albuterol|prednisone)\b/.test(
      n,
    );
  const regimen =
    /\b\d+(\.\d+)?\s*mg\b/.test(n) &&
    /\b(times?\s+a\s+day|daily|twice|three\s+times|tonight|starting)\b/.test(n);

  if (regimen && doseVerb) return true;
  if (doseVerb && medCue && /\b(to|by|from)\b/.test(n)) return true;
  if (/\b(increase|decrease|change|adjust)\b.{0,30}\b(dose|dosage|baclofen)\b/.test(n)) {
    return true;
  }
  return false;
}

/** True when user asks the app to auto-call 911 / act without confirmation. */
export function isAutoEmergencyActionRequest(text: string): boolean {
  const n = normalizeSafetyText(text);
  if (!n) return false;
  const auto =
    /\b(auto[- ]?call|automatically call|call 911 for me|call emergency without|without asking|without me|don t ask|dont ask)\b/.test(
      n,
    );
  const emergency = /\b(911|emergency|ambulance|er)\b/.test(n);
  return auto && emergency;
}

/**
 * True when the user is asking Concierge to diagnose or pick a disease label.
 * Ordinary "what should I watch for" education is NOT refused here.
 */
export function isDiagnosisRequest(text: string): boolean {
  const n = normalizeSafetyText(text);
  if (!n) return false;

  // Explicit diagnose / diagnosis commands
  if (
    /\b(diagnose|diagnosis|give (me )?a diagnosis|make a diagnosis|what s the diagnosis|whats the diagnosis)\b/.test(
      n,
    )
  ) {
    return true;
  }

  // "Is this X or Y?" disease-choice pattern (common ACL-style boundary)
  const diseaseOr =
    /\b(pneumonia|flu|cold|covid|infection|asthma|seizure|stroke|uti|bronchitis|aspiration|gerd|reflux)\b/.test(
      n,
    ) &&
    /\b(or|vs|versus)\b/.test(n) &&
    /\b(is this|is it|could this be|do you think|which one|what is it)\b/.test(n);
  if (diseaseOr) return true;

  // Direct "does he have X?" / "tell me if it's X"
  if (
    /\b(does he have|does she have|do they have|is he having|is she having)\b.{0,40}\b(pneumonia|flu|covid|infection|stroke|seizure disorder)\b/.test(
      n,
    )
  ) {
    return true;
  }
  if (
    /\b(tell me (if|whether)|confirm (if|whether)|prove (if|whether))\b.{0,30}\b(pneumonia|diagnos)/.test(
      n,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * First matching refuse wins. Call before NLU/SLM so generative models cannot improvise.
 */
export function evaluateSafetyRefuseGate(userText: string): SafetyGateResult {
  if (isUnknownProtocolRequest(userText)) {
    return {
      refuse: true,
      kind: 'unknown_protocol',
      message: UNKNOWN_PROTOCOL_MESSAGE,
    };
  }
  if (isMedicationDoseChangeRequest(userText)) {
    return {
      refuse: true,
      kind: 'medication_dose_change',
      message: DOSE_CHANGE_MESSAGE,
    };
  }
  if (isAutoEmergencyActionRequest(userText)) {
    return {
      refuse: true,
      kind: 'auto_emergency_action',
      message: AUTO_EMERGENCY_MESSAGE,
    };
  }
  if (isDiagnosisRequest(userText)) {
    return {
      refuse: true,
      kind: 'diagnosis_request',
      message: DIAGNOSIS_MESSAGE,
    };
  }
  return { refuse: false };
}

/** Extra system-prompt lines (defense in depth if a request slips past the gate). */
export function safetyRefuseSystemPromptBlock(): string {
  return [
    'UNKNOWN PROTOCOLS (HARD RULE)',
    '- If the user names a protocol code you were not given in the care context (e.g. "Protocol 9-Delta", "Protocol Bravo-7"), refuse.',
    '- Do NOT invent setup steps, monitoring system instructions, or pretend the protocol exists.',
    '- Say you have no such protocol, that nothing was applied, and ask them to describe the real goal in plain language or contact the care team.',
    '',
    'DIAGNOSIS (HARD RULE)',
    '- Never diagnose or pick between diseases (e.g. pneumonia vs cold).',
    '- Refuse diagnosis requests; offer monitoring cues and when to contact the care team or ER.',
  ].join('\n');
}
