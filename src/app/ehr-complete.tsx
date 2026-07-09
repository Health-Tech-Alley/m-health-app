/**
 * Post-import patient completion screen.
 *
 * After a CDA zip import, the patient record has redacted/missing identity
 * fields (names, caregiver, PCP, safety). This lightweight form lets the
 * caregiver complete them so the app has a usable patient profile.
 *
 * Planning/33 §6.4 — "Prompt user post-import."
 */

import { useState, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AppIcon, type AppIconName } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import {
  upsertPatient,
  upsertCaregiver,
} from '@/data/repositories/patientRepository';
import { getPatient, getCaregiverForPatient } from '@/data/repositories/patientRepository';
import { refreshPatientRecord } from '@/contexts/patient-record-context';

const mutedText = AppTheme.colors.textMuted;

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  helper?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={mutedText}
      />
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
}

export default function EhrCompleteScreen() {
  const router = useRouter();
  const patientId = useOrchestratorPatientId();
  const { refresh } = usePatientRecord();

  const existingPatient = patientId ? getPatient(patientId) : null;
  const existingCaregiver = patientId ? getCaregiverForPatient(patientId) : null;

  const [patientName, setPatientName] = useState(
    existingPatient?.name && !existingPatient.name.includes('Redacted')
      ? existingPatient.name
      : '',
  );
  const [patientAge] = useState(existingPatient?.age ?? '');
  const [patientLocation, setPatientLocation] = useState(existingPatient?.location ?? '');
  const [gmfcs, setGmfcs] = useState(existingPatient?.gmfcs ?? 'Not assessed');
  const [caregiverName, setCaregiverName] = useState(
    existingCaregiver?.name && !existingCaregiver.name.includes('Redacted')
      ? existingCaregiver.name
      : '',
  );
  const [caregiverRelationship, setCaregiverRelationship] = useState(
    existingCaregiver?.relationship ?? '',
  );
  const [caregiverComfort, setCaregiverComfort] = useState(
    existingCaregiver?.medicalComfortLevel ?? 'Moderate detail',
  );
  const [pcpName, setPcpName] = useState('');
  const [pcpPhone, setPcpPhone] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [safetyNotes, setSafetyNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!patientId) return;
    setSaving(true);
    try {
      if (patientName.trim()) {
        upsertPatient({
          ...existingPatient!,
          patientId,
          name: patientName.trim(),
          location: patientLocation.trim() || undefined,
          gmfcs: gmfcs,
          updatedAt: new Date().toISOString(),
        });
      }
      upsertCaregiver({
        ...existingCaregiver,
        caregiverId: existingCaregiver?.caregiverId ?? 'default-caregiver',
        patientId,
        name: caregiverName.trim() || 'Caregiver',
        relationship: caregiverRelationship.trim() || undefined,
        medicalComfortLevel: caregiverComfort,
        createdAt: existingCaregiver?.createdAt ?? new Date().toISOString(),
      });
      refreshPatientRecord(patientId);
      refresh();
      router.replace('/dashboard');
    } finally {
      setSaving(false);
    }
  }, [
    patientId,
    patientName,
    patientLocation,
    gmfcs,
    caregiverName,
    caregiverRelationship,
    caregiverComfort,
    existingPatient,
    existingCaregiver,
    refresh,
    router,
  ]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <AppIcon name="care" size={26} color={AppTheme.colors.white} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>EHR IMPORTED</Text>
            <Text style={styles.title}>Complete the patient profile</Text>
          </View>
        </View>

        <Text style={styles.subtitle}>
          The EHR data has been imported with redacted identity fields.
          Fill in the details below so the app can personalize care guidance.
          You can skip fields and complete them later via the profile screen.
        </Text>

        <Text style={styles.sectionLabel}>Patient</Text>
        <Field
          label="Patient name"
          value={patientName}
          onChangeText={setPatientName}
          placeholder="e.g. Mike's caregiver"
          helper="Was 'Patient Redacted' in the CDA — enter the real or demo name."
        />
        <Field
          label="Location (county, state)"
          value={patientLocation}
          onChangeText={setPatientLocation}
          placeholder="e.g. Garrett County, Maryland"
          helper="Used for CDC PLACES community health context."
        />
        <Field
          label="GMFCS level"
          value={gmfcs}
          onChangeText={setGmfcs}
          placeholder="e.g. V"
          helper="Cerebral Palsy mobility scale. Leave 'Not assessed' if unknown."
        />

        <Text style={styles.sectionLabel}>Caregiver</Text>
        <Field
          label="Caregiver name"
          value={caregiverName}
          onChangeText={setCaregiverName}
          placeholder="e.g. caregiver name"
        />
        <Field
          label="Relationship"
          value={caregiverRelationship}
          onChangeText={setCaregiverRelationship}
          placeholder="e.g. Mother"
        />
        <Field
          label="Medical comfort level"
          value={caregiverComfort}
          onChangeText={setCaregiverComfort}
          placeholder="Moderate detail / Clinical (FNP/DNP) / Limited"
          helper="Controls the SLM's tone — clinical terms vs plain language."
        />

        <Text style={styles.sectionLabel}>Primary care provider</Text>
        <Field
          label="PCP name"
          value={pcpName}
          onChangeText={setPcpName}
          placeholder="e.g. Dr. Sarah Reynolds"
        />
        <Field
          label="PCP phone"
          value={pcpPhone}
          onChangeText={setPcpPhone}
          placeholder="e.g. (555) 987-6543"
        />

        <Text style={styles.sectionLabel}>Safety</Text>
        <Field
          label="Emergency contact"
          value={emergencyContact}
          onChangeText={setEmergencyContact}
          placeholder="e.g. 911 / Poison Control: 1-800-222-1222"
        />
        <Field
          label="Safety notes"
          value={safetyNotes}
          onChangeText={setSafetyNotes}
          placeholder="e.g. COPD red flags: increased breathlessness, blue lips, confusion."
        />

        <Pressable
          style={[styles.saveButton, saving && styles.disabledButton]}
          disabled={saving}
          onPress={handleSave}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving…' : 'Save & open dashboard'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.skipButton}
          onPress={() => router.replace('/dashboard')}
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppTheme.colors.screen },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: 24, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginBottom: 20 },
  iconCircle: {
    width: 54, height: 54, borderRadius: 18,
    backgroundColor: AppTheme.colors.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  headerText: { flex: 1 },
  eyebrow: {
    color: AppTheme.colors.brand, fontSize: 13, fontWeight: '900',
    letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 2,
  },
  title: { color: AppTheme.colors.text, fontSize: 18, fontWeight: '900' },
  subtitle: {
    color: AppTheme.colors.textSoft, fontSize: 15, lineHeight: 22,
    marginBottom: 24,
  },
  sectionLabel: {
    color: AppTheme.colors.brand, fontSize: 14, fontWeight: '800',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: 16, marginBottom: 8,
  },
  fieldBlock: { marginBottom: 16 },
  fieldLabel: {
    color: AppTheme.colors.text, fontSize: 14, fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 56, borderRadius: 18,
    borderWidth: 1, borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.white,
    paddingHorizontal: 16, fontSize: 16,
    color: AppTheme.colors.text,
  },
  fieldHelper: {
    color: mutedText, fontSize: 12, marginTop: 6, lineHeight: 17,
  },
  saveButton: {
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 18, minHeight: 56,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    color: AppTheme.colors.white, fontSize: 16, fontWeight: '800',
  },
  disabledButton: { opacity: 0.5 },
  skipButton: {
    alignItems: 'center', justifyContent: 'center',
    minHeight: 44, marginTop: 12,
  },
  skipButtonText: {
    color: mutedText, fontSize: 14, fontWeight: '600',
  },
});
