import elenaGarciaFhirBundle from '@/data/fhir/fixtures/elena-garcia-fhir-bundle.json';
import {
  mapFhirBundleToOnboardingImport,
  type FhirBundle,
  type FhirOnboardingImport,
  type NormalizedFhirClinicalImportPackage,
} from '@/data/fhir';
import type { IcdConditionProfile } from './onboardingService';

export type OnboardingFhirImportPatch = Omit<
  FhirOnboardingImport,
  'primaryCondition' | 'comorbidities'
> & {
  primaryCondition?: IcdConditionProfile;
  comorbidities: IcdConditionProfile[];
};

export interface OnboardingFhirImportResult {
  onboardingPatch: OnboardingFhirImportPatch;
  clinicalImport: NormalizedFhirClinicalImportPackage;
}

export function getElenaGarciaFhirOnboardingImport(): OnboardingFhirImportResult {
  const mapped = mapFhirBundleToOnboardingImport(elenaGarciaFhirBundle as FhirBundle);

  return {
    onboardingPatch: {
      ...mapped.onboardingPatch,
      primaryCondition: toIcdCondition(mapped.onboardingPatch.primaryCondition, true),
      comorbidities: mapped.onboardingPatch.comorbidities
        .map((condition) => toIcdCondition(condition, false))
        .filter((condition): condition is IcdConditionProfile =>
          Boolean(condition),
        ),
    },
    clinicalImport: mapped.clinicalImport,
  };
}

function toIcdCondition(
  condition: FhirOnboardingImport['primaryCondition'],
  isPrimary: boolean,
): IcdConditionProfile | undefined {
  if (!condition?.code) return undefined;

  return {
    code: condition.code,
    label: condition.label,
    category: condition.category,
    isPrimary,
  };
}
