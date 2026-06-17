/**
 * Dashboard tab.
 *
 * The unifying surface for all three steel threads. Shows a patient summary
 * header, active alert cards (severity-colored), and quick-action cards that
 * link to Care, Medications, and Schedule. Subscribes to the orchestration
 * event bus for `ml_alert_created` and `vitals_sample` so the alert list
 * refreshes in real time.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/screen-header';

import { AlertCard } from '@/components/dashboard/alert-card';
import {
  useOrchestrator,
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import {
  getActiveAlerts,
  getPatient,
  getLatestHealthSample,
} from '@/data';
import type { Alert, Patient } from '@/data/types';
import { getEventBus } from '@/orchestration';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';
const RED = '#B42318';

export default function DashboardTab() {
  const router = useRouter();
  const orchestrator = useOrchestrator();
  const patientId = useOrchestratorPatientId();
  void orchestrator;

  const [patient, setPatient] = useState<Patient | null>(() => getPatient(patientId));
  const [alerts, setAlerts] = useState<Alert[]>(() => getActiveAlerts(patientId));
  const [spo2, setSpo2] = useState<number | null>(null);
  const [hr, setHr] = useState<number | null>(null);

  const refresh = useCallback(() => {
    setPatient(getPatient(patientId));
    setAlerts(getActiveAlerts(patientId));
    setSpo2(getLatestHealthSample(patientId, 'spo2')?.value ?? null);
    setHr(getLatestHealthSample(patientId, 'heart_rate')?.value ?? null);
  }, [patientId]);

  useEffect(() => {
    const bus = getEventBus();
    const unsub1 = bus.subscribe('ml_alert_created', () => {
      setTimeout(refresh, 200);
    });
    const unsub2 = bus.subscribe('vitals_sample', () => {
      setTimeout(refresh, 200);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, [refresh]);

  const openAlert = useCallback(
    (alertId: string) => {
      router.push({ pathname: '/alert-detail', params: { alertId } });
    },
    [router],
  );

  const hasEmergency = alerts.some((a) => a.severity === 3);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow="Caregiver Concierge" title="Dashboard" />

        {/* Patient summary */}
        <View style={styles.card}>
          <View style={styles.summaryHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(patient?.name ?? 'Patient')}</Text>
            </View>
            <View style={styles.summaryInfo}>
              <Text style={styles.patientName}>{patient?.name ?? 'Unknown patient'}</Text>
              {patient?.conditions ? (
                <Text style={styles.muted} numberOfLines={2}>
                  {patient.conditions}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.vitalsRow}>
            <View style={styles.vitalChip}>
              <Text style={styles.vitalLabel}>SpO2</Text>
              <Text style={[styles.vitalValue, spo2 != null && spo2 < 90 ? styles.vitalDanger : null]}>
                {spo2 != null ? `${Math.round(spo2 * 100)}%` : '—'}
              </Text>
            </View>
            <View style={styles.vitalChip}>
              <Text style={styles.vitalLabel}>Heart Rate</Text>
              <Text style={styles.vitalValue}>
                {hr != null ? `${Math.round(hr)}` : '—'}
                <Text style={styles.vitalUnit}> bpm</Text>
              </Text>
            </View>
          </View>
        </View>

        {/* Active alerts */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Alerts</Text>
          {alerts.length > 0 ? (
            <Text style={styles.sectionCount}>{alerts.length}</Text>
          ) : null}
        </View>

        {hasEmergency && (
          <View style={styles.emergencyBanner}>
            <Text style={styles.emergencyText}>
              ⚠ Emergency alert active. Tap the red card immediately.
            </Text>
          </View>
        )}

        {alerts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>No active alerts. All vitals within range.</Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <AlertCard key={alert.alertId} alert={alert} onPress={openAlert} />
          ))
        )}

        {/* Quick actions */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Quick Actions</Text>
        <View style={styles.quickGrid}>
          <QuickAction
            label="Care"
            icon="❤️"
            onPress={() => router.push('/(tabs)/care')}
          />
          <QuickAction
            label="Medications"
            icon="💊"
            onPress={() => router.push('/(tabs)/medications')}
          />
          <QuickAction
            label="Schedule"
            icon="📅"
            onPress={() => router.push('/(tabs)/schedule')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.quickIcon}>{icon}</Text>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EAFBF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: TEAL,
    fontWeight: '800',
    fontSize: 16,
  },
  summaryInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
  },
  muted: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  vitalsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  vitalChip: {
    flex: 1,
    backgroundColor: '#F7FAF9',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  vitalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  vitalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: DARK,
    marginTop: 4,
  },
  vitalUnit: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '600',
  },
  vitalDanger: {
    color: RED,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    backgroundColor: TEAL,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  emergencyBanner: {
    backgroundColor: '#FEE4E2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: RED,
  },
  emergencyText: {
    color: RED,
    fontWeight: '700',
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  quickCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  pressed: {
    opacity: 0.85,
  },
  quickIcon: {
    fontSize: 24,
  },
  quickLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK,
  },
});
