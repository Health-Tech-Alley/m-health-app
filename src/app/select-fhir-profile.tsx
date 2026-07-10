import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { AppTheme } from "@/constants/theme";
import { useOrchestratorPatientId } from "@/contexts/orchestrator-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { dispatchImmediate } from "@/services/notifications";
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

export default function SelectFhirProfileScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const patientId = useOrchestratorPatientId();
  const { importFHIRBundle } = usePatientRecord();
  const [importingId, setImportingId] = useState<string | null>(null);

  const profiles = useMemo<PatientProfileEntry[]>(
    () => patientProfiles as PatientProfileEntry[],
    [],
  );

  async function handleSelectProfile(entry: PatientProfileEntry) {
    if (importingId) return;
    setImportingId(entry.id);

    try {
      const fhirBundle = entry.data;

      importFHIRBundle(fhirBundle);
      dispatch(addPatient(fhirBundle));

      await dispatchImmediate({
        patientId,
        scope: "anomaly",
        title: "EHR Import",
        body: `FHIR bundle "${entry.label}" imported successfully`,
        severity: 1,
      });

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
          <Pressable
            style={styles.row}
            disabled={importingId !== null}
            onPress={() => handleSelectProfile(item)}
          >
            <View style={styles.rowIconCircle}>
              <AppIcon name="note" size={20} color={AppTheme.colors.brand} />
            </View>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowTitle}>{item.label}</Text>
              <Text style={styles.rowSubtitle}>
                {importingId === item.id ? "Importing…" : "Tap to import"}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
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
  emptyText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    textAlign: "center",
    marginTop: 40,
  },
});