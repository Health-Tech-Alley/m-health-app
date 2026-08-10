/**
 * Post-import patient completion screen.
 *
 * After a CDA zip import, the patient record has redacted/missing identity
 * fields (names, caregiver, PCP, safety). This lightweight form lets the
 * caregiver complete them so the app has a usable patient profile.
 *
 * Planning/33 §6.4 — "Prompt user post-import."
 */

import { useMemo, useState, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AppIcon, type AppIconName } from '@/components/AppIcon';
import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import { useOrchestratorPatientId } from '@/contexts/orchestrator-context';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslationKey, TranslateFn } from '@/localization/i18n';
import {
  upsertPatient,
  upsertCaregiver,
} from '@/data/repositories/patientRepository';
import { getPatient, getCaregiverForPatient } from '@/data/repositories/patientRepository';
import { refreshPatientRecord } from '@/contexts/patient-record-context';

const mutedText = AppTheme.colors.textMuted;

const GMFCS_VALUE_KEYS = {
  'Not assessed': 'ehrComplete.value.notAssessed',
} as const satisfies Record<string, TranslationKey>;

const CAREGIVER_COMFORT_VALUE_KEYS = {
  'Moderate detail': 'ehrComplete.value.moderateDetail',
  'Clinical (FNP/DNP)': 'ehrComplete.value.clinicalDetail',
  Limited: 'ehrComplete.value.limitedDetail',
} as const satisfies Record<string, TranslationKey>;

const CAREGIVER_NAME_VALUE_KEYS = {
  Caregiver: 'ehrComplete.value.caregiver',
} as const satisfies Record<string, TranslationKey>;

function displayStoredValue(
  value: string,
  t: TranslateFn,
  labels: Partial<Record<string, TranslationKey>>,
) {
  const key = labels[value];
  return key ? t(key) : value;
}

function canonicalizeDisplayValue(
  value: string,
  t: TranslateFn,
  labels: Partial<Record<string, TranslationKey>>,
) {
  const trimmed = value.trim();
  const entries = Object.entries(labels) as Array<[string, TranslationKey]>;
  const match = entries.find(
    ([stored, key]) => trimmed === stored || trimmed === t(key),
  );
  return match ? match[0] : value;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
  accessibilityHint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  helper?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, themedStyles.fieldLabel]}>{label}</Text>
      <TextInput
        style={[styles.input, themedStyles.input]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.appTextMuted}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint ?? helper}
      />
      {helper ? <Text style={[styles.fieldHelper, themedStyles.fieldHelper]}>{helper}</Text> : null}
    </View>
  );
}

export default function EhrCompleteScreen() {
  const router = useRouter();
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const { t } = useTranslation();
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
          gmfcs: canonicalizeDisplayValue(gmfcs, t, GMFCS_VALUE_KEYS),
          updatedAt: new Date().toISOString(),
        });
      }
      const canonicalCaregiverName = canonicalizeDisplayValue(
        caregiverName,
        t,
        CAREGIVER_NAME_VALUE_KEYS,
      );
      upsertCaregiver({
        ...existingCaregiver,
        caregiverId: existingCaregiver?.caregiverId ?? 'default-caregiver',
        patientId,
        name: canonicalCaregiverName.trim() || 'Caregiver',
        relationship: caregiverRelationship.trim() || undefined,
        medicalComfortLevel: canonicalizeDisplayValue(
          caregiverComfort,
          t,
          CAREGIVER_COMFORT_VALUE_KEYS,
        ),
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
    t,
  ]);

  return (
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={['top', 'bottom']}>
      <ScrollView
        style={[styles.scrollView, themedStyles.scrollView]}
        contentContainerStyle={[styles.content, themedStyles.content]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <AppIcon name="care" size={26} color={AppTheme.colors.white} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, themedStyles.eyebrow]}>{t('ehrComplete.eyebrow')}</Text>
            <Text style={[styles.title, themedStyles.title]}>{t('ehrComplete.title')}</Text>
          </View>
        </View>

        <Text style={[styles.subtitle, themedStyles.subtitle]}>
          {t('ehrComplete.subtitle')}
        </Text>

        <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>{t('ehrComplete.section.patient')}</Text>
        <Field
          label={t('ehrComplete.field.patientName')}
          value={patientName}
          onChangeText={setPatientName}
          placeholder={t('ehrComplete.placeholder.patientName')}
          helper={t('ehrComplete.helper.patientName')}
          accessibilityHint={t('ehrComplete.a11y.patientNameHint')}
        />
        <Field
          label={t('ehrComplete.field.location')}
          value={patientLocation}
          onChangeText={setPatientLocation}
          placeholder={t('ehrComplete.placeholder.location')}
          helper={t('ehrComplete.helper.location')}
          accessibilityHint={t('ehrComplete.a11y.locationHint')}
        />
        <Field
          label={t('ehrComplete.field.gmfcs')}
          value={displayStoredValue(gmfcs, t, GMFCS_VALUE_KEYS)}
          onChangeText={(value) => setGmfcs(canonicalizeDisplayValue(value, t, GMFCS_VALUE_KEYS))}
          placeholder={t('ehrComplete.placeholder.gmfcs')}
          helper={t('ehrComplete.helper.gmfcs')}
          accessibilityHint={t('ehrComplete.a11y.gmfcsHint')}
        />

        <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>{t('ehrComplete.section.caregiver')}</Text>
        <Field
          label={t('ehrComplete.field.caregiverName')}
          value={displayStoredValue(caregiverName, t, CAREGIVER_NAME_VALUE_KEYS)}
          onChangeText={(value) => setCaregiverName(canonicalizeDisplayValue(value, t, CAREGIVER_NAME_VALUE_KEYS))}
          placeholder={t('ehrComplete.placeholder.caregiverName')}
        />
        <Field
          label={t('ehrComplete.field.relationship')}
          value={caregiverRelationship}
          onChangeText={setCaregiverRelationship}
          placeholder={t('ehrComplete.placeholder.relationship')}
        />
        <Field
          label={t('ehrComplete.field.medicalComfort')}
          value={displayStoredValue(caregiverComfort, t, CAREGIVER_COMFORT_VALUE_KEYS)}
          onChangeText={(value) =>
            setCaregiverComfort(canonicalizeDisplayValue(value, t, CAREGIVER_COMFORT_VALUE_KEYS))
          }
          placeholder={t('ehrComplete.placeholder.medicalComfort')}
          helper={t('ehrComplete.helper.medicalComfort')}
          accessibilityHint={t('ehrComplete.a11y.medicalComfortHint')}
        />

        <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>{t('ehrComplete.section.primaryCare')}</Text>
        <Field
          label={t('ehrComplete.field.pcpName')}
          value={pcpName}
          onChangeText={setPcpName}
          placeholder={t('ehrComplete.placeholder.pcpName')}
        />
        <Field
          label={t('ehrComplete.field.pcpPhone')}
          value={pcpPhone}
          onChangeText={setPcpPhone}
          placeholder={t('ehrComplete.placeholder.pcpPhone')}
        />

        <Text style={[styles.sectionLabel, themedStyles.sectionLabel]}>{t('ehrComplete.section.safety')}</Text>
        <Field
          label={t('ehrComplete.field.emergencyContact')}
          value={emergencyContact}
          onChangeText={setEmergencyContact}
          placeholder={t('ehrComplete.placeholder.emergencyContact')}
        />
        <Field
          label={t('ehrComplete.field.safetyNotes')}
          value={safetyNotes}
          onChangeText={setSafetyNotes}
          placeholder={t('ehrComplete.placeholder.safetyNotes')}
        />

        <Pressable
          style={[styles.saveButton, saving && styles.disabledButton]}
          disabled={saving}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel={
            saving ? t('ehrComplete.action.savingA11y') : t('ehrComplete.action.saveA11y')
          }
          accessibilityHint={t('ehrComplete.action.saveHint')}
          accessibilityState={{ disabled: saving }}
        >
          <Text style={styles.saveButtonText}>
            {saving ? t('ehrComplete.action.saving') : t('ehrComplete.action.saveOpenDashboard')}
          </Text>
        </Pressable>

        <Pressable
          style={styles.skipButton}
          onPress={() => router.replace('/dashboard')}
          accessibilityRole="button"
          accessibilityLabel={t('ehrComplete.action.skipA11y')}
          accessibilityHint={t('ehrComplete.action.skipHint')}
        >
          <Text style={[styles.skipButtonText, themedStyles.skipButtonText]}>{t('ehrComplete.action.skip')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    safeArea: { backgroundColor: theme.appBackground },
    scrollView: { backgroundColor: theme.appBackground },
    content: { backgroundColor: theme.appBackground },
    eyebrow: { color: isDark ? theme.appSectionText : AppTheme.colors.brand },
    title: { color: theme.appText },
    subtitle: { color: theme.appTextSupporting },
    sectionLabel: {
      color: isDark ? theme.appSectionText : AppTheme.colors.brand,
    },
    fieldLabel: { color: theme.appText },
    input: {
      borderColor: theme.appBorder,
      backgroundColor: theme.appInputBackground,
      color: theme.appText,
    },
    fieldHelper: { color: theme.appTextSupporting },
    skipButtonText: { color: theme.appTextMuted },
  });
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
