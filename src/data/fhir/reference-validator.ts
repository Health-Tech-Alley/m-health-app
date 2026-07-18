export type FhirReferenceIssueCode =
  | 'NOT_A_BUNDLE'
  | 'INVALID_BUNDLE_TYPE'
  | 'MISSING_ENTRY_RESOURCE'
  | 'MISSING_ENTRY_RESOURCE_TYPE'
  | 'MISSING_ENTRY_FULL_URL'
  | 'DUPLICATE_FULL_URL'
  | 'MISSING_PATIENT'
  | 'MULTIPLE_PATIENTS'
  | 'MISSING_PATIENT_ID'
  | 'DUPLICATE_RESOURCE_IDENTITY'
  | 'NONCANONICAL_LOCAL_REFERENCE'
  | 'BROKEN_LOCAL_REFERENCE'
  | 'AMBIGUOUS_LOCAL_REFERENCE'
  | 'BROKEN_CONTAINED_REFERENCE'
  | 'AMBIGUOUS_CONTAINED_REFERENCE';

export type FhirReferenceClassification =
  | 'valid_contained_reference'
  | 'valid_exact_in_bundle_reference'
  | 'valid_external_absolute_reference'
  | 'noncanonical_but_resolvable_local_reference'
  | 'broken_local_reference'
  | 'ambiguous_local_reference';

export type FhirReferenceIssue = {
  code: FhirReferenceIssueCode;
  message: string;
  entryIndex?: number;
  sourceResourceType?: string;
  sourceResourceId?: string;
  path?: string;
  reference?: string;
  targetFullUrl?: string;
};

export type FhirReferenceRecord = {
  classification: FhirReferenceClassification;
  entryIndex: number;
  sourceResourceType?: string;
  sourceResourceId?: string;
  path: string;
  reference: string;
  targetFullUrl?: string;
};

export type FhirBundleReferenceValidationOptions = {
  requireCanonicalLocalReferences?: boolean;
};

export type FhirBundleReferenceValidationResult = {
  valid: boolean;
  issues: FhirReferenceIssue[];
  references: FhirReferenceRecord[];
};

type ReferenceTarget = {
  fullUrl: string;
  resourceType: string;
  id?: string;
};

export class FhirReferenceIntegrityError extends Error {
  readonly issues: FhirReferenceIssue[];

  constructor(issues: FhirReferenceIssue[]) {
    super(formatReferenceIntegrityMessage(issues));
    this.name = 'FhirReferenceIntegrityError';
    this.issues = issues;
  }
}

export function validateFhirBundleReferences(
  bundle: unknown,
  options: FhirBundleReferenceValidationOptions = {},
): FhirBundleReferenceValidationResult {
  const requireCanonicalLocalReferences = options.requireCanonicalLocalReferences ?? true;
  const issues: FhirReferenceIssue[] = [];
  const references: FhirReferenceRecord[] = [];

  if (!isRecord(bundle) || bundle.resourceType !== 'Bundle') {
    return {
      valid: false,
      issues: [
        {
          code: 'NOT_A_BUNDLE',
          message: 'FHIR import expected a Bundle resource.',
          path: 'Bundle.resourceType',
        },
      ],
      references,
    };
  }

  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  const fullUrlTargets = new Map<string, ReferenceTarget>();
  const localTargets = new Map<string, ReferenceTarget[]>();
  const seenFullUrls = new Map<string, number>();
  const seenResourceIdentities = new Map<string, number>();
  const patientEntries: { entryIndex: number; id?: string }[] = [];

  if (bundle.type !== 'collection') {
    issues.push({
      code: 'INVALID_BUNDLE_TYPE',
      message: 'FHIR import expected a Bundle with type "collection".',
      path: 'Bundle.type',
    });
  }

  entries.forEach((entry, entryIndex) => {
    if (!isRecord(entry) || !isRecord(entry.resource)) {
      issues.push({
        code: 'MISSING_ENTRY_RESOURCE',
        message: `Bundle entry ${entryIndex} does not contain a resource.`,
        entryIndex,
        path: `Bundle.entry[${entryIndex}].resource`,
      });
      return;
    }

    const fullUrl = typeof entry.fullUrl === 'string' ? entry.fullUrl.trim() : '';
    const resourceType =
      typeof entry.resource.resourceType === 'string' ? entry.resource.resourceType : undefined;
    const id = typeof entry.resource.id === 'string' ? entry.resource.id.trim() : undefined;

    if (!resourceType) {
      issues.push({
        code: 'MISSING_ENTRY_RESOURCE_TYPE',
        message: `Bundle entry ${entryIndex} resource does not contain a resourceType.`,
        entryIndex,
        path: `Bundle.entry[${entryIndex}].resource.resourceType`,
      });
    }

    if (resourceType === 'Patient') {
      patientEntries.push({ entryIndex, id });
      if (!id) {
        issues.push({
          code: 'MISSING_PATIENT_ID',
          message: `Patient resource in Bundle entry ${entryIndex} does not contain a nonempty id.`,
          entryIndex,
          sourceResourceType: resourceType,
          path: `Bundle.entry[${entryIndex}].resource.id`,
        });
      }
    }

    if (!fullUrl) {
      issues.push({
        code: 'MISSING_ENTRY_FULL_URL',
        message: `Bundle entry ${entryIndex} does not contain a nonempty fullUrl.`,
        entryIndex,
        sourceResourceType: resourceType,
        sourceResourceId: id,
        path: `Bundle.entry[${entryIndex}].fullUrl`,
      });
      return;
    }

    const firstSeenAt = seenFullUrls.get(fullUrl);
    if (firstSeenAt !== undefined) {
      issues.push({
        code: 'DUPLICATE_FULL_URL',
        message: `Bundle entry ${entryIndex} duplicates fullUrl from entry ${firstSeenAt}.`,
        entryIndex,
        sourceResourceType: resourceType,
        sourceResourceId: id,
        path: `Bundle.entry[${entryIndex}].fullUrl`,
        reference: fullUrl,
      });
      return;
    }
    seenFullUrls.set(fullUrl, entryIndex);

    const target = resourceType ? { fullUrl, resourceType, id } : null;
    if (target) {
      fullUrlTargets.set(fullUrl, target);
    }

    if (target && id) {
      const resourceIdentity = `${resourceType}/${id}`;
      const firstSeenAt = seenResourceIdentities.get(resourceIdentity);
      if (firstSeenAt !== undefined) {
        issues.push({
          code: 'DUPLICATE_RESOURCE_IDENTITY',
          message: `Bundle entry ${entryIndex} duplicates resource identity ${resourceIdentity} from entry ${firstSeenAt}.`,
          entryIndex,
          sourceResourceType: resourceType,
          sourceResourceId: id,
          path: `Bundle.entry[${entryIndex}].resource.id`,
          reference: resourceIdentity,
        });
      } else {
        seenResourceIdentities.set(resourceIdentity, entryIndex);
      }

      addLocalTarget(localTargets, `${resourceType}/${id}`, target);
      addLocalTarget(localTargets, `urn:uuid:${id}`, target);
    }
  });

  if (patientEntries.length === 0) {
    issues.push({
      code: 'MISSING_PATIENT',
      message: 'FHIR import expected exactly one Patient resource in the Bundle.',
      path: 'Bundle.entry',
    });
  } else if (patientEntries.length > 1) {
    patientEntries.forEach((patientEntry) => {
      issues.push({
        code: 'MULTIPLE_PATIENTS',
        message: 'FHIR import expected exactly one Patient resource in the Bundle.',
        entryIndex: patientEntry.entryIndex,
        sourceResourceType: 'Patient',
        sourceResourceId: patientEntry.id,
        path: `Bundle.entry[${patientEntry.entryIndex}].resource`,
      });
    });
  }

  entries.forEach((entry, entryIndex) => {
    if (!isRecord(entry) || !isRecord(entry.resource)) return;
    const resource = entry.resource;
    const sourceResourceType =
      typeof resource.resourceType === 'string' ? resource.resourceType : undefined;
    const sourceResourceId = typeof resource.id === 'string' ? resource.id : undefined;

    walkReferenceValues(resource, `Bundle.entry[${entryIndex}].resource`, (reference, path) => {
      const recordBase = {
        entryIndex,
        sourceResourceType,
        sourceResourceId,
        path,
        reference,
      };

      if (reference.startsWith('#')) {
        const containedId = reference.slice(1);
        const containedMatches = getContainedReferences(resource, containedId);

        if (containedMatches.length === 1) {
          references.push({ ...recordBase, classification: 'valid_contained_reference' });
          return;
        }

        if (containedMatches.length > 1) {
          references.push({ ...recordBase, classification: 'ambiguous_local_reference' });
          issues.push({
            code: 'AMBIGUOUS_CONTAINED_REFERENCE',
            message: `Contained reference ${reference} matches more than one contained resource.`,
            ...recordBase,
          });
          return;
        }

        references.push({ ...recordBase, classification: 'broken_local_reference' });
        issues.push({
          code: 'BROKEN_CONTAINED_REFERENCE',
          message: `Contained reference ${reference} does not resolve within the source resource.`,
          ...recordBase,
        });
        return;
      }

      const exactTarget = fullUrlTargets.get(reference);
      if (exactTarget) {
        references.push({
          ...recordBase,
          classification: 'valid_exact_in_bundle_reference',
          targetFullUrl: exactTarget.fullUrl,
        });
        return;
      }

      const localMatches = localTargets.get(reference);
      if (localMatches && localMatches.length === 1) {
        const target = localMatches[0];
        references.push({
          ...recordBase,
          classification: 'noncanonical_but_resolvable_local_reference',
          targetFullUrl: target.fullUrl,
        });
        if (requireCanonicalLocalReferences) {
          issues.push({
            code: 'NONCANONICAL_LOCAL_REFERENCE',
            message: `Reference ${reference} resolves to ${target.fullUrl}; store the exact fullUrl.`,
            ...recordBase,
            targetFullUrl: target.fullUrl,
          });
        }
        return;
      }

      if (localMatches && localMatches.length > 1) {
        references.push({ ...recordBase, classification: 'ambiguous_local_reference' });
        issues.push({
          code: 'AMBIGUOUS_LOCAL_REFERENCE',
          message: `Reference ${reference} matches more than one Bundle entry.`,
          ...recordBase,
        });
        return;
      }

      if (isExternalAbsoluteReference(reference)) {
        references.push({ ...recordBase, classification: 'valid_external_absolute_reference' });
        return;
      }

      references.push({ ...recordBase, classification: 'broken_local_reference' });
      issues.push({
        code: 'BROKEN_LOCAL_REFERENCE',
        message: `Reference ${reference} does not resolve to any Bundle entry.`,
        ...recordBase,
      });
    });
  });

  return {
    valid: issues.length === 0,
    issues,
    references,
  };
}

export function assertFhirBundleReferenceIntegrity(
  bundle: unknown,
  options: FhirBundleReferenceValidationOptions = {},
): void {
  const result = validateFhirBundleReferences(bundle, options);
  if (!result.valid) {
    throw new FhirReferenceIntegrityError(result.issues);
  }
}

function addLocalTarget(
  targets: Map<string, ReferenceTarget[]>,
  key: string,
  target: ReferenceTarget,
): void {
  const existing = targets.get(key);
  if (existing) {
    existing.push(target);
  } else {
    targets.set(key, [target]);
  }
}

function getContainedReferences(resource: Record<string, any>, id: string): Record<string, any>[] {
  if (!Array.isArray(resource.contained)) return [];

  return resource.contained.filter(
    (containedResource) => isRecord(containedResource) && containedResource.id === id,
  );
}

function walkReferenceValues(
  value: unknown,
  path: string,
  onReference: (reference: string, path: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkReferenceValues(item, `${path}[${index}]`, onReference));
    return;
  }

  if (!isRecord(value)) return;

  Object.entries(value).forEach(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (key === 'reference' && typeof child === 'string' && child.trim()) {
      onReference(child, childPath);
    }
    walkReferenceValues(child, childPath, onReference);
  });
}

function isExternalAbsoluteReference(reference: string): boolean {
  return !reference.startsWith('urn:uuid:') && /^[a-z][a-z0-9+.-]*:/i.test(reference);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatReferenceIntegrityMessage(issues: FhirReferenceIssue[]): string {
  const issueCount = issues.length;
  const preview = issues
    .slice(0, 3)
    .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}`)
    .join('; ');
  return `FHIR Bundle reference validation failed with ${issueCount} issue${
    issueCount === 1 ? '' : 's'
  }${preview ? `: ${preview}` : ''}`;
}
