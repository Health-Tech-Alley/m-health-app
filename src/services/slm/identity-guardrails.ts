/**
 * Identity guardrails for Concierge chat.
 *
 * Detect when the user message appears to refer to a different patient or
 * caregiver than the one loaded in PatientRecordSnapshot, so the SLM can
 * raise a concern before answering as if the loaded record applies.
 */

export type IdentityAliasSet = {
  /** Formal / display name of the loaded patient */
  patientName?: string | null;
  /** Preferred / nickname of the loaded patient */
  patientPreferredName?: string | null;
  /** Loaded caregiver display name */
  caregiverName?: string | null;
};

export type IdentityMismatchKind =
  | 'wrong_patient'
  | 'wrong_caregiver_self'
  | 'wrong_caregiver_third_party'
  | 'mixed_identity';

export type IdentityMismatchFinding = {
  kind: IdentityMismatchKind;
  /** Name token(s) that triggered the finding */
  mentioned: string[];
  /** Short human-readable reason for logs / prompts */
  reason: string;
};

export type IdentityGuardResult = {
  hasMismatch: boolean;
  findings: IdentityMismatchFinding[];
  /** Inject into system prompt when hasMismatch */
  systemPromptBlock: string;
};

/** Known demo roster — used only to detect cross-persona mix-ups. */
const DEMO_PATIENT_FIRST_NAMES = [
  'james',
  'elena',
  'sofia',
  'sofi',
  'mike',
  'ryan',
] as const;

const DEMO_CAREGIVER_FIRST_NAMES = [
  'diane',
  'luis',
  'marco',
  'denise',
  'debbie',
] as const;

const STOP_NAME_TOKENS = new Set([
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'him',
  'her',
  'they',
  'them',
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'to',
  'of',
  'in',
  'on',
  'at',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'dr',
  'doctor',
  'mr',
  'mrs',
  'ms',
  'miss',
  'pcp',
  'nurse',
  'therapist',
  'mom',
  'dad',
  'mother',
  'father',
  'wife',
  'husband',
  'son',
  'daughter',
  'brother',
  'sister',
  'uncle',
  'aunt',
  'caregiver',
  'patient',
  'today',
  'morning',
  'evening',
  'night',
  'please',
  'thanks',
  'thank',
  'hello',
  'hi',
  'hey',
]);

function normalizeNameToken(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9'-]/g, '')
    .replace(/^['-]+|['-]+$/g, '');
}

function firstName(full?: string | null): string | null {
  if (!full?.trim()) return null;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const token = normalizeNameToken(parts[0]);
  return token.length >= 2 ? token : null;
}

function allNameTokens(full?: string | null): string[] {
  if (!full?.trim()) return [];
  return full
    .trim()
    .split(/\s+/)
    .map(normalizeNameToken)
    .filter((t) => t.length >= 2 && !STOP_NAME_TOKENS.has(t));
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function extractCapitalizedNameCandidates(message: string): string[] {
  // "Diane here", "James's", "for Mike," — rough proper-name harvest
  const matches = message.match(/\b[A-Z][a-z]{1,}(?:'[sS])?\b/g) ?? [];
  return unique(
    matches
      .map((m) => normalizeNameToken(m.replace(/'s$/i, '')))
      .filter((t) => t.length >= 2 && !STOP_NAME_TOKENS.has(t)),
  );
}

function messageMentionsToken(messageLower: string, token: string): boolean {
  if (!token || token.length < 2) return false;
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(messageLower);
}

/**
 * Detect self-intro as a caregiver: "I am Diane", "I'm Luis", "Diane here",
 * "this is Marco speaking".
 */
function detectSelfAsCaregiver(message: string): string[] {
  const patterns = [
    /\b(?:i\s+am|i'm|im)\s+([A-Za-z][A-Za-z'-]{1,})/gi,
    /\b(?:this\s+is)\s+([A-Za-z][A-Za-z'-]{1,})(?:\s+(?:speaking|here))?\b/gi,
    /\b([A-Za-z][A-Za-z'-]{1,})\s+here\b/gi,
    /\b(?:my\s+name\s+is)\s+([A-Za-z][A-Za-z'-]{1,})/gi,
  ];
  const found: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(message)) !== null) {
      const token = normalizeNameToken(m[1] ?? '');
      if (token.length >= 2 && !STOP_NAME_TOKENS.has(token)) {
        found.push(token);
      }
    }
  }
  return unique(found);
}

/**
 * Patient-as-subject patterns: "James seems", "for Elena", "Mike's meds",
 * "my son James", "about Sofia".
 */
function detectPatientSubjectNames(message: string): string[] {
  const patterns = [
    /\b(?:for|about|regarding|with|of)\s+([A-Za-z][A-Za-z'-]{1,})\b/gi,
    /\b([A-Za-z][A-Za-z'-]{1,})(?:'s)\s+(?:meds?|medications?|vitals?|spo2|breathing|rehab|exercises?|care|plan|fatigue|pain)\b/gi,
    /\b(?:my\s+(?:son|daughter|wife|husband|mother|father|mom|dad|child|brother|sister))\s+([A-Za-z][A-Za-z'-]{1,})\b/gi,
    /\b([A-Za-z][A-Za-z'-]{1,})\s+(?:seems|looks|has|is|was|needs|had)\b/gi,
  ];
  const found: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(message)) !== null) {
      const token = normalizeNameToken(m[1] ?? '');
      if (token.length >= 2 && !STOP_NAME_TOKENS.has(token)) {
        found.push(token);
      }
    }
  }
  // Also harvest capitalized tokens that match demo roster (higher precision)
  for (const cand of extractCapitalizedNameCandidates(message)) {
    if (
      (DEMO_PATIENT_FIRST_NAMES as readonly string[]).includes(cand) ||
      (DEMO_CAREGIVER_FIRST_NAMES as readonly string[]).includes(cand)
    ) {
      found.push(cand);
    }
  }
  return unique(found);
}

export function detectIdentityMismatches(
  message: string,
  identity: IdentityAliasSet,
): IdentityGuardResult {
  const trimmed = message?.trim() ?? '';
  if (!trimmed) {
    return { hasMismatch: false, findings: [], systemPromptBlock: '' };
  }

  const messageLower = trimmed.toLowerCase();
  const patientTokens = unique([
    ...allNameTokens(identity.patientName),
    ...allNameTokens(identity.patientPreferredName),
  ]);
  const caregiverTokens = unique(allNameTokens(identity.caregiverName));
  const patientFirst = firstName(identity.patientPreferredName) ?? firstName(identity.patientName);
  const caregiverFirst = firstName(identity.caregiverName);

  const allowed = new Set<string>([...patientTokens, ...caregiverTokens]);

  const findings: IdentityMismatchFinding[] = [];

  // 1) Self-intro as a different caregiver
  const selfNames = detectSelfAsCaregiver(trimmed);
  const wrongSelf = selfNames.filter((n) => {
    if (allowed.has(n)) return false;
    // "I am Mike" when Mike is the patient — still a role mix-up if they claim to be the patient
    if (patientTokens.includes(n) && caregiverFirst && n !== caregiverFirst) return true;
    return true;
  });
  if (wrongSelf.length > 0) {
    const claimsPatientIdentity = wrongSelf.some((n) => patientTokens.includes(n));
    findings.push({
      kind: claimsPatientIdentity ? 'mixed_identity' : 'wrong_caregiver_self',
      mentioned: wrongSelf,
      reason: claimsPatientIdentity
        ? `User self-identified as the patient (${wrongSelf.join(', ')}) rather than the loaded caregiver`
        : `User self-identified as caregiver "${wrongSelf.join(', ')}" but loaded caregiver is "${identity.caregiverName ?? 'unknown'}"`,
    });
  }

  // 2) Subject / roster names that are not the loaded patient or caregiver
  const subjectNames = detectPatientSubjectNames(trimmed);
  const foreignPatients = subjectNames.filter((n) => {
    if (allowed.has(n)) return false;
    // Prefer demo roster hits for patient-like names
    return (DEMO_PATIENT_FIRST_NAMES as readonly string[]).includes(n);
  });
  if (foreignPatients.length > 0) {
    findings.push({
      kind: 'wrong_patient',
      mentioned: foreignPatients,
      reason: `Message refers to patient name(s) ${foreignPatients.join(', ')} but loaded patient is "${identity.patientName ?? identity.patientPreferredName ?? 'unknown'}"`,
    });
  }

  // 3) Third-party caregiver names from demo roster that are not loaded
  const foreignCaregivers = subjectNames.filter((n) => {
    if (allowed.has(n)) return false;
    if (wrongSelf.includes(n)) return false; // already covered
    return (DEMO_CAREGIVER_FIRST_NAMES as readonly string[]).includes(n);
  });
  // Also catch "Diane here" style already in wrongSelf; third-party: "ask Diane" when Denise is loaded
  for (const demoCg of DEMO_CAREGIVER_FIRST_NAMES) {
    if (allowed.has(demoCg)) continue;
    if (messageMentionsToken(messageLower, demoCg) && !foreignCaregivers.includes(demoCg)) {
      // Avoid flagging if it's only inside a longer unrelated word (handled by \b)
      foreignCaregivers.push(demoCg);
    }
  }
  const uniqueForeignCg = unique(foreignCaregivers).filter((n) => !allowed.has(n));
  if (uniqueForeignCg.length > 0) {
    // If only mentioned as third party and not already wrong_self
    const notSelf = uniqueForeignCg.filter((n) => !wrongSelf.includes(n));
    if (notSelf.length > 0) {
      findings.push({
        kind: 'wrong_caregiver_third_party',
        mentioned: notSelf,
        reason: `Message mentions caregiver name(s) ${notSelf.join(', ')} but loaded caregiver is "${identity.caregiverName ?? 'unknown'}"`,
      });
    }
  }

  // 4) Explicit "patient is X" / "caring for X" when X is not loaded patient
  const caringFor = trimmed.match(
    /\b(?:caring\s+for|looking\s+after|caregiver\s+for)\s+([A-Za-z][A-Za-z'-]{1,})\b/i,
  );
  if (caringFor?.[1]) {
    const n = normalizeNameToken(caringFor[1]);
    if (n && !allowed.has(n) && patientFirst && n !== patientFirst) {
      if (!findings.some((f) => f.kind === 'wrong_patient' && f.mentioned.includes(n))) {
        findings.push({
          kind: 'wrong_patient',
          mentioned: [n],
          reason: `User said they are caring for "${caringFor[1]}" but loaded patient is "${identity.patientName ?? 'unknown'}"`,
        });
      }
    }
  }

  const hasMismatch = findings.length > 0;
  return {
    hasMismatch,
    findings,
    systemPromptBlock: hasMismatch
      ? buildIdentityGuardPromptBlock(findings, identity)
      : '',
  };
}

export function buildIdentityGuardPromptBlock(
  findings: IdentityMismatchFinding[],
  identity: IdentityAliasSet,
): string {
  const patientLabel =
    identity.patientPreferredName?.trim() ||
    identity.patientName?.trim() ||
    'the loaded patient';
  const caregiverLabel = identity.caregiverName?.trim() || 'the loaded caregiver';
  const bullets = findings.map((f) => `- ${f.reason}`).join('\n');

  return [
    'IDENTITY CHECK — POSSIBLE MISMATCH (deterministic app guardrail)',
    `Loaded patient: ${patientLabel}`,
    `Loaded caregiver (who you speak to): ${caregiverLabel}`,
    '',
    'The latest user message appears to reference a different person than the loaded record:',
    bullets,
    '',
    'YOU MUST:',
    '1. Gently flag the mismatch in plain language before (or instead of) giving clinical advice as if the loaded record applies.',
    `2. Confirm who they mean: e.g. "This chat is set up for ${patientLabel} with caregiver ${caregiverLabel}. Did you mean them, or a different person?"`,
    '3. Do NOT invent a second patient record. Do NOT merge facts from the loaded EHR onto a different named person.',
    '4. If they confirm the loaded patient, continue normally. If they mean someone else, ask them to switch profiles / load the correct patient in the app.',
    '5. Keep the tone warm and non-accusatory — typos and demo mix-ups are common.',
  ].join('\n');
}
