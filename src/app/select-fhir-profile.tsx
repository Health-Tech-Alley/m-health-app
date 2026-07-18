import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import {
  refreshPatientRecord,
  usePatientRecord,
} from "@/contexts/patient-record-context";
import {
  getPatient,
  setBundlePending,
  setBundleStatus,
  upsertCaregiver,
  upsertPatient,
} from "@/data";
import { mapFhirBundleToOnboardingImport } from "@/data/fhir/onboarding-import-mapper";
import { shouldBundleHedisMeasures } from "@/data/seed/seedFromProfile";
import { emitInAppBanner } from "@/services/notifications";
import {
  getOnboardingProfile,
  saveOnboardingProfile,
  type OnboardingProfile,
} from "@/services/onboarding/onboardingService";
import { prepareExplicitDemoOnboardingForImportedProfile } from "@/services/onboarding/demoOnboardingPresets";
import { useAppDispatch } from "@/store/hooks";
import { addPatient } from "@/store/reducers/patientSlice";

// Manifest of bundled sample FHIR patient profiles.
// Add an entry here for every .json file placed in src/data/fhir/patient-profiles.
import patientProfiles from "@/data/fhir/patient-profiles";

type PatientProfileEntry = {
  id: string;
  label: string;
  data: unknown;
};

type ImportProfileOptions = {
  includeDemoOnboarding?: boolean;
};

function readClinicalImportForGate(
  fhirBundle: unknown,
): OnboardingProfile['clinicalImport'] {
  try {
    const mapped = mapFhirBundleToOnboardingImport(
      fhirBundle as Parameters<typeof mapFhirBundleToOnboardingImport>[0],
    );
    return mapped.clinicalImport;
  } catch (error) {
    console.error("Failed to inspect bundled FHIR profile for clinical import", error);
    return undefined;
  }
}

function attachClinicalImportForGate(
  profile: OnboardingProfile,
  fhirBundle: unknown,
): OnboardingProfile {
  const clinicalImport = readClinicalImportForGate(fhirBundle);
  return clinicalImport ? { ...profile, clinicalImport } : profile;
}

function startBundledEhrKnowledgeBundle(params: {
  patientId: string;
  location?: string;
  includeHedis: boolean;
}): void {
  const { patientId, location, includeHedis } = params;

  setBundlePending(patientId, true);
  setBundleStatus(patientId, { state: "in_flight", chunksAdded: 0 });

  void import("@/clinical-evidence/condition-bundler")
    .then(async ({
      bundleConditionPack,
      bundleMedicationPack,
      bundleSdohPack,
      bundleMeasurePack,
    }) => {
      const bundleTasks = [
        bundleConditionPack(patientId).catch((error) => {
          console.error("[select-fhir-profile] condition bundle failed:", error);
        }),
        bundleMedicationPack(patientId).catch((error) => {
          console.error("[select-fhir-profile] medication bundle failed:", error);
        }),
        bundleSdohPack(patientId, location).catch((error) => {
          console.error("[select-fhir-profile] SDOH bundle failed:", error);
        }),
      ];

      if (includeHedis) {
        bundleTasks.push(
          bundleMeasurePack(patientId).catch((error) => {
            console.error("[select-fhir-profile] HEDIS bundle failed:", error);
          }),
        );
      }

      await Promise.all(bundleTasks);
    })
    .catch((error) => {
      console.error("[select-fhir-profile] Failed to load condition-bundler:", error);
    })
    .finally(() => {
      try {
        refreshPatientRecord(patientId);
      } catch (error) {
        console.error("Failed to refresh patient after clinical bundling", error);
      }
    });
}

export default function SelectFhirProfileScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { importFHIRBundle } = usePatientRecord();
  const [importingId, setImportingId] = useState<string | null>(null);

  const profiles = useMemo<PatientProfileEntry[]>(
    () => patientProfiles as PatientProfileEntry[],
    [],
  );

  async function handleSelectProfile(
    entry: PatientProfileEntry,
    options: ImportProfileOptions = {},
  ) {
    if (importingId) return;
    setImportingId(entry.id);

    try {
      const fhirBundle = entry.data;

      const importedPatientId = importFHIRBundle(fhirBundle);
      dispatch(addPatient(fhirBundle));

      if (importedPatientId) {
        const importedPatient = getPatient(importedPatientId);
        let bundleLocation = importedPatient?.location;
        let includeHedis = Boolean(readClinicalImportForGate(fhirBundle));

        if (options.includeDemoOnboarding) {
          const currentProfile = getOnboardingProfile();
          const prepared = prepareExplicitDemoOnboardingForImportedProfile({
            currentProfile,
            importedProfileId: entry.id,
            patientId: importedPatientId,
          });
          const importedProfile = attachClinicalImportForGate(prepared.profile, fhirBundle);
          bundleLocation = importedProfile.patient.location ?? importedPatient?.location;
          includeHedis = shouldBundleHedisMeasures(importedProfile);

          if (prepared.caregiver) {
            saveOnboardingProfile(importedProfile);
            upsertCaregiver(prepared.caregiver);
          }

          if (importedPatient) {
            upsertPatient({
              ...importedPatient,
              preferredName:
                prepared.profile.patient.preferredName ??
                importedPatient.preferredName,
              baselineDailyRoutine:
                prepared.profile.patient.baselineDailyRoutine ??
                importedPatient.baselineDailyRoutine,
              safetyNotes:
                prepared.profile.safety?.safetyNotes ??
                importedPatient.safetyNotes,
              updatedAt: new Date().toISOString(),
            });
          }
        }

        refreshPatientRecord(importedPatientId);

        startBundledEhrKnowledgeBundle({
          patientId: importedPatientId,
          location: bundleLocation,
          includeHedis,
        });

        emitInAppBanner({
          title: "EHR Import",
          body: `FHIR bundle "${entry.label}" imported successfully`,
          severity: 1,
        });
      }

      router.back();
    } catch (error) {
      // Surface a minimal failure state; caller screen shows nothing else.
      console.error("Failed to import FHIR profile", error);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backLink}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Select a patient profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={profiles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No patient profiles found in src/data/fhir/patient-profiles.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.rowMain}
              disabled={importingId !== null}
              onPress={() => handleSelectProfile(item)}
            >
              <View style={styles.rowIconCircle}>
                <AppIcon name="note" size={20} color={AppTheme.colors.brand} />
              </View>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.rowSubtitle}>
                  {importingId === item.id ? "Importing..." : "Import EHR only"}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable
              style={styles.demoButton}
              disabled={importingId !== null}
              onPress={() => handleSelectProfile(item, { includeDemoOnboarding: true })}
            >
              <Text style={styles.demoButtonText}>Demo data</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: AppTheme.colors.border,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 64,
  },
  backLink: {
    color: "#0E6F68",
    fontWeight: '900',
    fontSize: 15,
  },
  backLabel: {
    color: AppTheme.colors.brand,
    fontSize: 15,
    fontWeight: "800",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  headerSpacer: {
    minWidth: 64,
  },
  listContent: {
    padding: 16,
  },
  separator: {
    height: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  rowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowTextBlock: {
    flex: 1,
  },
  rowTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  rowSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: "900",
  },
  demoButton: {
    marginLeft: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  demoButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: "900",
  },
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    textAlign: "center",
    marginTop: 40,
  },
});
