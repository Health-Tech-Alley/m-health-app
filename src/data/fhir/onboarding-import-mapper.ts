import { ICD10_URI } from './codes';
import type {
  FhirBundle,
  FhirCoding,
  FhirCondition,
  FhirExtension,
  FhirHumanName,
  FhirMedicationRequest,
  FhirObservation,
  FhirPatient,
} from './types';

export interface FhirImportedCondition {
  code?: string;
  label: string;
  category?: string;
  isPrimary?: boolean;
}

export interface FhirOnboardingImport {
  officialFirstName?: string;
  officialLastName?: string;
  officialDisplayName?: string;
  patientAge?: string;
  baselineDailyRoutine?: string;
  currentMedications?: string;
  spo2Cutoff?: string;
  baselineHeartRate?: string;
  gmfcsLevel?: string;
  macsLevel?: string;
  cfcsLevel?: string;
  edacsLevel?: string;
  primaryCondition?: FhirImportedCondition;
  comorbidities: FhirImportedCondition[];
}

export interface NormalizedFhirMedicationRequest {
  resourceId: string;
  status: FhirMedicationRequest['status'];
  name?: string;
  route?: string;
  timing?: string;
  rawResource: FhirMedicationRequest;
}

export interface NormalizedFhirCondition {
  resourceId: string;
  code?: string;
  label: string;
  onsetDateTime?: string;
  rawResource: FhirCondition;
}

export interface NormalizedFhirClinicalImportPackage {
  source: {
    bundleId?: string;
    bundleType: FhirBundle['type'];
    timestamp?: string;
  };
  patient?: {
    resourceId: string;
    officialFirstName?: string;
    officialLastName?: string;
    officialDisplayName?: string;
    birthDate?: string;
    gender?: FhirPatient['gender'];
  };
  conditions: NormalizedFhirCondition[];
  activeMedicationRequests: NormalizedFhirMedicationRequest[];
  observations: {
    resourceId: string;
    effectiveDateTime?: string;
    rawResource: FhirObservation;
  }[];
}

export interface FhirOnboardingImportResult {
  onboardingPatch: FhirOnboardingImport;
  clinicalImport: NormalizedFhirClinicalImportPackage;
}

const EXTENSION_URLS = {
  age: 'age',
  baselineDailyRoutine: 'baseline-daily-routine',
  currentMedications: 'current-medications',
  spo2Cutoff: 'spo2-cutoff',
  baselineHeartRate: 'baseline-heart-rate',
  gmfcsLevel: 'gmfcs',
  macsLevel: 'macs',
  cfcsLevel: 'cfcs',
  edacsLevel: 'edacs',
} as const;

export function mapFhirBundleToOnboardingImport(
  bundle: FhirBundle,
): FhirOnboardingImportResult {
  const resources = bundle.entry
    .map((entry) => entry.resource)
    .filter((resource): resource is unknown =>
      Boolean(resource && typeof resource === 'object'),
    );

  const patient = resources.find(isFhirPatient);
  const conditions = resources.filter(isFhirCondition);
  const medications = resources.filter(isFhirMedicationRequest);
  const observations = resources.filter(isFhirObservation);
  const officialName = patient ? formatOfficialName(patient.name[0]) : {};

  const mappedConditions = dedupeConditions(
    conditions
      .map(mapCondition)
      .filter((condition): condition is FhirImportedCondition =>
        Boolean(condition?.label),
      ),
  );
  const primaryCondition = mappedConditions[0];
  const comorbidities = mappedConditions
    .slice(1)
    .map((condition) => ({ ...condition, isPrimary: false }));

  const extensionMedications = splitMedicationList(
    getPatientExtensionValue(patient, EXTENSION_URLS.currentMedications),
  );
  const medicationRequestNames = medications
    .filter((medication) => medication.status === 'active')
    .map((medication) => medication.medicationCodeableConcept?.text)
    .filter((name): name is string => Boolean(name?.trim()));

  return {
    onboardingPatch: {
      officialFirstName: officialName.firstName,
      officialLastName: officialName.lastName,
      officialDisplayName: officialName.displayName,
      patientAge:
        getPatientExtensionValue(patient, EXTENSION_URLS.age) ??
        ageFromBirthDate(patient?.birthDate),
      baselineDailyRoutine: getPatientExtensionValue(
        patient,
        EXTENSION_URLS.baselineDailyRoutine,
      ),
      currentMedications: mergeMedicationNames([
        ...medicationRequestNames,
        ...extensionMedications,
      ]),
      spo2Cutoff: getPatientExtensionValue(patient, EXTENSION_URLS.spo2Cutoff),
      baselineHeartRate: getPatientExtensionValue(
        patient,
        EXTENSION_URLS.baselineHeartRate,
      ),
      gmfcsLevel: getPatientExtensionValue(patient, EXTENSION_URLS.gmfcsLevel),
      macsLevel: getPatientExtensionValue(patient, EXTENSION_URLS.macsLevel),
      cfcsLevel: getPatientExtensionValue(patient, EXTENSION_URLS.cfcsLevel),
      edacsLevel: getPatientExtensionValue(patient, EXTENSION_URLS.edacsLevel),
      primaryCondition: primaryCondition
        ? { ...primaryCondition, isPrimary: true }
        : undefined,
      comorbidities,
    },
    clinicalImport: {
      source: {
        bundleId: bundle.id,
        bundleType: bundle.type,
        timestamp: bundle.timestamp,
      },
      patient: patient
        ? {
            resourceId: patient.id,
            officialFirstName: officialName.firstName,
            officialLastName: officialName.lastName,
            officialDisplayName: officialName.displayName,
            birthDate: patient.birthDate,
            gender: patient.gender,
          }
        : undefined,
      conditions: conditions
        .map(toNormalizedCondition)
        .filter((condition): condition is NormalizedFhirCondition =>
          Boolean(condition),
        ),
      activeMedicationRequests: medications
        .filter((medication) => medication.status === 'active')
        .map((medication) => ({
          resourceId: medication.id,
          status: medication.status,
          name: medication.medicationCodeableConcept?.text,
          route: medication.dosageInstruction?.[0]?.route?.text,
          timing: medication.dosageInstruction?.[0]?.timing?.code?.text,
          rawResource: medication,
        })),
      observations: observations.map((observation) => ({
        resourceId: observation.id,
        effectiveDateTime: observation.effectiveDateTime,
        rawResource: observation,
      })),
    },
  };
}

function isFhirPatient(resource: unknown): resource is FhirPatient {
  if (!isResource(resource)) return false;
  return resource.resourceType === 'Patient' && Array.isArray(resource.name);
}

function isFhirCondition(
  resource: unknown,
): resource is FhirCondition {
  if (!isResource(resource)) return false;
  return resource.resourceType === 'Condition';
}

function isFhirMedicationRequest(
  resource: unknown,
): resource is FhirMedicationRequest {
  if (!isResource(resource)) return false;
  return resource.resourceType === 'MedicationRequest';
}

function isFhirObservation(resource: unknown): resource is FhirObservation {
  if (!isResource(resource)) return false;
  return resource.resourceType === 'Observation';
}

function isResource(resource: unknown): resource is { resourceType?: unknown; name?: unknown } {
  return Boolean(resource && typeof resource === 'object');
}

function getPatientExtensionValue(
  patient: FhirPatient | undefined,
  urlSuffix: string,
): string | undefined {
  const extension = patient?.extension?.find((item: FhirExtension) =>
    item.url.endsWith(urlSuffix),
  );
  const value = extension?.valueString?.trim();
  return value || undefined;
}

function formatHumanName(name: FhirHumanName | undefined): string | undefined {
  if (!name) return undefined;
  const text = name.text?.trim();
  if (text) return text;
  const parts = [...(name.given ?? []), name.family]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function formatOfficialName(name: FhirHumanName | undefined): {
  firstName?: string;
  lastName?: string;
  displayName?: string;
} {
  const displayName = formatHumanName(name);
  return {
    firstName: name?.given?.find((part) => Boolean(part.trim()))?.trim(),
    lastName: name?.family?.trim() || undefined,
    displayName,
  };
}

function mapCondition(
  condition: FhirCondition,
): FhirImportedCondition | undefined {
  const coding = pickIcdCoding(condition.code?.coding ?? []);
  const label =
    coding?.display?.trim() ||
    condition.code?.text?.trim() ||
    condition.id?.trim();

  if (!label) return undefined;

  return {
    code: coding?.code?.trim(),
    label,
    category: coding?.display ? undefined : condition.code?.text,
  };
}

function toNormalizedCondition(
  condition: FhirCondition,
): NormalizedFhirCondition | undefined {
  const mapped = mapCondition(condition);
  if (!mapped) return undefined;

  return {
    resourceId: condition.id,
    code: mapped.code,
    label: mapped.label,
    onsetDateTime: condition.onsetDateTime,
    rawResource: condition,
  };
}

function pickIcdCoding(codings: FhirCoding[]): FhirCoding | undefined {
  return (
    codings.find((coding) => coding.system === ICD10_URI) ??
    codings.find((coding) => coding.code?.trim())
  );
}

function dedupeConditions(
  conditions: FhirImportedCondition[],
): FhirImportedCondition[] {
  const seenCodes = new Set<string>();
  const seenLabels = new Set<string>();

  return conditions.filter((condition) => {
    const codeKey = normalizeIcdCodeForComparison(condition.code);
    const labelKey = normalizeKey(condition.label);
    const duplicate =
      (codeKey && seenCodes.has(codeKey)) ||
      (!codeKey && labelKey && seenLabels.has(labelKey));

    if (duplicate) return false;
    if (codeKey) seenCodes.add(codeKey);
    if (labelKey) seenLabels.add(labelKey);
    return true;
  });
}

function splitMedicationList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeMedicationNames(names: string[]): string | undefined {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const name of names) {
    const key = medicationDedupeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(name.trim());
  }

  return merged.length > 0 ? merged.join(', ') : undefined;
}

function medicationDedupeKey(value: string): string {
  const normalized = normalizeKey(value);
  return normalized.split(' ')[0] ?? normalized;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeIcdCodeForComparison(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return trimmed.match(/[A-Z][0-9][A-Z0-9.]*/i)?.[0].toUpperCase() ?? '';
}

function ageFromBirthDate(birthDate: string | undefined): string | undefined {
  if (!birthDate) return undefined;
  const date = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;

  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const birthdayThisYear = Date.UTC(
    now.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  if (Date.now() < birthdayThisYear) age -= 1;

  return age >= 0 && age <= 130 ? String(age) : undefined;
}
