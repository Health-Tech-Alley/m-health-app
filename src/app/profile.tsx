import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FHIRPatient } from './patientListScreen';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.preview.platform.athenahealth.com';
const BEARER_TOKEN = 'eyJraWQiOiJWUVIxUlRhTkNSU1pkQmpnQ0FRemZzLUNVcWFlU3NCX0NDR0xpek1XcEM0IiwiYWxnIjoiUlMyNTYifQ.eyJ2ZXIiOjEsImp0aSI6IkFULmU4RURuWDdiSUg4QUJLemRtS1lnYzl1QVRCS1p5U3o1U090aDdXNm04SnciLCJpc3MiOiJodHRwczovL2F0aGVuYS5va3RhLmNvbS9vYXV0aDIvYXVzMmhmZWk2b29rUHl5Q0EyOTciLCJhdWQiOiJzdXBwb3J0LXBoaS5hcGkuYXRoZW5haGVhbHRoLmlvIiwiaWF0IjoxNzgxMjc2MDg5LCJleHAiOjE3ODEyNzk2ODksImNpZCI6IjBvYTEwNXR1bDdsNGhSNGQ1Mjk4Iiwic2NwIjpbInN5c3RlbS9Db25kaXRpb24ucmVhZCIsInN5c3RlbS9FbmNvdW50ZXIucmVhZCIsInN5c3RlbS9QYXRpZW50LnJlYWQiXSwic3ViIjoiMG9hMTA1dHVsN2w0aFI0ZDUyOTgiLCJhbmV0VXNlciI6IiIsIm9rdGFVc2VybmFtZSI6IjBvYTEwNXR1bDdsNGhSNGQ1Mjk4In0.IMogBq2w4_XKnVgmM1Hw9kYLsPUMvkgAWzD_oJQ0Hovbfbo4aSU_2piUxm66mFxEMaNVmpXz8xOeZP5E7A_giie5yvz_DfqaNy2BFyzPsUJHMeqIBtf5Srr2UUTKYEWJuTT3ytYjJodxQx5f2_vKNE97uNxzAOs5CgoRXGtO7k5u7LZDXQDjzMR-GcQU7mFZtoCcTvQ_dtiDr7rf7_895O-R6bqAyie8QJ8cphMne3pl-QDIz5Vm-t2F2C9uYfpuWHMBVWyi9Db_rETHqjkkoZTicdTxozg9220zH9Hu9yBHdSam9PeFO9pN5lBz09qbcrFYI-nv-zkpGfG3_Wr8AQ'; // same token as PatientListScreen

// ─── Types ────────────────────────────────────────────────────────────────────

interface Encounter {
  id: string;
  date: string;
  status: string;
  type: string;
  class: string;
  reasonText: string;
  vitals: Vital[];
  loadingVitals: boolean;
  vitalsError: string;
}

interface Vital {
  name: string;
  value: string;
  unit: string;
  date: string;
}

// ─── FHIR fetch helpers ───────────────────────────────────────────────────────

async function fhirGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`
    },
  });
  if (!res.ok) throw new Error(`FHIR error ${res.status}: ${path}`);
  return res.json();
}

function parseEncounters(bundle: any): Omit<Encounter, 'vitals' | 'loadingVitals' | 'vitalsError'>[] {
  return (bundle.entry ?? []).map((e: any) => {
    const r = e.resource;
    const coding = r.type?.[0]?.coding?.[0];
    const type = coding?.display ?? r.type?.[0]?.text ?? 'Encounter';
    const classCode = r.class?.display ?? r.class?.code ?? '';
    const reason =
      r.reasonCode?.[0]?.coding?.[0]?.display ??
      r.reasonCode?.[0]?.text ??
      r.reasonReference?.[0]?.display ??
      '';
    return {
      id: r.id,
      date: r.period?.start ?? r.meta?.lastUpdated ?? '',
      status: r.status ?? '',
      type,
      class: classCode,
      reasonText: reason,
    };
  });
}

// LOINC display map for common vital observation codes
const LOINC_LABELS: Record<string, string> = {
  '8867-4': 'Heart Rate',
  '8480-6': 'Systolic BP',
  '8462-4': 'Diastolic BP',
  '8302-2': 'Height',
  '29463-7': 'Weight',
  '39156-5': 'BMI',
  '8310-5': 'Body Temperature',
  '59408-5': 'Oxygen Saturation',
  '9279-1': 'Respiratory Rate',
  '55284-4': 'Blood Pressure',
  '85354-9': 'Blood Pressure Panel',
};

function parseVitals(bundle: any): Vital[] {
  const vitals: Vital[] = [];
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    if (r.resourceType !== 'Observation') continue;

    const loincCode = r.code?.coding?.find((c: any) => c.system?.includes('loinc'))?.code ?? '';
    const name =
      LOINC_LABELS[loincCode] ??
      r.code?.coding?.[0]?.display ??
      r.code?.text ??
      'Observation';

    // Panel (e.g. Blood Pressure) — expand components
    if (r.component?.length) {
      for (const comp of r.component) {
        const compCode = comp.code?.coding?.find((c: any) => c.system?.includes('loinc'))?.code ?? '';
        const compName =
          LOINC_LABELS[compCode] ??
          comp.code?.coding?.[0]?.display ??
          comp.code?.text ??
          name;
        const val = comp.valueQuantity;
        if (val) {
          vitals.push({
            name: compName,
            value: String(val.value ?? ''),
            unit: val.unit ?? val.code ?? '',
            date: r.effectiveDateTime ?? r.issued ?? '',
          });
        }
      }
      continue;
    }

    const vq = r.valueQuantity ?? r.valueCodeableConcept;
    if (vq) {
      vitals.push({
        name,
        value: vq.value != null ? String(vq.value) : vq.text ?? vq.coding?.[0]?.display ?? '',
        unit: vq.unit ?? vq.code ?? '',
        date: r.effectiveDateTime ?? r.issued ?? '',
      });
    }
  }
  return vitals;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function VitalChip({ vital }: { vital: Vital }) {
  return (
    <View style={styles.vitalChip}>
      <Text style={styles.vitalChipName}>{vital.name}</Text>
      <Text style={styles.vitalChipValue}>
        {vital.value}
        {vital.unit ? <Text style={styles.vitalChipUnit}> {vital.unit}</Text> : null}
      </Text>
    </View>
  );
}

function EncounterCard({
  encounter,
  onExpand,
}: {
  encounter: Encounter;
  onExpand: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) onExpand(encounter.id);
  };

  const statusColor = encounter.status === 'finished' ? '#10B981' : '#F59E0B';

  return (
    <View style={styles.encounterCard}>
      <Pressable style={styles.encounterHeader} onPress={toggle}>
        <View style={styles.encounterHeaderLeft}>
          <Text style={styles.encounterDate}>{formatDate(encounter.date)}</Text>
          <Text style={styles.encounterType}>{encounter.type}</Text>
          {!!encounter.class && (
            <Text style={styles.encounterClass}>{encounter.class}</Text>
          )}
          {!!encounter.reasonText && (
            <Text style={styles.encounterReason}>Reason: {encounter.reasonText}</Text>
          )}
        </View>
        <View style={styles.encounterHeaderRight}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.encounterChevron}>{open ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {open && (
        <View style={styles.vitalsContainer}>
          {encounter.loadingVitals ? (
            <ActivityIndicator color="#3B82F6" style={{ marginVertical: 12 }} />
          ) : encounter.vitalsError ? (
            <Text style={styles.vitalsError}>{encounter.vitalsError}</Text>
          ) : encounter.vitals.length === 0 ? (
            <Text style={styles.noVitals}>No vitals recorded for this encounter.</Text>
          ) : (
            <>
              <Text style={styles.vitalsHeading}>Vitals</Text>
              <View style={styles.vitalsGrid}>
                {encounter.vitals.map((v, i) => (
                  <VitalChip key={i} vital={v} />
                ))}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function age(dob: string): string {
  if (!dob) return '';
  const diff = Date.now() - new Date(dob).getTime();
  return `${Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25))} yrs`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const { patientId, patientJson } = useLocalSearchParams<{
    patientId: string;
    patientJson: string;
  }>();

  console.log('PROFILE PARAMS:', { patientId, patientJson });

  const patient: FHIRPatient | null = patientJson ? JSON.parse(patientJson) : null;

  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loadingEncounters, setLoadingEncounters] = useState(false);
  const [encountersError, setEncountersError] = useState('');

  useEffect(() => {
    console.log('PROFILE SCREEN LOADED');
  }, []);

  // Load encounters on mount
  useEffect(() => {
    if (!patientId) return;
    (async () => {
      setLoadingEncounters(true);
      try {
        const bundle = await fhirGet(
          `/fhir/r4/Encounter?patient=${patientId}&_sort=-date&_count=20`
        );
        const parsed = parseEncounters(bundle).map((enc) => ({
          ...enc,
          vitals: [],
          loadingVitals: false,
          vitalsError: '',
        }));
        setEncounters(parsed);
      } catch (e: any) {
        setEncountersError(e.message ?? 'Could not load encounters');
      } finally {
        setLoadingEncounters(false);
      }
    })();
  }, [patientId]);

  // Called when an encounter card is first expanded
  const loadVitals = async (encounterId: string) => {
    // Already loaded?
    const enc = encounters.find((e) => e.id === encounterId);
    if (!enc || enc.vitals.length > 0 || enc.loadingVitals) return;

    setEncounters((prev) =>
      prev.map((e) => (e.id === encounterId ? { ...e, loadingVitals: true } : e))
    );

    try {
      const bundle = await fhirGet(
        `/fhir/r4/Observation?patient=${patientId}&encounter=${encounterId}&category=vital-signs`
      );
      const vitals = parseVitals(bundle);
      setEncounters((prev) =>
        prev.map((e) =>
          e.id === encounterId ? { ...e, vitals, loadingVitals: false } : e
        )
      );
    } catch (err: any) {
      setEncounters((prev) =>
        prev.map((e) =>
          e.id === encounterId
            ? { ...e, loadingVitals: false, vitalsError: err.message ?? 'Failed to load vitals' }
            : e
        )
      );
    }
  };

  if (!patient) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorText}>Patient data not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Back button */}
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        {/* ── Patient header ── */}
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {patient.fullName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileHeaderInfo}>
            <Text style={styles.profileName}>{patient.fullName}</Text>
            {patient.preferredName !== patient.fullName && (
              <Text style={styles.profilePreferred}>"{patient.preferredName}"</Text>
            )}
            <Text style={styles.profileMeta}>
              {patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}
              {patient.birthDate ? ` · ${age(patient.birthDate)} (${patient.birthDate})` : ''}
            </Text>
          </View>
        </View>

        {/* ── Demographics ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Demographics</Text>
          <InfoRow label="Phone" value={patient.phone} />
          <InfoRow label="Email" value={patient.email} />
          <InfoRow label="Address" value={patient.address} />
          <InfoRow label="Language" value={patient.language} />
          <InfoRow label="Patient ID" value={patient.id} />
        </View>

        {/* ── Encounters ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Encounters{encounters.length > 0 ? ` (${encounters.length})` : ''}
          </Text>

          {loadingEncounters && (
            <ActivityIndicator color="#3B82F6" style={{ marginVertical: 16 }} />
          )}
          {!!encountersError && (
            <Text style={styles.errorText}>{encountersError}</Text>
          )}
          {!loadingEncounters && !encountersError && encounters.length === 0 && (
            <Text style={styles.emptyText}>No encounters found for this patient.</Text>
          )}

          {encounters.map((enc) => (
            <EncounterCard key={enc.id} encounter={enc} onExpand={loadVitals} />
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB', paddingHorizontal: 16 },

  backBtn: { marginTop: 8, marginBottom: 4 },
  backText: { fontSize: 16, color: '#3B82F6', fontWeight: '500' },

  // Profile header
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  profileAvatarText: { fontSize: 28, fontWeight: '700', color: '#1D4ED8' },
  profileHeaderInfo: { flex: 1 },
  profileName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  profilePreferred: { fontSize: 14, color: '#6B7280', fontStyle: 'italic', marginTop: 2 },
  profileMeta: { fontSize: 14, color: '#6B7280', marginTop: 4 },

  // Section wrapper
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  infoLabel: { width: 90, fontSize: 13, color: '#9CA3AF', fontWeight: '500' },
  infoValue: { flex: 1, fontSize: 13, color: '#111827' },

  // Encounter card
  encounterCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  encounterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F9FAFB',
  },
  encounterHeaderLeft: { flex: 1 },
  encounterHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  encounterDate: { fontSize: 13, color: '#6B7280', marginBottom: 2 },
  encounterType: { fontSize: 15, fontWeight: '600', color: '#111827' },
  encounterClass: {
    fontSize: 12,
    color: '#3B82F6',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  encounterReason: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  encounterChevron: { fontSize: 12, color: '#9CA3AF' },

  // Vitals section inside encounter
  vitalsContainer: {
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  vitalsHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vitalChip: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: '44%',
  },
  vitalChipName: { fontSize: 11, color: '#059669', fontWeight: '600', marginBottom: 2 },
  vitalChipValue: { fontSize: 16, fontWeight: '700', color: '#111827' },
  vitalChipUnit: { fontSize: 12, fontWeight: '400', color: '#6B7280' },

  noVitals: { fontSize: 13, color: '#9CA3AF', paddingVertical: 8 },
  vitalsError: { fontSize: 13, color: '#EF4444', paddingVertical: 8 },
  errorText: { color: '#EF4444', fontSize: 14, textAlign: 'center', marginTop: 12 },
  emptyText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },
});