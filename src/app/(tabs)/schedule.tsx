/**
 * Schedule tab.
 *
 * Shows a timeline of recent alerts (active + recently resolved) and recent
 * notifications. Appointments are a placeholder — there is no appointments
 * table yet, so we show an "No upcoming appointments" empty state.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertCard } from '@/components/dashboard/alert-card';
import {
  useOrchestratorPatientId,
} from '@/contexts/orchestrator-context';
import {
  getActiveAlerts,
  getNotificationsForPatient,
} from '@/data';
import type { Alert, NotificationRecord } from '@/data/types';
import { getEventBus } from '@/orchestration';

const TEAL = '#0E6F68';
const BG = '#EEF7F6';
const DARK = '#123433';
const MUTED = '#526866';

export default function ScheduleTab() {
  const router = useRouter();
  const patientId = useOrchestratorPatientId();

  const [alerts, setAlerts] = useState<Alert[]>(() => getActiveAlerts(patientId));
  const [notifications, setNotifications] = useState<NotificationRecord[]>(() =>
    getNotificationsForPatient(patientId, 20),
  );

  const refresh = useCallback(() => {
    setAlerts(getActiveAlerts(patientId));
    setNotifications(getNotificationsForPatient(patientId, 20));
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
        <Text style={styles.eyebrow}>Scheduling &amp; Timeline</Text>
        <Text style={styles.title}>Schedule</Text>

        {/* Appointments placeholder */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upcoming Appointments</Text>
          <Text style={styles.muted}>No upcoming appointments.</Text>
        </View>

        {/* Alert timeline */}
        <Text style={styles.sectionTitle}>Alert Timeline</Text>
        {alerts.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>No recent alerts.</Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <AlertCard key={alert.alertId} alert={alert} onPress={openAlert} />
          ))
        )}

        {/* Notifications */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Recent Notifications</Text>
        {notifications.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>No notifications yet.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {notifications.map((n) => (
              <View key={n.notificationId} style={styles.notifRow}>
                <View style={[styles.notifDot, { backgroundColor: severityColor(n.severity) }]} />
                <View style={styles.notifBody}>
                  <Text style={styles.notifTitle} numberOfLines={1}>
                    {n.title}
                  </Text>
                  <Text style={styles.muted} numberOfLines={2}>
                    {n.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function severityColor(severity?: number): string {
  if (severity === 3) return '#B42318';
  if (severity === 2) return '#B54708';
  return TEAL;
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
    gap: 8,
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
  muted: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  notifRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E7EC',
  },
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  notifBody: {
    flex: 1,
    gap: 2,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: DARK,
  },
});
