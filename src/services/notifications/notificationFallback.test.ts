import {
  _clearInAppBannerListeners,
  emitInAppBanner,
  onInAppBanner,
  type InAppBannerPayload,
} from './notificationFallback';

describe('notificationFallback', () => {
  beforeEach(() => {
    _clearInAppBannerListeners();
  });

  afterEach(() => {
    _clearInAppBannerListeners();
  });

  it('delivers the import success payload shape to existing banner listeners', () => {
    const handler = jest.fn<void, [InAppBannerPayload]>();
    onInAppBanner(handler);

    emitInAppBanner({
      title: 'EHR Import',
      body: 'FHIR bundle "Demo Profile" imported successfully',
      severity: 1,
    });

    expect(handler).toHaveBeenCalledWith({
      title: 'EHR Import',
      body: 'FHIR bundle "Demo Profile" imported successfully',
      severity: 1,
    });
  });
});
