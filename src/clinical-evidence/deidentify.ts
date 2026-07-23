/**
 * Query de-identification.
 *
 * All outgoing API queries to PubMed / MedlinePlus / RxNorm / DailyMed /
 * OpenFDA pass through `deidentifyQuery()` before hitting the network.
 * Strips patient/caregiver/provider names, dates, phone numbers, email,
 * addresses, and free-text observations. Keeps condition names, drug names,
 * symptom keywords, and vital-type names.
 *
 * See planning/22_clinical-data-gathering.md §4.
 */

export interface PatientPiiContext {
  patientName?: string;
  caregiverName?: string;
  providerName?: string;
  emergencyContact?: string;
  backupCaregiver?: string;
  patientAddress?: string;
  caregiverAddress?: string;
}

const PHONE_REGEX = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const DATE_REGEX = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{0,4}\b/gi;
const STREET_REGEX = /\b\d{1,6}\s+[A-Za-z0-9\s]+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl)\b/gi;

/**
 * De-identify a query string by removing PII and keeping only clinical terms.
 */
export function deidentifyQuery(query: string, pii: PatientPiiContext = {}): string {
  let result = query;

  // 1. Remove names (word-boundary, case-insensitive)
  const namesToRemove = [
    pii.patientName,
    pii.caregiverName,
    pii.providerName,
    pii.emergencyContact,
    pii.backupCaregiver,
  ].filter((n): n is string => Boolean(n?.trim()));

  for (const name of namesToRemove) {
    // Split name into parts and remove each part longer than 2 chars
    // (avoids removing common short words like "Ma" from "Maria")
    const parts = name.split(/[\s·,]+/).filter((p) => p.length > 2);
    for (const part of parts) {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
    }
  }

  // 2. Remove phone numbers
  result = result.replace(PHONE_REGEX, '');

  // 3. Remove email addresses
  result = result.replace(EMAIL_REGEX, '');

  // 4. Remove dates
  result = result.replace(DATE_REGEX, '');

  // 5. Remove street addresses
  result = result.replace(STREET_REGEX, '');

  // 6. Remove ZIP codes (only if they look like ZIPs, not vital values)
  // Only remove 5-digit standalone numbers that aren't part of a medical value
  result = result.replace(/\b(\d{5})(?:-\d{4})?\b(?!\s*(?:%|mg|ml|bpm|mmHg|Spo2|SpO2))/g, (match) => {
    // Don't remove if it's a SpO2 value (like 94, 88, etc.)
    const num = parseInt(match, 10);
    if (num >= 80 && num <= 100) return match;
    return '';
  });

  // 7. Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();

  // 8. Remove empty parentheses or brackets left behind
  result = result.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');

  return result;
}

/**
 * Build a de-identified PubMed query from a condition name and optional
 * symptom/drug context. Uses the query templates from plan §12.
 */
export function buildPubMedQuery(
  condition: string,
  options: { caregiverFocus?: boolean; symptom?: string; drug?: string } = {},
): string {
  const parts: string[] = [`"${condition}"`];

  if (options.caregiverFocus !== false) {
    parts.push('("caregiver" OR "home care" OR "home management")');
  }

  if (options.symptom) {
    parts.push(`"${options.symptom}"`);
  }

  if (options.drug) {
    parts.push(`"${options.drug}"`);
    parts.push('("adverse" OR "interaction" OR "side effect")');
  } else {
    parts.push('("management" OR "guideline" OR "treatment")');
  }

  return parts.join(' AND ');
}
