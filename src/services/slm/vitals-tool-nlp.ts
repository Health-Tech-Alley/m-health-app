/**
 * Deterministic NLP for Concierge ↔ Health Monitor tool prep.
 *
 * Detects vitals / what-if intent and extracts tool args. Does **not** run ML.
  * Callers auto-run executeHypotheticalEval when args resolve (no confirm menu).
 */

export type HypotheticalVitalsArgs = {
  heart_rate?: number;
  blood_oxygen?: number;
  blood_pressure_systolic?: number;
  blood_pressure_diastolic?: number;
  glucose_level?: number;
  body_temperature?: number;
  respiratory_rate?: number;
};

const VITALS_INTENT =
  /\b(spo2|sp[o0]2|o2\s*sat|sats?|oxygen|blood\s*oxygen|heart\s*rate|pulse|\bhr\b|\bbpm\b|respiratory|resp(?:iratory)?\s*rate|\brr\b|breathing\s*rate|blood\s*pressure|\bbp\b|systolic|diastolic|glucose|blood\s*sugar|temp(?:erature)?|what\s*if|hypothetical|health\s*monitor|anomaly|vitals?)\b/i;

/** Normalize SpO2: fractions 0–1 → percent. */
function normalizeSpo2Arg(value: number): number {
  if (!Number.isFinite(value)) return value;
  return value > 0 && value <= 1 ? value * 100 : value;
}

function coerceNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function hasVitalsOrWhatIfIntent(text: string): boolean {
  return VITALS_INTENT.test(text);
}

/**
 * Parse `ACTION: evaluate_hypothetical_vitals({...})` with non-greedy balanced JSON.
 */
export function parseEvaluateHypotheticalAction(modelText: string): HypotheticalVitalsArgs | null {
  if (!modelText) return null;
  const match = modelText.match(
    /ACTION:\s*evaluate_hypothetical_vitals\s*\(\s*(\{[\s\S]*?\})\s*\)/i,
  );
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    return normalizeVitalsArgs(parsed);
  } catch {
    return null;
  }
}

export function stripEvaluateHypotheticalAction(text: string): string {
  return text
    .replace(/ACTION:\s*evaluate_hypothetical_vitals\s*\(\s*\{[\s\S]*?\}\s*\)\s*/gi, '')
    .replace(/ACTION:.*\n?/g, '')
    .trim();
}

export function normalizeVitalsArgs(raw: Record<string, unknown>): HypotheticalVitalsArgs | null {
  const out: HypotheticalVitalsArgs = {};
  const hr = coerceNumber(raw.heart_rate ?? raw.heartRate ?? raw.hr);
  const spo2 = coerceNumber(raw.blood_oxygen ?? raw.bloodOxygen ?? raw.spo2 ?? raw.SpO2);
  const sys = coerceNumber(raw.blood_pressure_systolic ?? raw.systolic);
  const dia = coerceNumber(raw.blood_pressure_diastolic ?? raw.diastolic);
  const glucose = coerceNumber(raw.glucose_level ?? raw.glucose);
  const temp = coerceNumber(raw.body_temperature ?? raw.temperature ?? raw.temp);
  const rr = coerceNumber(raw.respiratory_rate ?? raw.respiratoryRate ?? raw.rr);

  if (hr !== undefined) out.heart_rate = hr;
  if (spo2 !== undefined) out.blood_oxygen = normalizeSpo2Arg(spo2);
  if (sys !== undefined) out.blood_pressure_systolic = sys;
  if (dia !== undefined) out.blood_pressure_diastolic = dia;
  if (glucose !== undefined) out.glucose_level = glucose;
  if (temp !== undefined) out.body_temperature = temp;
  if (rr !== undefined) out.respiratory_rate = rr;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Extract vitals from free-form caregiver text.
 * SpO2 is always stored as percent (0–100). Plausible values only: SpO2
 * outside 60–100% (or 0.6–1 fraction) is treated as a different metric
 * (e.g. "oxygen 2 L/min" is a flow rate, not a saturation).
 */
export function extractVitalsFromUserText(text: string): HypotheticalVitalsArgs | null {
  if (!text?.trim()) return null;
  const out: HypotheticalVitalsArgs = {};

  const spo2Patterns = [
    new RegExp(
      `\\b(?:spo2|sp[o0]2|o2\\s*sat(?:uration)?|o2\\b|sats?|oxygen|blood\\s*oxygen)\\s*(?:is|are|was|were|running|at|of|to|=|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*%?`,
      'i',
    ),
    /\b(\d+(?:\.\d+)?)\s*%\s*(?:spo2|sp[o0]2|o2|oxygen)/i,
  ];
  for (const re of spo2Patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      const percent = normalizeSpo2Arg(n);
      if (Number.isFinite(percent) && percent >= 60 && percent <= 100) {
        out.blood_oxygen = percent;
        break;
      }
    }
  }

  const hrMatch =
    text.match(
      new RegExp(
        `\\b(?:heart\\s*rate|hr|pulse)\\s*(?:'?s\\s+|is|are|was|were|at|of|to|=|:)?\\s*(\\d{2,3})\\b`,
        'i',
      ),
    ) || text.match(/\b(\d{2,3})\s*(?:bpm)\b/i);
  if (hrMatch) {
    const n = Number(hrMatch[1]);
    if (n >= 30 && n <= 250) out.heart_rate = n;
  }

  const rrMatch =
    text.match(
      new RegExp(
        `\\b(?:respiratory\\s*rate|resp(?:iratory)?\\s*rate|rr|breathing\\s*rate)\\s*(?:'?s\\s+|is|are|was|were|at|of|to|=|:)?\\s*(\\d{1,2})\\b`,
        'i',
      ),
    ) || text.match(/\b(\d{1,2})\s*(?:breaths?\s*(?:per\s*min|\/\s*min)|rpm)\b/i);
  if (rrMatch) {
    const n = Number(rrMatch[1]);
    if (n >= 4 && n <= 60) out.respiratory_rate = n;
  }

  const bpMatch =
    text.match(
      new RegExp(
        `\\b(?:blood\\s*pressure|bp)\\s*(?:'?s\\s+|is|are|was|were|at|of|to|=|:)?\\s*(\\d{2,3})\\s*[/]\\s*(\\d{2,3})\\b`,
        'i',
      ),
    ) ||
    text.match(
      new RegExp(
        `\\b(?:blood\\s*pressure|bp)\\s*(?:'?s\\s+|is|are|was|were|at|of|to|=|:)?\\s*(\\d{2,3})\\s*over\\s*(\\d{2,3})\\b`,
        'i',
      ),
    );
  if (bpMatch) {
    out.blood_pressure_systolic = Number(bpMatch[1]);
    out.blood_pressure_diastolic = Number(bpMatch[2]);
  }

  const glucoseMatch = text.match(
    new RegExp(
      `\\b(?:glucose|blood\\s*sugar)\\s*(?:'?s\\s+|is|are|was|were|at|of|to|=|:)?\\s*(\\d{2,3})\\b`,
      'i',
    ),
  );
  if (glucoseMatch) out.glucose_level = Number(glucoseMatch[1]);

  const tempMatch =
    text.match(
      new RegExp(
        `\\b(?:temp(?:erature)?|body\\s*temp)\\s*(?:'?s\\s+|is|are|was|were|at|of|to|=|:)?\\s*(\\d{2,3}(?:\\.\\d+)?)\\b`,
        'i',
      ),
    ) ||
    text.match(/\b(\d{2,3}(?:\.\d+)?)\s*(?:°\s*[fc]|degrees)\b/i);
  if (tempMatch) out.body_temperature = Number(tempMatch[1]);

  return Object.keys(out).length > 0 ? out : null;
}

export function countVitalsArgs(args: HypotheticalVitalsArgs | null | undefined): number {
  if (!args) return 0;
  return Object.values(args).filter((v) => typeof v === 'number' && Number.isFinite(v)).length;
}

export function formatVitalsArgsSummary(args: HypotheticalVitalsArgs): string {
  const parts: string[] = [];
  if (args.blood_oxygen != null) parts.push(`SpO2 ${args.blood_oxygen}%`);
  if (args.heart_rate != null) parts.push(`HR ${args.heart_rate} bpm`);
  if (args.respiratory_rate != null) parts.push(`RR ${args.respiratory_rate}`);
  if (args.blood_pressure_systolic != null && args.blood_pressure_diastolic != null) {
    parts.push(`BP ${args.blood_pressure_systolic}/${args.blood_pressure_diastolic}`);
  }
  if (args.glucose_level != null) parts.push(`glucose ${args.glucose_level}`);
  if (args.body_temperature != null) parts.push(`temp ${args.body_temperature}`);
  return parts.join(', ') || 'proposed vitals';
}

/**
 * Resolve candidate tool args from model ACTION and/or user NLP.
 * Never executes ML — only prepares args for a confirm UI.
 */
export function resolveHypotheticalVitalsCandidate(
  userText: string,
  modelText: string,
): HypotheticalVitalsArgs | null {
  const fromAction = parseEvaluateHypotheticalAction(modelText);
  if (fromAction && countVitalsArgs(fromAction) >= 1) return fromAction;

  if (hasVitalsOrWhatIfIntent(userText)) {
    const fromUser = extractVitalsFromUserText(userText);
    if (fromUser && countVitalsArgs(fromUser) >= 1) return fromUser;
  }
  return null;
}
