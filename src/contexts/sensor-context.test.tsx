const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Providers started in a test keep polling timers alive; unmount every
// created renderer so their effect cleanups clear those handles and Jest
// can exit.
const mountedRenderers: Array<{ unmount: () => void }> = [];

describe('SensorProvider', () => {
  afterEach(() => {
    for (const renderer of mountedRenderers.splice(0)) {
      try {
        renderer.unmount();
      } catch {
        /* already unmounted */
      }
    }
    jest.resetModules();
    jest.restoreAllMocks();
    jest.dontMock('react-native');
    jest.dontMock('@/contexts/patient-record-context');
    jest.dontMock('@/data/sensors');
  });

  it('keeps normal unsupported startup, patient switching, and foreground changes disconnected', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const harness = loadProviderHarness(() => null);
    const observed = jest.fn();

    const renderer = await harness.render(observed);

    expect(harness.createSensorSource).toHaveBeenCalledWith({ patientId: 'patient-1' });
    expect(lastObserved(observed).status).toBe('unsupported');
    expect(harness.addEventListener).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    harness.patientId = 'patient-2';
    await harness.update(renderer, observed);

    expect(harness.createSensorSource).toHaveBeenCalledWith({ patientId: 'patient-2' });
    expect(lastObserved(observed).status).toBe('unsupported');
    expect(harness.addEventListener).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    harness.emitAppState('background');
    harness.emitAppState('active');

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('does not start publishing when a real source reports unavailable', async () => {
    const startPublishingToEventBus = jest.fn();
    const harness = loadProviderHarness(() => ({
      isAvailable: () => false,
      requestPermissions: jest.fn(),
      query: jest.fn(),
      startPublishingToEventBus,
    }));
    const observed = jest.fn();

    await harness.render(observed);

    expect(lastObserved(observed).status).toBe('unavailable');
    expect(startPublishingToEventBus).not.toHaveBeenCalled();
    expect(harness.addEventListener).not.toHaveBeenCalled();
  });

  it('does not start publishing when Apple Health data is unavailable in the build', async () => {
    class AppleHealthSource {
      isHealthDataAvailable = jest.fn().mockResolvedValue(false);
      startPublishingToEventBus = jest.fn();
      isAvailable() {
        return true;
      }
      requestPermissions = jest.fn();
      query = jest.fn();
    }
    const source = new AppleHealthSource();
    const harness = loadProviderHarness(() => source);
    const observed = jest.fn();

    await harness.render(observed);

    expect(source.isHealthDataAvailable).toHaveBeenCalledTimes(1);
    expect(lastObserved(observed).status).toBe('unavailable');
    expect(source.startPublishingToEventBus).not.toHaveBeenCalled();
    expect(harness.addEventListener).not.toHaveBeenCalled();
  });

  it('starts and stops the Apple Health source only after availability is confirmed', async () => {
    const stopPublishing = jest.fn();
    class AppleHealthSource {
      isHealthDataAvailable = jest.fn().mockResolvedValue(true);
      startPublishingToEventBus = jest.fn(() => stopPublishing);
      isAvailable() {
        return true;
      }
      requestPermissions = jest.fn();
      query = jest.fn();
    }
    const source = new AppleHealthSource();
    const harness = loadProviderHarness(() => source);
    const observed = jest.fn();

    await harness.render(observed);

    expect(lastObserved(observed).status).toBe('available');
    expect(lastObserved(observed).isRealHealth).toBe(true);
    expect(source.startPublishingToEventBus).toHaveBeenCalledTimes(1);
    expect(harness.addEventListener).toHaveBeenCalledTimes(1);

    harness.emitAppState('background');

    expect(stopPublishing).toHaveBeenCalledTimes(1);

    harness.emitAppState('active');

    expect(source.startPublishingToEventBus).toHaveBeenCalledTimes(2);
  });
});

function loadProviderHarness(
  sourceFactory: () => unknown,
) {
  jest.resetModules();

  let patientId = 'patient-1';
  let currentState = 'active';
  let appStateListener: ((state: string) => void) | null = null;

  const removeListener = jest.fn();
  const addEventListener = jest.fn((_event: string, cb: (state: string) => void) => {
    appStateListener = cb;
    return { remove: removeListener };
  });
  const createSensorSource = jest.fn(() => sourceFactory());

  jest.doMock('react-native', () => ({
    AppState: {
      get currentState() {
        return currentState;
      },
      addEventListener,
    },
  }));
  jest.doMock('@/contexts/patient-record-context', () => ({
    usePatientRecord: () => ({ patientId }),
  }));
  jest.doMock('@/contexts/settings-context', () => ({
    useSettings: () => ({ settings: { healthKitIntegrationEnabled: true } }),
  }));
  jest.doMock('@/data/sensors', () => ({
    createSensorSource,
    ALL_HEALTHKIT_READ_TYPES: ['heart_rate', 'blood_oxygen'],
  }));
  // Cut the native expo-sqlite import chain (settings-context → data/index →
  // db.ts) — same minimal stub pattern used across the repo's tests.
  jest.doMock('@/data/db', () => ({
    getDatabase: () => ({
      runSync: () => undefined,
      getFirstSync: () => null,
      getAllSync: () => [],
    }),
    initializeDatabase: () => {},
    closeDatabase: () => {},
    resetDatabase: () => {},
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TestRenderer = require('react-test-renderer');
  const { act } = TestRenderer;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SensorProvider, useSensor } = require('./sensor-context') as typeof import('./sensor-context');

  function Probe({ onValue }: { onValue: (value: ReturnType<typeof useSensor>) => void }) {
    onValue(useSensor());
    return null;
  }

  const tree = (onValue: (value: ReturnType<typeof useSensor>) => void) =>
    React.createElement(
      SensorProvider,
      null,
      React.createElement(Probe, { onValue }),
    );

  return {
    addEventListener,
    createSensorSource,
    get patientId() {
      return patientId;
    },
    set patientId(nextPatientId: string) {
      patientId = nextPatientId;
    },
    async render(onValue: (value: ReturnType<typeof useSensor>) => void) {
      let renderer: typeof TestRenderer.ReactTestRenderer | null = null;
      await act(async () => {
        renderer = TestRenderer.create(tree(onValue));
        await flushPromises();
      });
      mountedRenderers.push(renderer!);
      return renderer!;
    },
    async update(
      renderer: typeof TestRenderer.ReactTestRenderer,
      onValue: (value: ReturnType<typeof useSensor>) => void,
    ) {
      await act(async () => {
        renderer.update(tree(onValue));
        await flushPromises();
      });
    },
    emitAppState(nextState: string) {
      currentState = nextState;
      if (!appStateListener) return;
      act(() => {
        appStateListener?.(nextState);
      });
    },
  };
}

function lastObserved<T>(spy: jest.Mock<T, [T]>): T {
  const calls = spy.mock.calls;
  return calls[calls.length - 1][0];
}
