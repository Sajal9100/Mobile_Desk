import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { SplashScreen } from '../src/screens/SplashScreen';
import { OnboardingScreen } from '../src/screens/OnboardingScreen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { RegisterScreen } from '../src/screens/RegisterScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { ConnectDeviceScreen } from '../src/screens/ConnectDeviceScreen';
import { ConnectWaitingScreen } from '../src/screens/ConnectWaitingScreen';
import { IncomingRequestScreen } from '../src/screens/IncomingRequestScreen';
import { PermissionPreparationScreen } from '../src/screens/PermissionPreparationScreen';
import { SharingActiveScreen } from '../src/screens/SharingActiveScreen';
import { RemoteViewerScreen } from '../src/screens/RemoteViewerScreen';
import { SessionsScreen } from '../src/screens/SessionsScreen';
import { DevicesScreen } from '../src/screens/DevicesScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { AppNavigator } from '../src/navigation/AppNavigator';

describe('MobileDesk UI Screens & Navigation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test('renders SplashScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<SplashScreen />);
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders OnboardingScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <OnboardingScreen onComplete={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders LoginScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <LoginScreen onSignIn={() => {}} onNavigateToRegister={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders RegisterScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <RegisterScreen onBack={() => {}} onRegistered={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders HomeScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <HomeScreen
          userName="Sample User"
          thisPhoneId="482 915 736"
          onConnectPress={() => {}}
          onSeeAllSessions={() => {}}
        />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders ConnectDeviceScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ConnectDeviceScreen onBack={() => {}} onSendRequest={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders ConnectWaitingScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ConnectWaitingScreen
          onBack={() => {}}
          onAccepted={() => {}}
          onRejected={() => {}}
          onExpired={() => {}}
        />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders IncomingRequestScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <IncomingRequestScreen onAccept={() => {}} onReject={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders PermissionPreparationScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <PermissionPreparationScreen
          onBack={() => {}}
          onStartSharing={() => {}}
          onPreviewScreen={() => {}}
        />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders SharingActiveScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <SharingActiveScreen onStopSharing={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders RemoteViewerScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <RemoteViewerScreen onDisconnect={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders SessionsScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<SessionsScreen />);
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders DevicesScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<DevicesScreen />);
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders SettingsScreen correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<SettingsScreen />);
    });
    expect(renderer.toJSON()).toBeDefined();
  });

  test('renders AppNavigator correctly', () => {
    let renderer: any;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<AppNavigator />);
    });
    expect(renderer.toJSON()).toBeDefined();
  });
});
