/**
 * Care tab.
 *
 * Care management hub: shows active alerts (focused view), recent vitals
 * (latest SpO2 and heart rate), and entry points to the alert-detail and
 * acute-anomaly screens. Care-plan link is a placeholder.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertCard } from '@/components/dashboard/alert-card';
import {
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import {
  getActiveAlerts,
  getLatestHealthSample,
  getPatient,
} from '@/data';
import type { Alert, Patient } from '@/data/types';
import { getEventBus } from '@/orchestration';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';
const RED = '#B42318';

export default function CareTab() {
  const router = useRouter();
  const patientId = useOrchestratorPatientId();

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
    const unsub1 = bus.subscribe('ml_alert_created', () => setTimeout(refresh, 200));
    const unsub2 = bus.subscribe('vitals_sample', () => setTimeout(refresh, 200));
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>Care Management</Text>
        <Text style={styles.title}>Care</Text>

        {/* Patient snapshot */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Patient</Text>
          <Text style={styles.patientName}>{patient?.name ?? 'Unknown'}</Text>
          {patient?.conditions ? (
            <Text style={styles.muted} numberOfLines={2}>
              {patient.conditions}
            </Text>
          ) : null}
        </View>

        {/* Latest vitals */}
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

        {/* Active alerts */}
        <Text style={styles.sectionTitle}>Active Alerts</Text>
        {alerts.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>No active alerts.</Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <AlertCard key={alert.alertId} alert={alert} onPress={openAlert} />
          ))
        )}

        {/* Care plan placeholder */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Care Plan</Text>
        <Pressable
          style={({ pressed }) => [styles.card, styles.linkCard, pressed && styles.pressed]}
          onPress={() => router.push('/care-management')}
        >
          <Text style={styles.linkTitle}>Open Care Management</Text>
          <Text style={styles.muted}>View care plan and trajectory.</Text>
        </Pressable>

        {/* Dev link */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Developer</Text>
        <Pressable
          style={({ pressed }) => [styles.card, styles.linkCard, pressed && styles.pressed]}
          onPress={() => router.push('/acute-anomaly')}
        >
          <Text style={styles.linkTitle}>Acute Anomaly Flow (demo)</Text>
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
  eyebrow: {
    color: TEAL,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: DARK,
    marginTop: 2,
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E4E7EC',
  },
  vitalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  vitalValue: {
    fontSize: 24,
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  linkCard: {
    gap: 4,
  },
  pressed: {
    opacity: 0.85,
  },
  linkTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEAL,
  },
});
