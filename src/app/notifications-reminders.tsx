import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MainTabHeader } from '@/components/MainTabHeader';
import { AppTheme } from '@/constants/theme';
import { usePatientRecord } from '@/contexts/patient-record-context';
import {
  getActiveMedicationSchedules,
  getMedicationConfirmationPreference,
  getNotificationPreferences,
  saveMedicationConfirmationPreference,
  setNotificationScopePreference,
  type Medication,
  type MedicationConfirmationRequirement,
  type MedicationConfirmationPreference,
  type NotificationPreferences,
} from '@/data';
import { requestNotificationPermission } from '@/services/notifications/notificationService';
import { rescheduleAll } from '@/services/notifications/reminderEngine';

type SectionId = 'health' | 'medications' | 'appointments' | 'careTasks';

function loadNotificationPreferences(): NotificationPreferences {
  return getNotificationPreferences();
}

export default function NotificationsRemindersScreen() {
  const { patientId, snapshot, refresh } = usePatientRecord();
  const [expandedId, setExpandedId] = useState<SectionId | null>('medications');
  const [preference, setPreference] = useState<MedicationConfirmationPreference | null>(null);
  const [preferenceUnavailable, setPreferenceUnavailable] = useState(false);
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(() => {
    try {
      return loadNotificationPreferences();
    } catch {
      return {
        anomaly: true,
        medication: true,
        medicationDevice: false,
        appointment: true,
        appointmentDevice: false,
        appointmentLeadTimeMin: 30,
        careTask: true,
        careTaskDevice: false,
      };
    }
  });
  const [permissionMessage, setPermissionMessage] = useState('');
  const refreshKey = snapshot?.lastRefreshedAt;
  const schedules = useMemo(
    () => {
      void refreshKey;
      try {
        return patientId ? getActiveMedicationSchedules(patientId) : [];
      } catch {
        return [];
      }
    },
    [patientId, refreshKey],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      try {
        setNotificationPrefs(loadNotificationPreferences());
        setNotificationUnavailable(false);
      } catch {
        setNotificationUnavailable(true);
      }

      if (!patientId) {
        setPreference(null);
        setPreferenceUnavailable(false);
        return;
      }

      try {
        setPreference(getMedicationConfirmationPreference(patientId));
        setPreferenceUnavailable(false);
      } catch {
        setPreference(null);
        setPreferenceUnavailable(true);
      }
    }, 0);

    return () => clearTimeout(handle);
  }, [patientId, refreshKey]);

  const toggleExpanded = (sectionId: SectionId) => {
    setExpandedId((current) => (current === sectionId ? null : sectionId));
  };

  const savePreference = (
    nextPreference: Pick<
      MedicationConfirmationPreference,
      'confirmationMode' | 'selectedMedicationIds'
    >,
  ) => {
    if (!patientId) return;
    try {
      const saved = saveMedicationConfirmationPreference({
        patientId,
        confirmationMode: nextPreference.confirmationMode,
        selectedMedicationIds: nextPreference.selectedMedicationIds,
      });
      setPreference(saved);
      setPreferenceUnavailable(false);
      refresh();
    } catch {
      setPreferenceUnavailable(true);
    }
  };

  const updateNotificationPreference = (
    scope: 'medication' | 'appointment',
    enabled: boolean,
    deviceEnabled?: boolean,
  ) => {
    try {
      const current = loadNotificationPreferences();
      setNotificationScopePreference(scope, enabled, {
        deviceEnabled,
        leadTimeMinutes: scope === 'appointment' ? current.appointmentLeadTimeMin : undefined,
        quietHoursStart: scope === 'medication' ? current.quietHoursStart : undefined,
        quietHoursEnd: scope === 'medication' ? current.quietHoursEnd : undefined,
      });
      const next = loadNotificationPreferences();
      setNotificationPrefs(next);
      setNotificationUnavailable(false);
      if (patientId) void rescheduleAll(patientId);
    } catch {
      setNotificationUnavailable(true);
    }
  };

  const handleMedicationDeviceToggle = async (enabled: boolean) => {
    setPermissionMessage('');
    const current = notificationPrefs;
    if (!enabled) {
      updateNotificationPreference('medication', current.medication, false);
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      setPermissionMessage('Notification permission not granted');
      updateNotificationPreference('medication', current.medication, false);
      return;
    }
    updateNotificationPreference('medication', current.medication, true);
  };

  const handleAppointmentDeviceToggle = async (enabled: boolean) => {
    setPermissionMessage('');
    const current = notificationPrefs;
    if (!enabled) {
      updateNotificationPreference('appointment', current.appointment, false);
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      setPermissionMessage('Notification permission not granted');
      updateNotificationPreference('appointment', current.appointment, false);
      return;
    }
    updateNotificationPreference('appointment', current.appointment, true);
  };

  const setAppointmentLeadTime = (value: string) => {
    const leadTime = parseInt(value, 10);
    if (Number.isNaN(leadTime)) return;
    try {
      const current = loadNotificationPreferences();
      setNotificationScopePreference('appointment', current.appointment, {
        deviceEnabled: current.appointmentDevice,
        leadTimeMinutes: leadTime,
      });
      setNotificationPrefs(loadNotificationPreferences());
      setNotificationUnavailable(false);
      if (patientId) void rescheduleAll(patientId);
    } catch {
      setNotificationUnavailable(true);
    }
  };

  const medications = snapshot?.medications ?? [];
  const requirements = snapshot?.medicationConfirmationRequirements;
  const selectedIds = preference?.selectedMedicationIds ?? [];
  const mode = preference?.confirmationMode ?? 'all';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MainTabHeader title="Notifications & reminders" eyebrow="Caregiver Concierge" icon="bell" />

        <ExpandableSection
          title="Health alerts"
          expanded={expandedId === 'health'}
          onPress={() => toggleExpanded('health')}>
          <Text style={styles.mutedText}>Additional preferences not available yet.</Text>
        </ExpandableSection>

        <ExpandableSection
          title="Medications"
          expanded={expandedId === 'medications'}
          onPress={() => toggleExpanded('medications')}>
          {!patientId ? (
            <Text style={styles.mutedText}>No active patient selected</Text>
          ) : !snapshot ? (
            <Text style={styles.mutedText}>Medication confirmation preferences unavailable</Text>
          ) : (
            <>
              <Text style={styles.helperText}>
                Choose which medication doses you want to confirm. Care-team-required medications cannot be turned off.
              </Text>

              {preferenceUnavailable ? (
                <Text style={styles.mutedText}>Medication confirmation preferences unavailable</Text>
              ) : (
                <>
              <View style={styles.modeGroup}>
                <ModeButton
                  label="Confirm every scheduled dose"
                  selected={mode === 'all'}
                  onPress={() => savePreference({ confirmationMode: 'all', selectedMedicationIds: selectedIds })}
                />
                <ModeButton
                  label="Confirm only care-team-required doses"
                  selected={mode === 'required_only'}
                  onPress={() =>
                    savePreference({
                      confirmationMode: 'required_only',
                      selectedMedicationIds: selectedIds,
                    })
                  }
                />
                <ModeButton
                  label="Choose medications"
                  selected={mode === 'personalized'}
                  onPress={() =>
                    savePreference({
                      confirmationMode: 'personalized',
                      selectedMedicationIds: selectedIds,
                    })
                  }
                />
              </View>

              {requirements ? (
                <MedicationPreferenceList
                  medications={medications}
                  requirements={requirements}
                  preferenceMode={mode}
                  selectedMedicationIds={selectedIds}
                  schedules={schedules}
                  onToggleMedication={(medicationId, enabled) => {
                    const nextIds = enabled
                      ? Array.from(new Set([...selectedIds, medicationId]))
                      : selectedIds.filter((id) => id !== medicationId);
                    savePreference({
                      confirmationMode: 'personalized',
                      selectedMedicationIds: nextIds,
                    });
                  }}
                />
              ) : (
                <Text style={styles.mutedText}>Medication confirmation preferences unavailable</Text>
              )}
                </>
              )}

              <View style={styles.divider} />
              <Text style={styles.subsectionTitle}>Reminder delivery</Text>
              {notificationUnavailable ? (
                <Text style={styles.mutedText}>Reminder delivery preferences unavailable</Text>
              ) : (
                <>
                  <PreferenceSwitch
                    label="Show medication reminders in the app"
                    value={notificationPrefs.medication}
                    onValueChange={(enabled) =>
                      updateNotificationPreference(
                        'medication',
                        enabled,
                        notificationPrefs.medicationDevice,
                      )
                    }
                  />
                  <PreferenceSwitch
                    label="Send device notifications"
                    value={notificationPrefs.medicationDevice}
                    onValueChange={handleMedicationDeviceToggle}
                  />
                </>
              )}
              {permissionMessage ? <Text style={styles.warningText}>{permissionMessage}</Text> : null}
              <View style={styles.staticRow}>
                <Text style={styles.rowTitle}>Add medication reminders to calendar</Text>
                <Text style={styles.mutedText}>Not available yet</Text>
              </View>
            </>
          )}
        </ExpandableSection>

        <ExpandableSection
          title="Appointments & scheduling"
          expanded={expandedId === 'appointments'}
          onPress={() => toggleExpanded('appointments')}>
          {notificationUnavailable ? (
            <Text style={styles.mutedText}>Reminder delivery preferences unavailable</Text>
          ) : (
            <>
          <PreferenceSwitch
            label="Show appointment reminders in the app"
            value={notificationPrefs.appointment}
            onValueChange={(enabled) =>
              updateNotificationPreference(
                'appointment',
                enabled,
                notificationPrefs.appointmentDevice,
              )
            }
          />
          <PreferenceSwitch
            label="Send device notifications"
            value={notificationPrefs.appointmentDevice}
            onValueChange={handleAppointmentDeviceToggle}
          />
          <View style={styles.inlineControlRow}>
            <Text style={styles.rowTitle}>Reminder lead time</Text>
            <TextInput
              style={styles.numInput}
              value={String(notificationPrefs.appointmentLeadTimeMin)}
              keyboardType="numeric"
              onChangeText={setAppointmentLeadTime}
              accessibilityLabel="Appointment reminder lead time in minutes"
            />
          </View>
            </>
          )}
        </ExpandableSection>

        <ExpandableSection
          title="Care tasks"
          expanded={expandedId === 'careTasks'}
          onPress={() => toggleExpanded('careTasks')}>
          <Text style={styles.mutedText}>Additional preferences not available yet.</Text>
        </ExpandableSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function ExpandableSection({
  title,
  expanded,
  onPress,
  children,
}: {
  title: string;
  expanded: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <Pressable
        style={styles.sectionHeader}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.chevron}>{expanded ? 'v' : '>'}</Text>
      </Pressable>
      {expanded ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function ModeButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.modeButton, selected && styles.modeButtonActive]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={[styles.modeButtonText, selected && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MedicationPreferenceList({
  medications,
  requirements,
  preferenceMode,
  selectedMedicationIds,
  schedules,
  onToggleMedication,
}: {
  medications: Medication[];
  requirements: Record<string, MedicationConfirmationRequirement>;
  preferenceMode: MedicationConfirmationPreference['confirmationMode'];
  selectedMedicationIds: string[];
  schedules: ReturnType<typeof getActiveMedicationSchedules>;
  onToggleMedication: (medicationId: string, enabled: boolean) => void;
}) {
  if (medications.length === 0) {
    return <Text style={styles.mutedText}>No medications provided</Text>;
  }

  return (
    <View style={styles.medicationList}>
      {medications.map((medication) => {
        const requirement = requirements[medication.medicationId];
        const required = requirement?.confirmationRequirement === 'required';
        const selected =
          preferenceMode === 'all' ||
          required ||
          (preferenceMode === 'personalized' &&
            selectedMedicationIds.includes(medication.medicationId));
        const locked = preferenceMode !== 'personalized' || required;
        const schedule = schedules.find(
          (candidate) => candidate.medicationId === medication.medicationId,
        );
        const details = [medication.dosage, medication.frequency].filter(Boolean).join(' - ');

        return (
          <View key={medication.medicationId} style={styles.medicationRow}>
            <View style={styles.rowTextBlock}>
              <View style={styles.medicationNameRow}>
                <Text style={styles.rowTitle}>{medication.name}</Text>
                {required ? (
                  <View style={styles.requiredBadge}>
                    <Text style={styles.requiredBadgeText}>Required by care team</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.mutedText}>{details || 'Medication details not provided'}</Text>
              <Text style={styles.mutedText}>
                {schedule?.timeOfDay ? schedule.timeOfDay : 'Schedule not provided'}
              </Text>
            </View>
            <Switch
              value={selected}
              disabled={locked}
              onValueChange={(enabled) => onToggleMedication(medication.medicationId, enabled)}
              trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brandSoft }}
              thumbColor={selected ? AppTheme.colors.brand : AppTheme.colors.white}
              accessibilityLabel={`Confirm doses for ${medication.name}`}
              accessibilityState={{ checked: selected, disabled: locked }}
            />
          </View>
        );
      })}
    </View>
  );
}

function PreferenceSwitch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.preferenceRow}>
      <Text style={styles.rowTitle}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: AppTheme.colors.border, true: AppTheme.colors.brandSoft }}
        thumbColor={value ? AppTheme.colors.brand : AppTheme.colors.white}
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 124,
    gap: 14,
  },
  sectionCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    overflow: 'hidden',
    ...AppTheme.shadow,
  },
  sectionHeader: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  chevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 18,
    fontWeight: '900',
  },
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
    padding: 16,
    gap: 12,
  },
  helperText: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  mutedText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  warningText: {
    color: AppTheme.colors.danger,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  modeGroup: {
    gap: 8,
  },
  modeButton: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeButtonActive: {
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
  },
  modeButtonText: {
    flex: 1,
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  modeButtonTextActive: {
    color: AppTheme.colors.brand,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: AppTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: AppTheme.colors.brand,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
  },
  medicationList: {
    gap: 10,
  },
  medicationRow: {
    minHeight: 74,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowTextBlock: {
    flex: 1,
    gap: 3,
  },
  medicationNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowTitle: {
    color: AppTheme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  requiredBadge: {
    borderRadius: AppTheme.radius.pill,
    backgroundColor: AppTheme.colors.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  requiredBadgeText: {
    color: AppTheme.colors.brand,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: AppTheme.colors.border,
  },
  subsectionTitle: {
    color: AppTheme.colors.sectionText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  preferenceRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  staticRow: {
    gap: 2,
    paddingTop: 2,
  },
  inlineControlRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  numInput: {
    minWidth: 78,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
});
