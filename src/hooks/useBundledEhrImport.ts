import { useCallback } from "react";

import {
  refreshPatientRecord,
  usePatientRecord,
} from "@/contexts/patient-record-context";
import {
  getPatient,
  type Patient,
} from "@/data";
import type { PatientProfileEntry } from "@/data/fhir/patient-profiles";
import { useTranslation } from "@/hooks/use-translation";
import { dispatchImmediate } from "@/services/notifications";
import { useAppDispatch } from "@/store/hooks";
import { addPatient } from "@/store/reducers/patientSlice";

type PrepareImportedPatientContext = {
  profile: PatientProfileEntry;
  fhirBundle: unknown;
  patientId: string;
  patient: Patient | null;
};

type PrepareImportedPatientResult =
  | {
      bundleLocation?: string;
    }
  | void;

type ImportBundledEhrProfileOptions = {
  prepareImportedPatient?: (
    context: PrepareImportedPatientContext,
  ) => PrepareImportedPatientResult | Promise<PrepareImportedPatientResult>;
};

export type BundledEhrImportResult = {
  profile: PatientProfileEntry;
  patientId: string | null;
  patient: Patient | null;
  bundleLocation?: string;
};

function startBundledEhrKnowledgeBundle(params: {
  patientId: string;
  location?: string;
}): void {
  const { patientId, location } = params;

  void import("@/clinical-evidence/knowledge-bundle-runner")
    .then(({ runKnowledgeBundle }) =>
      runKnowledgeBundle(patientId, { location, reason: "import" }),
    )
    .catch((error) => {
      console.error("[useBundledEhrImport] knowledge bundle failed:", error);
    })
    .finally(() => {
      try {
        refreshPatientRecord(patientId);
      } catch (error) {
        console.error("Failed to refresh patient after clinical bundling", error);
      }
    });
}

export function useBundledEhrImport() {
  const dispatch = useAppDispatch();
  const { importFHIRBundle } = usePatientRecord();
  const { t } = useTranslation();

  const importBundledEhrProfile = useCallback(
    async (
      profile: PatientProfileEntry,
      options: ImportBundledEhrProfileOptions = {},
    ): Promise<BundledEhrImportResult> => {
      const fhirBundle = profile.data;
      const importedPatientId = importFHIRBundle(fhirBundle);
      dispatch(addPatient(fhirBundle));

      if (!importedPatientId) {
        return {
          profile,
          patientId: null,
          patient: null,
        };
      }

      const importedPatient = getPatient(importedPatientId);
      let bundleLocation = importedPatient?.location;

      const prepared = await options.prepareImportedPatient?.({
        profile,
        fhirBundle,
        patientId: importedPatientId,
        patient: importedPatient,
      });

      if (prepared && "bundleLocation" in prepared) {
        bundleLocation = prepared.bundleLocation;
      }

      refreshPatientRecord(importedPatientId);

      startBundledEhrKnowledgeBundle({
        patientId: importedPatientId,
        location: bundleLocation,
      });

      await dispatchImmediate({
        patientId: importedPatientId,
        scope: "care_task",
        title: t("ehrImport.banner.title"),
        body: t("ehrImport.banner.body", { profile: profile.label }),
        severity: 1,
      });

      return {
        profile,
        patientId: importedPatientId,
        patient: importedPatient,
        bundleLocation,
      };
    },
    [dispatch, importFHIRBundle, t],
  );

  return { importBundledEhrProfile };
}
