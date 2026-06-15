import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FHIRPatient {
  id: string;
  fullName: string;
  preferredName: string;
  gender: string;
  birthDate: string;
  phone: string;
  email: string;
  address: string;
  language: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.preview.platform.athenahealth.com';
const PRACTICE_ID = 'a-1.Practice-195900';

// Replace with your OAuth2 bearer token. In production, load this from a
// secure token store / auth context.
const BEARER_TOKEN = 'eyJraWQiOiJWUVIxUlRhTkNSU1pkQmpnQ0FRemZzLUNVcWFlU3NCX0NDR0xpek1XcEM0IiwiYWxnIjoiUlMyNTYifQ.eyJ2ZXIiOjEsImp0aSI6IkFULmU4RURuWDdiSUg4QUJLemRtS1lnYzl1QVRCS1p5U3o1U090aDdXNm04SnciLCJpc3MiOiJodHRwczovL2F0aGVuYS5va3RhLmNvbS9vYXV0aDIvYXVzMmhmZWk2b29rUHl5Q0EyOTciLCJhdWQiOiJzdXBwb3J0LXBoaS5hcGkuYXRoZW5haGVhbHRoLmlvIiwiaWF0IjoxNzgxMjc2MDg5LCJleHAiOjE3ODEyNzk2ODksImNpZCI6IjBvYTEwNXR1bDdsNGhSNGQ1Mjk4Iiwic2NwIjpbInN5c3RlbS9Db25kaXRpb24ucmVhZCIsInN5c3RlbS9FbmNvdW50ZXIucmVhZCIsInN5c3RlbS9QYXRpZW50LnJlYWQiXSwic3ViIjoiMG9hMTA1dHVsN2w0aFI0ZDUyOTgiLCJhbmV0VXNlciI6IiIsIm9rdGFVc2VybmFtZSI6IjBvYTEwNXR1bDdsNGhSNGQ1Mjk4In0.IMogBq2w4_XKnVgmM1Hw9kYLsPUMvkgAWzD_oJQ0Hovbfbo4aSU_2piUxm66mFxEMaNVmpXz8xOeZP5E7A_giie5yvz_DfqaNy2BFyzPsUJHMeqIBtf5Srr2UUTKYEWJuTT3ytYjJodxQx5f2_vKNE97uNxzAOs5CgoRXGtO7k5u7LZDXQDjzMR-GcQU7mFZtoCcTvQ_dtiDr7rf7_895O-R6bqAyie8QJ8cphMne3pl-QDIz5Vm-t2F2C9uYfpuWHMBVWyi9Db_rETHqjkkoZTicdTxozg9220zH9Hu9yBHdSam9PeFO9pN5lBz09qbcrFYI-nv-zkpGfG3_Wr8AQ';

// ─── FHIR helpers ─────────────────────────────────────────────────────────────

function parseName(nameArr: any[]): { full: string; preferred: string } {
  if (!nameArr?.length) return { full: 'Unknown', preferred: 'Unknown' };
  const official = nameArr.find((n) => n.use === 'official') ?? nameArr[0];
  const usual = nameArr.find((n) => n.use === 'usual') ?? official;
  const givenOfficial = (official.given ?? []).join(' ');
  const givenUsual = (usual.given ?? []).join(' ');
  return {
    full: [givenOfficial, official.family].filter(Boolean).join(' '),
    preferred: [givenUsual, usual.family].filter(Boolean).join(' '),
  };
}

function parsePatient(resource: any): FHIRPatient {
  const { full, preferred } = parseName(resource.name);
  const homePhone = resource.telecom?.find(
    (t: any) => t.system === 'phone' && t.use === 'home'
  )?.value ?? '';
  const email = resource.telecom?.find((t: any) => t.system === 'email')?.value ?? '';
  const homeAddr = resource.address?.find((a: any) => a.use === 'home');
  const address = homeAddr
    ? [homeAddr.line?.join(', '), homeAddr.city, homeAddr.state, homeAddr.postalCode]
        .filter(Boolean)
        .join(', ')
    : '';
  const language =
    resource.communication?.[0]?.language?.text ?? '';

  return {
    id: resource.id,
    fullName: full,
    preferredName: preferred,
    gender: resource.gender ?? '',
    birthDate: resource.birthDate ?? '',
    phone: homePhone,
    email,
    address,
    language,
  };
}

export async function fetchPatients(name: string): Promise<FHIRPatient[]> {
    console.log('Fetching patients with name:', name);
  const url = `${BASE_URL}/fhir/r4/Patient?ah-practice=Organization/${PRACTICE_ID}&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`
    },
  });
  console.log('FHIR response status:', res.status);
//   console.log('FHIR response body:', await res.json());
  if (!res.ok) throw new Error(`Patient search failed: ${res.status}`);
  const bundle = await res.json();
  return (bundle.entry ?? []).map((e: any) => parsePatient(e.resource));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatientListScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('Sandboxtest');
  const [patients, setPatients] = useState<FHIRPatient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const results = await fetchPatients(query.trim());
      setPatients(results);
    } catch (e: any) {
      setError(e.message ?? 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { search(); }, []);

  const onSelect = (patient: FHIRPatient) => {
    console.log('Selected patient:', patient);
    router.push({
      pathname: '/profile',
      params: {
        patientId: patient.id,
        patientJson: JSON.stringify(patient),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>Patients</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name…"
          returnKeyType="search"
          onSubmitEditing={search}
          placeholderTextColor="#9CA3AF"
        />
        <Pressable style={styles.searchBtn} onPress={search}>
          <Text style={styles.searchBtnText}>Search</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 24 }} color="#3B82F6" />}
      {!!error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={patients}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onSelect(item)}
          >
            <View style={styles.cardLeft}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.fullName.charAt(0).toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardName}>{item.fullName}</Text>
              {item.preferredName !== item.fullName && (
                <Text style={styles.cardSub}>Goes by: {item.preferredName}</Text>
              )}
              <Text style={styles.cardSub}>
                {item.gender.charAt(0).toUpperCase() + item.gender.slice(1)} · DOB {item.birthDate}
              </Text>
              {!!item.phone && <Text style={styles.cardSub}>{item.phone}</Text>}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB', paddingHorizontal: 16 },
  heading: { fontSize: 28, fontWeight: '700', color: '#111827', marginVertical: 16 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  searchBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  error: { color: '#EF4444', marginBottom: 12, textAlign: 'center' },
  separator: { height: 1, backgroundColor: '#F3F4F6' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardPressed: { opacity: 0.75 },
  cardLeft: { marginRight: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#1D4ED8' },
  cardBody: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  chevron: { fontSize: 22, color: '#9CA3AF' },
});