const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const demoCases = [
  {
    profileId: 'james-okafor',
    label: 'James',
    importedPatientId: 'patient-james',
    expectedSpo2Cutoff: '94%',
    expectedBaselineHeartRate: '70-90 BPM',
  },
  {
    profileId: 'sofia-reyes',
    label: 'Sofia',
    importedPatientId: 'patient-sofia',
    expectedSpo2Cutoff: '95%',
    expectedBaselineHeartRate: '75-100 BPM',
  },
  {
    profileId: 'mike-ehr-v62',
    label: 'Mike v6.2',
    importedPatientId: 'patient-mike',
    expectedSpo2Cutoff: '92%',
    expectedBaselineHeartRate: '60-100 BPM',
  },
];

describe('SelectFhirProfileScreen explicit Demo import', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it.each(demoCases)(
    'persists approved manual Demo vitals for $label',
    async ({
      profileId,
      label,
      importedPatientId,
      expectedSpo2Cutoff,
      expectedBaselineHeartRate,
    }) => {
      const harness = loadScreenHarness({
        profile: makeProfileEntry(profileId, label),
        importedPatient: makeImportedPatient(importedPatientId),
      });

      const renderer = await harness.render();
      await harness.pressAction(renderer, 'Demo data');

      expect(harness.upsertPatient).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: importedPatientId,
          spo2Cutoff: expectedSpo2Cutoff,
          baselineHeartRate: expectedBaselineHeartRate,
        }),
      );
      expect(harness.refreshPatientRecord).toHaveBeenCalledWith(importedPatientId);
      expect(
        harness.upsertPatient.mock.invocationCallOrder[0],
      ).toBeLessThan(harness.refreshPatientRecord.mock.invocationCallOrder[0]);
    },
  );

  it('preserves Elena EHR vitals when explicit Demo has no baseline values', async () => {
    const harness = loadScreenHarness({
      profile: makeProfileEntry('elena-gracia', 'Elena'),
      importedPatient: makeImportedPatient('patient-elena', {
        spo2Cutoff: '87%',
        baselineHeartRate: '68-82 BPM',
      }),
    });

    const renderer = await harness.render();
    await harness.pressAction(renderer, 'Demo data');

    expect(harness.upsertPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient-elena',
        spo2Cutoff: '87%',
        baselineHeartRate: '68-82 BPM',
      }),
    );
  });

  it('does not apply Demo values during the ordinary EHR-only import action', async () => {
    const harness = loadScreenHarness({
      profile: makeProfileEntry('james-okafor', 'James'),
      importedPatient: makeImportedPatient('patient-james'),
    });

    const renderer = await harness.render();
    await harness.pressAction(renderer, 'Import EHR only');

    expect(harness.upsertPatient).not.toHaveBeenCalled();
    expect(harness.saveOnboardingProfile).not.toHaveBeenCalled();
    expect(harness.refreshPatientRecord).toHaveBeenCalledWith('patient-james');
  });
});

function loadScreenHarness({
  profile,
  importedPatient,
}: {
  profile: { id: string; label: string; data: unknown };
  importedPatient: Record<string, unknown>;
}) {
  jest.resetModules();

  const back = jest.fn();
  const dispatch = jest.fn();
  const importFHIRBundle = jest.fn(() => importedPatient.patientId);
  const refreshPatientRecord = jest.fn();
  const getPatient = jest.fn(() => importedPatient);
  const upsertCaregiver = jest.fn();
  const upsertPatient = jest.fn();
  const saveOnboardingProfile = jest.fn();

  jest.doMock('expo-router', () => ({
    useRouter: () => ({ back }),
  }));
  jest.doMock('react-native-safe-area-context', () => {
    const React = require('react');
    const { View } = require('react-native');

    return {
      SafeAreaView: ({ children, ...props }: { children: unknown }) =>
        React.createElement(View, props, children),
    };
  });
  jest.doMock('@/components/AppIcon', () => {
    const React = require('react');
    const { View } = require('react-native');

    return {
      AppIcon: () => React.createElement(View, { testID: 'app-icon' }),
    };
  });
  jest.doMock('@/constants/theme', () => ({
    AppTheme: {
      colors: {
        brand: '#0E6F68',
        brandSoft: '#E4F4F1',
        border: '#D6DEE3',
        screen: '#F6F8F7',
        surface: '#FFFFFF',
        text: '#172126',
        textMuted: '#6B7680',
        textSoft: '#4F5B66',
      },
      radius: {
        card: 12,
      },
    },
  }));
  jest.doMock('@/data/fhir/patient-profiles', () => ({
    __esModule: true,
    default: [profile],
  }));
  jest.doMock('@/data/fhir/onboarding-import-mapper', () => ({
    mapFhirBundleToOnboardingImport: jest.fn(() => ({
      clinicalImport: {
        source: { bundleType: 'collection' },
        conditions: [],
        activeMedicationRequests: [],
        observations: [],
      },
    })),
  }));
  jest.doMock('@/contexts/patient-record-context', () => ({
    usePatientRecord: () => ({ importFHIRBundle }),
    refreshPatientRecord,
  }));
  jest.doMock('@/data', () => ({
    getPatient,
    setBundlePending: jest.fn(),
    setBundleStatus: jest.fn(),
    upsertCaregiver,
    upsertPatient,
  }));
  jest.doMock('@/store/hooks', () => ({
    useAppDispatch: () => dispatch,
  }));
  jest.doMock('@/store/reducers/patientSlice', () => ({
    addPatient: jest.fn((payload) => ({ type: 'patient/addPatient', payload })),
  }));
  jest.doMock('@/services/notifications', () => ({
    emitInAppBanner: jest.fn(),
  }));
  jest.doMock('@/clinical-evidence/condition-bundler', () => ({
    bundleConditionPack: jest.fn().mockResolvedValue(undefined),
    bundleMedicationPack: jest.fn().mockResolvedValue(undefined),
    bundleSdohPack: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('@/services/onboarding/onboardingService', () => ({
    getOnboardingProfile: jest.fn(() => makeBlankOnboardingProfile()),
    saveOnboardingProfile,
  }));

  const React = require('react');
  const TestRenderer = require('react-test-renderer');
  const { act } = TestRenderer;
  const SelectFhirProfileScreen = require('@/app/select-fhir-profile').default;

  return {
    refreshPatientRecord,
    saveOnboardingProfile,
    upsertPatient,
    async render() {
      let renderer: { root: unknown; unmount: () => void } | null = null;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(SelectFhirProfileScreen));
        await flushPromises();
      });
      return renderer!;
    },
    async pressAction(
      renderer: { root: { findAll: (predicate: (node: any) => boolean) => any[] } },
      label: string,
    ) {
      const actions = renderer.root.findAll(
        (node: any) =>
          typeof node.props?.onPress === 'function' &&
          node.findAll((child: any) => child.props?.children === label).length > 0,
      );

      expect(actions).toHaveLength(1);

      await act(async () => {
        await actions[0].props.onPress();
        await flushPromises();
      });
    },
  };
}

function makeProfileEntry(id: string, label: string) {
  return {
    id,
    label,
    data: { resourceType: 'Bundle', id: `${id}-bundle` },
  };
}

function makeImportedPatient(
  patientId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    patientId,
    name: 'Imported Patient',
    preferredName: '',
    baselineDailyRoutine: '',
    safetyNotes: '',
    spo2Cutoff: '',
    baselineHeartRate: '',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeBlankOnboardingProfile() {
  return {
    caregiver: {
      name: '',
      relationship: '',
      phone: '',
    },
    patient: {
      name: '',
      preferredName: '',
      baselineDailyRoutine: '',
    },
    primaryCareProvider: {
      name: '',
      phone: '',
      email: '',
    },
    safety: {
      safetyNotes: '',
    },
  };
}
