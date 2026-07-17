describe('createSensorSource', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('react-native');
    jest.dontMock('./mock-sensor-source');
    jest.dontMock('./apple-health-source');
    jest.dontMock('../repositories/patientRepository');
  });

  it('does not create a MockSensorSource on Android by default', () => {
    const { sensors, MockSensorSource, AppleHealthSource } = loadFactory('android');

    const source = sensors.createSensorSource({ patientId: 'patient-1' });

    expect(source).toBeNull();
    expect(MockSensorSource).not.toHaveBeenCalled();
    expect(AppleHealthSource).not.toHaveBeenCalled();
  });

  it('preserves the Apple Health production source on iOS', () => {
    const { sensors, MockSensorSource, AppleHealthSource } = loadFactory('ios');

    const source = sensors.createSensorSource({ patientId: 'patient-1' });

    expect(source).toEqual({ kind: 'apple-health', patientId: 'patient-1' });
    expect(AppleHealthSource).toHaveBeenCalledWith({ patientId: 'patient-1' });
    expect(MockSensorSource).not.toHaveBeenCalled();
  });

  it('keeps mock creation available only through an explicit forceMock action', () => {
    const { sensors, MockSensorSource, AppleHealthSource } = loadFactory('android');

    const source = sensors.createSensorSource({
      patientId: 'patient-1',
      forceMock: true,
    });

    expect(source).toEqual({
      kind: 'mock',
      patientId: 'patient-1',
      persona: 'copd-tbi',
    });
    expect(MockSensorSource).toHaveBeenCalledWith({
      patientId: 'patient-1',
      persona: 'copd-tbi',
    });
    expect(AppleHealthSource).not.toHaveBeenCalled();
  });
});

function loadFactory(platform: 'android' | 'ios') {
  jest.resetModules();

  const MockSensorSource = jest.fn((options: { patientId: string; persona: string }) => ({
    kind: 'mock',
    patientId: options.patientId,
    persona: options.persona,
  }));
  const AppleHealthSource = jest.fn((options: { patientId: string }) => ({
    kind: 'apple-health',
    patientId: options.patientId,
  }));

  jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
  jest.doMock('./mock-sensor-source', () => ({ MockSensorSource }));
  jest.doMock('./apple-health-source', () => ({ AppleHealthSource }));
  jest.doMock('../repositories/patientRepository', () => ({
    getPatient: jest.fn(() => null),
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sensors = require('./index') as typeof import('./index');
  return { sensors, MockSensorSource, AppleHealthSource };
}
