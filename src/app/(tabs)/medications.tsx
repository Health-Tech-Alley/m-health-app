/**
 * Medications tab.
 *
 * Lists active medications and their scheduled reminder times. Each row has a
 * "Mark as given" button that logs a caregiver_action of type
 * `log_observation`. A dev-mode link to the raw Acute Anomaly demo is kept
 * at the bottom.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/screen-header';

import {
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import {
  getActiveMedications,
  getActiveMedicationSchedules,
  insertCaregiverAction,
} from '@/data';
import type { Medication, MedicationSchedule } from '@/data/types';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';

export default function MedicationsTab() {
  const router = useRouter();
  const patientId = useOrchestratorPatientId();

  const [givenToday, setGivenToday] = useState<Record<string, boolean>>({});

  const meds = getActiveMedications(patientId);
  const schedules = getActiveMedicationSchedules(patientId);
  const scheduleByMed = new Map<string, MedicationSchedule[]>();
  for (const s of schedules) {
    const list = scheduleByMed.get(s.medicationId) ?? [];
    list.push(s);
    scheduleByMed.set(s.medicationId, list);
  }

  const markGiven = useCallback(
    (med: Medication) => {
      insertCaregiverAction({
        actionId: `act-${Date.now()}`,
        patientId,
        caregiverId: 'caregiver-1',
        type: 'log_observation',
        payloadJson: JSON.stringify({
          kind: 'medication_given',
          medicationId: med.medicationId,
          name: med.name,
          dosage: med.dosage,
          at: new Date().toISOString(),
        }),
        createdAt: new Date().toISOString(),
      });
      setGivenToday((prev) => ({ ...prev, [med.medicationId]: true }));
    },
    [patientId],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow="Medication Management" title="Medications" />

        {meds.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>No active medications on file.</Text>
          </View>
        ) : (
          meds.map((med) => {
            const times = (scheduleByMed.get(med.medicationId) ?? []).map((s) => s.timeOfDay);
            const isGiven = !!givenToday[med.medicationId];
            return (
              <View key={med.medicationId} style={styles.medCard}>
                <View style={styles.medHeader}>
                  <Text style={styles.medName}>{med.name}</Text>
                  {med.dosage ? <Text style={styles.medDosage}>{med.dosage}</Text> : null}
                </View>
                {med.frequency ? (
                  <Text style={styles.muted}>Frequency: {med.frequency}</Text>
                ) : null}
                {med.indication ? (
                  <Text style={styles.muted}>Indication: {med.indication}</Text>
                ) : null}
                {times.length > 0 ? (
                  <View style={styles.timesRow}>
                    {times.map((t, i) => (
                      <View key={`${t}-${i}`} style={styles.timePill}>
                        <Text style={styles.timeText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  style={[styles.givenButton, isGiven && styles.givenButtonDone]}
                  onPress={() => markGiven(med)}
                  disabled={isGiven}
                >
                  <Text style={[styles.givenButtonText, isGiven && styles.givenButtonTextDone]}>
                    {isGiven ? '✓ Given' : 'Mark as given'}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}

        {/* Dev-mode link to the raw anomaly demo */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Developer</Text>
        <Pressable
          style={styles.devCard}
          onPress={() => router.push('/acute-anomaly')}
        >
          <Text style={styles.devTitle}>Acute Anomaly Flow (demo)</Text>
          <Text style={styles.muted}>Simulate vitals and trigger alerts.</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  medCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  medHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  medName: {
    fontSize: 17,
    fontWeight: '800',
    color: DARK,
    flex: 1,
  },
  medDosage: {
    fontSize: 14,
    color: TEAL,
    fontWeight: '700',
  },
  muted: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  timesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  timePill: {
    backgroundColor: '#EAFBF7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timeText: {
    color: TEAL,
    fontSize: 12,
    fontWeight: '700',
  },
  givenButton: {
    marginTop: 6,
    backgroundColor: TEAL,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  givenButtonDone: {
    backgroundColor: '#EAFBF7',
    borderWidth: 1,
    borderColor: TEAL,
  },
  givenButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  givenButtonTextDone: {
    color: TEAL,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  devCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  devTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DARK,
  },
});
