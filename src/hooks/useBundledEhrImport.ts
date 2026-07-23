import { useCallback } from "react";

import {
  refreshPatientRecord,
  usePatientRecord,
} from "@/contexts/patient-record-context";
import {
  getPatient,
  setBundlePending,
  setBundleStatus,
  type Patient,
} from "@/data";
import type { PatientProfileEntry } from "@/data/fhir/patient-profiles";
import { emitInAppBanner } from "@/services/notifications";
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

  setBundlePending(patientId, true);
  setBundleStatus(patientId, { state: "in_flight", chunksAdded: 0 });

  void import("@/clinical-evidence/condition-bundler")
    .then(
      async ({
        bundleConditionPack,
        bundleMedicationPack,
        bundleSdohPack,
      }) => {
        const bundleTasks = [
          bundleConditionPack(patientId).catch((error) => {
            console.error("[useBundledEhrImport] condition bundle failed:", error);
          }),
          bundleMedicationPack(patientId).catch((error) => {
            console.error("[useBundledEhrImport] medication bundle failed:", error);
          }),
          bundleSdohPack(patientId, location).catch((error) => {
            console.error("[useBundledEhrImport] SDOH bundle failed:", error);
          }),
        ];

        await Promise.all(bundleTasks);
      },
    )
    .catch((error) => {
      console.error("[useBundledEhrImport] Failed to load condition-bundler:", error);
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

      emitInAppBanner({
        title: "EHR Import",
        body: `FHIR bundle "${profile.label}" imported successfully`,
        severity: 1,
      });

      return {
        profile,
        patientId: importedPatientId,
        patient: importedPatient,
        bundleLocation,
      };
    },
    [dispatch, importFHIRBundle],
  );

  return { importBundledEhrProfile };
}
