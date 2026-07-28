/**
 * Prompt builder for Home / alert-detail Concierge explain (SlmInsightSheet).
 * Keeps the caregiver on the per-alert screen; the sheet streams on top.
 */

export type AlertExplainPromptInput = {
  title: string;
  body: string | null | undefined;
  severity: 1 | 2 | 3;
  status: string;
  createdAt: string;
  mlScore?: number | null;
  initialAnomalyType?: string | null;
  postHitlAnomalyType?: string | null;
  topFeatures?: ({ feature?: string; name?: string; importance?: number } | [string, number])[];
  rawVitals?: Record<string, unknown> | null;
  observationCodes?: string[];
  recentSpo2?: { value: number }[];
  recentHr?: { value: number }[];
};

function formatFeature(
  item: { feature?: string; name?: string; importance?: number } | [string, number],
): string | null {
  if (Array.isArray(item)) {
    const [name, importance] = item;
    if (!name) return null;
    return importance != null
      ? `- ${String(name).replace(/_/g, ' ')} (${Number(importance).toFixed(2)})`
      : `- ${String(name).replace(/_/g, ' ')}`;
  }
  const name = item.feature ?? item.name;
  if (!name) return null;
  return item.importance != null
    ? `- ${String(name).replace(/_/g, ' ')} (${Number(item.importance).toFixed(2)})`
    : `- ${String(name).replace(/_/g, ' ')}`;
}

function coerceVitalsMap(raw: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  // Match Home critical-alert metrics: unwrap AppleWatchVitalsInput envelope.
  const maybeEnvelope = raw as { contract?: unknown; input?: unknown };
  const source =
    maybeEnvelope.contract === 'AppleWatchVitalsInput' &&
    maybeEnvelope.input &&
    typeof maybeEnvelope.input === 'object'
      ? (maybeEnvelope.input as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function formatVitals(raw: Record<string, unknown> | null | undefined): string {
  const map = coerceVitalsMap(raw);
  const lines = Object.entries(map).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`);
  return lines.length ? lines.join('\n') : '';
}

export function buildAlertExplainPrompt(input: AlertExplainPromptInput): string {
  const anomaly =
    input.postHitlAnomalyType || input.initialAnomalyType
      ? String(input.postHitlAnomalyType || input.initialAnomalyType)
          .replace(/_/g, ' ')
          .toLowerCase()
      : null;

  const featureLines = (input.topFeatures ?? [])
    .slice(0, 8)
    .map(formatFeature)
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const vitalsBlock = formatVitals(input.rawVitals);
  const obs =
    input.observationCodes && input.observationCodes.length > 0
      ? input.observationCodes.map((c) => c.replace(/_/g, ' ').toLowerCase()).join(', ')
      : null;

  const spo2Series =
    input.recentSpo2 && input.recentSpo2.length > 0
      ? input.recentSpo2.map((s) => s.value).join(', ')
      : null;
  const hrSeries =
    input.recentHr && input.recentHr.length > 0
      ? input.recentHr.map((s) => s.value).join(', ')
      : null;

  return [
    'Explain this Health Monitor alert to me in plain language.',
    'Lead with what I should do, then why, then what to watch. Do not diagnose.',
    'Do not invent vitals or scores that are not listed below.',
    '',
    `Alert title: ${input.title}`,
    input.body ? `Alert body: ${input.body}` : '',
    `Severity: ${input.severity} · Status: ${input.status}`,
    `Created: ${input.createdAt}`,
    input.mlScore != null && Number.isFinite(input.mlScore)
      ? `Monitor score: ${Number(input.mlScore).toFixed(3)}`
      : '',
    anomaly ? `Pattern label: ${anomaly}` : '',
    featureLines ? `\nTop contributing signals:\n${featureLines}` : '',
    vitalsBlock ? `\nVitals on this alert:\n${vitalsBlock}` : '',
    spo2Series ? `Recent SpO₂ readings: ${spo2Series}` : '',
    hrSeries ? `Recent heart-rate readings: ${hrSeries}` : '',
    obs ? `Caregiver observations already logged: ${obs}` : '',
    '',
    'If severity is 3, remind me this is urgent and that Call 911 / Go to ER are available on this screen — do not delay for chat.',
    'End with 1–3 concrete next steps I can take at home or with the care team.',
  ]
    .filter(Boolean)
    .join('\n');
}
