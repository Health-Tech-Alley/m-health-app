describe('initNotifications', () => {
  const loadService = (permission: {
    status: string;
    granted: boolean;
    canAskAgain: boolean;
  }) => {
    jest.resetModules();

    const notifications = {
      getPermissionsAsync: jest.fn().mockResolvedValue(permission),
      requestPermissionsAsync: jest.fn().mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: false,
      }),
      setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
      addNotificationResponseReceivedListener: jest.fn(),
      AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    };

    jest.doMock('expo-notifications', () => notifications);
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    jest.doMock('@/data', () => ({
      getRecentNotificationForTrigger: jest.fn(),
      insertNotification: jest.fn(),
      updateNotificationAction: jest.fn(),
      updateNotificationDelivered: jest.fn(),
    }));
    jest.doMock('@/services/audit/auditService', () => ({ audit: jest.fn() }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = require('./notificationService') as typeof import('./notificationService');
    return { notifications, service };
  };

  afterEach(() => {
    jest.dontMock('expo-notifications');
    jest.dontMock('react-native');
    jest.dontMock('@/data');
    jest.dontMock('@/services/audit/auditService');
  });

  it('requests permission when the current state is undetermined and askable', async () => {
    const { notifications, service } = loadService({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
    });

    await service.initNotifications();

    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('requests permission when Android reports denied but still askable', async () => {
    const { notifications, service } = loadService({
      status: 'denied',
      granted: false,
      canAskAgain: true,
    });

    await service.initNotifications();

    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not request permission when already granted', async () => {
    const { notifications, service } = loadService({
      status: 'granted',
      granted: true,
      canAskAgain: false,
    });

    await service.initNotifications();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not request permission when denied and not askable', async () => {
    const { notifications, service } = loadService({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    });

    await service.initNotifications();

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
