import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Platform,
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
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
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
import {
  getEmergencyDndBypassEnabled,
  openAndroidNotificationPolicySettings,
  requestNotificationPermission,
} from '@/services/notifications/notificationService';
import { rescheduleAll } from '@/services/notifications/reminderEngine';

type SectionId = 'health' | 'emergency' | 'medications' | 'appointments' | 'careTasks' | 'device';

function loadNotificationPreferences(): NotificationPreferences {
  return getNotificationPreferences();
}

export default function NotificationsRemindersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
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
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [emergencyDndEnabled, setEmergencyDndEnabled] = useState(false);
  const [dndSettingsError, setDndSettingsError] = useState(false);
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

  const refreshEmergencyDndStatus = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setEmergencyDndEnabled(await getEmergencyDndBypassEnabled());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshEmergencyDndStatus();
    }, [refreshEmergencyDndStatus]),
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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/settings' as never);
  }, [router]);

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
    setPermissionDenied(false);
    const current = notificationPrefs;
    if (!enabled) {
      updateNotificationPreference('medication', current.medication, false);
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      setPermissionDenied(true);
      updateNotificationPreference('medication', current.medication, false);
      return;
    }
    updateNotificationPreference('medication', current.medication, true);
  };

  const handleAppointmentDeviceToggle = async (enabled: boolean) => {
    setPermissionDenied(false);
    const current = notificationPrefs;
    if (!enabled) {
      updateNotificationPreference('appointment', current.appointment, false);
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      setPermissionDenied(true);
      updateNotificationPreference('appointment', current.appointment, false);
      return;
    }
    updateNotificationPreference('appointment', current.appointment, true);
  };

  const handleOpenEmergencyDndSettings = async () => {
    setDndSettingsError(false);
    const opened = await openAndroidNotificationPolicySettings();
    if (!opened) {
      setDndSettingsError(true);
      return;
    }
    void refreshEmergencyDndStatus();
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
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={['top', 'bottom']}>
      <ScrollView
        style={themedStyles.safeArea}
        contentContainerStyle={[styles.content, themedStyles.content]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('notifications.backA11y')}>
          <Text style={[styles.backText, themedStyles.backText]}>{'\u2190'} {t('common.back')}</Text>
        </Pressable>

        <MainTabHeader title={t('notifications.title')} eyebrow={t('common.appName')} icon="bell" />

        <Text style={[styles.subsectionTitle, themedStyles.subsectionTitle]}>{t('notifications.group.reminders')}</Text>

        <ExpandableSection
          title={t('notifications.section.medications')}
          expanded={expandedId === 'medications'}
          onPress={() => toggleExpanded('medications')}>
          {!patientId ? (
            <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.noActivePatient')}</Text>
          ) : !snapshot ? (
            <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.medicationConfirmationUnavailable')}</Text>
          ) : (
            <>
              <Text style={[styles.helperText, themedStyles.helperText]}>
                {t('notifications.medications.helper')}
              </Text>

              {preferenceUnavailable ? (
                <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.medicationConfirmationUnavailable')}</Text>
              ) : (
                <>
              <View style={styles.modeGroup}>
                <ModeButton
                  label={t('notifications.medications.mode.all')}
                  selected={mode === 'all'}
                  onPress={() => savePreference({ confirmationMode: 'all', selectedMedicationIds: selectedIds })}
                />
                <ModeButton
                  label={t('notifications.medications.mode.requiredOnly')}
                  selected={mode === 'required_only'}
                  onPress={() =>
                    savePreference({
                      confirmationMode: 'required_only',
                      selectedMedicationIds: selectedIds,
                    })
                  }
                />
                <ModeButton
                  label={t('notifications.medications.mode.personalized')}
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
                <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.medicationConfirmationUnavailable')}</Text>
              )}
                </>
              )}

              <View style={[styles.divider, themedStyles.divider]} />
              <Text style={[styles.subsectionTitle, themedStyles.subsectionTitle]}>{t('notifications.reminderDelivery')}</Text>
              {notificationUnavailable ? (
                <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.reminderDeliveryUnavailable')}</Text>
              ) : (
                <>
                  <PreferenceSwitch
                    label={t('notifications.medications.showInApp')}
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
                    label={t('notifications.sendDevice')}
                    value={notificationPrefs.medicationDevice}
                    onValueChange={handleMedicationDeviceToggle}
                  />
                </>
              )}
              {permissionDenied ? <Text style={styles.warningText}>{t('notifications.permission.notGranted')}</Text> : null}
              <View style={styles.staticRow}>
                <Text style={[styles.rowTitle, themedStyles.rowTitle]}>{t('notifications.medications.addToCalendar')}</Text>
                <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.notAvailableYet')}</Text>
              </View>
            </>
          )}
        </ExpandableSection>

        <ExpandableSection
          title={t('notifications.section.appointments')}
          expanded={expandedId === 'appointments'}
          onPress={() => toggleExpanded('appointments')}>
          {notificationUnavailable ? (
            <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.reminderDeliveryUnavailable')}</Text>
          ) : (
            <>
          <PreferenceSwitch
            label={t('notifications.appointments.showInApp')}
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
            label={t('notifications.sendDevice')}
            value={notificationPrefs.appointmentDevice}
            onValueChange={handleAppointmentDeviceToggle}
          />
          <View style={styles.inlineControlRow}>
            <Text style={[styles.rowTitle, themedStyles.rowTitle]}>{t('notifications.appointments.leadTime')}</Text>
            <TextInput
              style={[styles.numInput, themedStyles.numInput]}
              value={String(notificationPrefs.appointmentLeadTimeMin)}
              keyboardType="numeric"
              onChangeText={setAppointmentLeadTime}
              accessibilityLabel={t('notifications.appointments.leadTimeA11y')}
            />
          </View>
            </>
          )}
        </ExpandableSection>

        <ExpandableSection
          title={t('notifications.section.careTasks')}
          expanded={expandedId === 'careTasks'}
          onPress={() => toggleExpanded('careTasks')}>
          <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.careTasks.comingLater')}</Text>
        </ExpandableSection>

        <Text style={[styles.subsectionTitle, themedStyles.subsectionTitle]}>{t('notifications.group.health')}</Text>

        <ExpandableSection
          title={t('notifications.section.health')}
          expanded={expandedId === 'health'}
          onPress={() => toggleExpanded('health')}>
          <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.health.body')}</Text>
        </ExpandableSection>

        <Text style={[styles.subsectionTitle, themedStyles.subsectionTitle]}>{t('notifications.group.emergency')}</Text>

        <ExpandableSection
          title={t('notifications.section.emergency')}
          expanded={expandedId === 'emergency'}
          onPress={() => toggleExpanded('emergency')}>
          <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.emergency.body')}</Text>
          {Platform.OS === 'android' ? (
            <View style={styles.staticRow}>
              <View style={styles.dndStatusRow}>
                <View style={styles.rowTextBlock}>
                  <Text style={[styles.rowTitle, themedStyles.rowTitle]}>
                    {t('notifications.emergency.dnd.title')}
                  </Text>
                  <Text style={[styles.mutedText, themedStyles.mutedText]}>
                    {t('notifications.emergency.dnd.body')}
                  </Text>
                </View>
                <View
                  style={[
                    styles.dndStatusBadge,
                    themedStyles.dndStatusBadge,
                    emergencyDndEnabled && themedStyles.dndStatusBadgeEnabled,
                  ]}>
                  <Text
                    style={[
                      styles.dndStatusText,
                      themedStyles.dndStatusText,
                      emergencyDndEnabled && themedStyles.dndStatusTextEnabled,
                    ]}>
                    {emergencyDndEnabled
                      ? t('notifications.emergency.dnd.status.enabled')
                      : t('notifications.emergency.dnd.status.notEnabled')}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('notifications.emergency.dnd.actionA11y')}
                onPress={handleOpenEmergencyDndSettings}
                style={[styles.dndSettingsButton, themedStyles.dndSettingsButton]}>
                <Text style={[styles.dndSettingsButtonText, themedStyles.dndSettingsButtonText]}>
                  {t('notifications.emergency.dnd.action')}
                </Text>
              </Pressable>
              {dndSettingsError ? (
                <Text style={styles.warningText}>{t('notifications.emergency.dnd.openError')}</Text>
              ) : null}
            </View>
          ) : null}
        </ExpandableSection>

        <Text style={[styles.subsectionTitle, themedStyles.subsectionTitle]}>{t('notifications.group.device')}</Text>

        <ExpandableSection
          title={t('notifications.section.device')}
          expanded={expandedId === 'device'}
          onPress={() => toggleExpanded('device')}>
          <View style={styles.staticRow}>
            <Text style={[styles.rowTitle, themedStyles.rowTitle]}>{t('notifications.device.title')}</Text>
            <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.device.body')}</Text>
          </View>
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
  const themedStyles = createThemedStyles(useTheme());

  return (
    <View style={[styles.sectionCard, themedStyles.sectionCard]}>
      <Pressable
        style={styles.sectionHeader}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}>
        <Text style={[styles.sectionTitle, themedStyles.sectionTitle]}>{title}</Text>
        <Text style={[styles.chevron, themedStyles.chevron]}>{expanded ? 'v' : '>'}</Text>
      </Pressable>
      {expanded ? <View style={[styles.sectionBody, themedStyles.sectionBody]}>{children}</View> : null}
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
  const themedStyles = createThemedStyles(useTheme());

  return (
    <Pressable
      style={[
        styles.modeButton,
        themedStyles.modeButton,
        selected && styles.modeButtonActive,
        selected && themedStyles.modeButtonActive,
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <View style={[styles.radioOuter, themedStyles.radioOuter, selected && styles.radioOuterActive]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text
        style={[
          styles.modeButtonText,
          themedStyles.modeButtonText,
          selected && styles.modeButtonTextActive,
          selected && themedStyles.modeButtonTextActive,
        ]}
      >
        {label}
      </Text>
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
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = createThemedStyles(theme);

  if (medications.length === 0) {
    return <Text style={[styles.mutedText, themedStyles.mutedText]}>{t('notifications.medications.empty')}</Text>;
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
          <View key={medication.medicationId} style={[styles.medicationRow, themedStyles.medicationRow]}>
            <View style={styles.rowTextBlock}>
              <View style={styles.medicationNameRow}>
                <Text style={[styles.rowTitle, themedStyles.rowTitle]}>{medication.name}</Text>
                {required ? (
                  <View style={[styles.requiredBadge, themedStyles.requiredBadge]}>
                    <Text style={[styles.requiredBadgeText, themedStyles.requiredBadgeText]}>{t('notifications.medications.requiredByCareTeam')}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.mutedText, themedStyles.mutedText]}>
                {details || t('notifications.medications.detailsNotProvided')}
              </Text>
              <Text style={[styles.mutedText, themedStyles.mutedText]}>
                {schedule?.timeOfDay ? schedule.timeOfDay : t('notifications.medications.scheduleNotProvided')}
              </Text>
            </View>
            <Switch
              value={selected}
              disabled={locked}
              onValueChange={(enabled) => onToggleMedication(medication.medicationId, enabled)}
              trackColor={{ false: theme.appBorder, true: theme.appBrandSoftSurface }}
              thumbColor={selected ? AppTheme.colors.brand : theme.appSurface}
              accessibilityLabel={t('notifications.medications.confirmDosesA11y', {
                name: medication.name,
              })}
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
  const theme = useTheme();
  const themedStyles = createThemedStyles(theme);

  return (
    <View style={styles.preferenceRow}>
      <Text style={[styles.rowTitle, themedStyles.rowTitle]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.appBorder, true: theme.appBrandSoftSurface }}
        thumbColor={value ? AppTheme.colors.brand : theme.appSurface}
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';

  return StyleSheet.create({
    safeArea: { backgroundColor: theme.appBackground },
    content: { backgroundColor: theme.appBackground },
    sectionCard: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    sectionTitle: { color: theme.appText },
    chevron: { color: theme.appTextMuted },
    sectionBody: { borderTopColor: theme.appBorder },
    helperText: { color: theme.appTextSupporting },
    mutedText: { color: theme.appTextSupporting },
    backText: { color: AppTheme.colors.brand },
    modeButton: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    modeButtonActive: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: AppTheme.colors.brand,
    },
    modeButtonText: { color: theme.appTextSupporting },
    modeButtonTextActive: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    radioOuter: { borderColor: theme.appBorder },
    medicationRow: {
      backgroundColor: theme.appSurface,
      borderColor: theme.appBorder,
    },
    rowTitle: { color: theme.appText },
    requiredBadge: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: isDark ? AppTheme.colors.brand : 'transparent',
      borderWidth: isDark ? 1 : 0,
    },
    requiredBadgeText: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    divider: { backgroundColor: theme.appBorder },
    subsectionTitle: { color: theme.appSectionText },
    dndStatusBadge: {
      backgroundColor: theme.appControlSurface,
      borderColor: theme.appBorder,
    },
    dndStatusBadgeEnabled: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: AppTheme.colors.brand,
    },
    dndStatusText: { color: theme.appTextSupporting },
    dndStatusTextEnabled: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    dndSettingsButton: {
      backgroundColor: theme.appBrandSoftSurface,
      borderColor: AppTheme.colors.brand,
    },
    dndSettingsButtonText: {
      color: isDark ? theme.appText : AppTheme.colors.brand,
    },
    numInput: {
      backgroundColor: theme.appInputBackground,
      borderColor: theme.appBorder,
      color: theme.appText,
    },
  });
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
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 12,
  },
  backText: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: '900',
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
  dndStatusRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dndStatusBadge: {
    borderRadius: AppTheme.radius.pill,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.softSurface,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dndStatusText: {
    fontSize: 11,
    fontWeight: '900',
  },
  dndSettingsButton: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.brand,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dndSettingsButtonText: {
    color: AppTheme.colors.brand,
    fontSize: 13,
    fontWeight: '900',
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
