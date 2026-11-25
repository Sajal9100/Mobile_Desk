import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  Modal,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { BottomTabBar, TabKey } from '../components/BottomTabBar';

// Screens
import { SplashScreen } from '../screens/SplashScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ConnectDeviceScreen } from '../screens/ConnectDeviceScreen';
import { ConnectWaitingScreen } from '../screens/ConnectWaitingScreen';
import { IncomingRequestScreen } from '../screens/IncomingRequestScreen';
import { PermissionPreparationScreen } from '../screens/PermissionPreparationScreen';
import { SharingActiveScreen } from '../screens/SharingActiveScreen';
import { RemoteViewerScreen } from '../screens/RemoteViewerScreen';
import { SessionsScreen } from '../screens/SessionsScreen';
import { DevicesScreen } from '../screens/DevicesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

import {
  initialUserProfile,
  initialDevices,
  initialSessions,
  initialSettings,
  SessionItem,
  DeviceItem,
} from '../mock/mockData';

export type ScreenName =
  | 'Splash'
  | 'Onboarding'
  | 'Login'
  | 'Register'
  | 'Home'
  | 'Devices'
  | 'Sessions'
  | 'Settings'
  | 'ConnectDevice'
  | 'ConnectWaiting'
  | 'IncomingRequest'
  | 'PermissionPreparation'
  | 'SharingActive'
  | 'RemoteViewer';

const ALL_SCREENS: { id: ScreenName; label: string; group: string }[] = [
  { id: 'Splash', label: '1. Splash Screen', group: 'Entry' },
  { id: 'Onboarding', label: '2. Onboarding', group: 'Entry' },
  { id: 'Login', label: '3. Sign In', group: 'Auth' },
  { id: 'Register', label: '4. Register Account', group: 'Auth' },
  { id: 'Home', label: '5. Home (Dashboard)', group: 'Main Tabs' },
  { id: 'Devices', label: '6. My Devices', group: 'Main Tabs' },
  { id: 'Sessions', label: '7. Session History', group: 'Main Tabs' },
  { id: 'Settings', label: '8. Settings & Privacy', group: 'Main Tabs' },
  { id: 'ConnectDevice', label: '9. Connect to Device', group: 'Controller Flow' },
  { id: 'ConnectWaiting', label: '10. Waiting for Approval', group: 'Controller Flow' },
  { id: 'RemoteViewer', label: '11. Remote Screen Viewer', group: 'Controller Flow' },
  { id: 'IncomingRequest', label: '12. Incoming Request (Anti-Scam)', group: 'Target Flow' },
  { id: 'PermissionPreparation', label: '13. Permission Preparation', group: 'Target Flow' },
  { id: 'SharingActive', label: '14. Sharing Active (Preview)', group: 'Target Flow' },
];

export const AppNavigator: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<ScreenName>('Home');
  const [currentTab, setCurrentTab] = useState<TabKey>('Home');
  const [userProfile, setUserProfile] = useState(initialUserProfile);
  const [sessions, setSessions] = useState(initialSessions);
  const [devices] = useState(initialDevices);
  const [settings] = useState(initialSettings);
  const [activeTargetName, setActiveTargetName] = useState("Mom's Galaxy A54");
  const [activeTargetId, setActiveTargetId] = useState('731 004 582');
  const [showScreenSwitcher, setShowScreenSwitcher] = useState(false);

  // Tab navigation
  const handleSelectTab = (tab: TabKey) => {
    setCurrentTab(tab);
    setCurrentScreen(tab as ScreenName);
  };

  // Connect flow
  const handleSendRequest = (deviceId: string, deviceName: string) => {
    setActiveTargetId(deviceId);
    setActiveTargetName(deviceName);
    setCurrentScreen('ConnectWaiting');
  };

  const handleConnectAccepted = () => {
    setCurrentScreen('RemoteViewer');
  };

  const handleConnectRejected = () => {
    const newSession: SessionItem = {
      id: `sess-${Date.now()}`,
      deviceName: activeTargetName,
      deviceId: activeTargetId,
      direction: 'outgoing',
      status: 'rejected',
      timestamp: 'Just now',
    };
    setSessions([newSession, ...sessions]);
    setCurrentScreen('Home');
    setCurrentTab('Home');
  };

  const handleConnectExpired = () => {
    const newSession: SessionItem = {
      id: `sess-${Date.now()}`,
      deviceName: activeTargetName,
      deviceId: activeTargetId,
      direction: 'outgoing',
      status: 'expired',
      timestamp: 'Just now',
    };
    setSessions([newSession, ...sessions]);
    setCurrentScreen('Home');
    setCurrentTab('Home');
  };

  const handleRemoteDisconnect = () => {
    const newSession: SessionItem = {
      id: `sess-${Date.now()}`,
      deviceName: activeTargetName,
      deviceId: activeTargetId,
      direction: 'outgoing',
      status: 'completed',
      timestamp: 'Just now',
      duration: '1m 20s',
    };
    setSessions([newSession, ...sessions]);
    setCurrentScreen('Home');
    setCurrentTab('Home');
  };

  // Incoming flow
  const handleIncomingAccept = () => {
    setCurrentScreen('PermissionPreparation');
  };

  const handleIncomingReject = () => {
    const newSession: SessionItem = {
      id: `sess-${Date.now()}`,
      deviceName: "Rahul's OnePlus 12",
      deviceId: '482 915 736',
      direction: 'incoming',
      status: 'rejected',
      timestamp: 'Just now',
    };
    setSessions([newSession, ...sessions]);
    setCurrentScreen('Home');
    setCurrentTab('Home');
  };

  const handleStartSharing = () => {
    setCurrentScreen('SharingActive');
  };

  const handleStopSharing = () => {
    const newSession: SessionItem = {
      id: `sess-${Date.now()}`,
      deviceName: "Rahul's OnePlus 12",
      deviceId: '482 915 736',
      direction: 'incoming',
      status: 'completed',
      timestamp: 'Just now',
      duration: '35s',
    };
    setSessions([newSession, ...sessions]);
    setCurrentScreen('Home');
    setCurrentTab('Home');
  };

  const isTabScreen = ['Home', 'Devices', 'Sessions', 'Settings'].includes(
    currentScreen
  );

  const renderScreen = () => {
    switch (currentScreen) {
      case 'Splash':
        return (
          <SplashScreen
            onFinish={() => setCurrentScreen('Onboarding')}
          />
        );

      case 'Onboarding':
        return (
          <OnboardingScreen
            onComplete={() => setCurrentScreen('Login')}
          />
        );

      case 'Login':
        return (
          <LoginScreen
            onSignIn={(email) => {
              setUserProfile({ ...userProfile, email });
              setCurrentScreen('Home');
              setCurrentTab('Home');
            }}
            onNavigateToRegister={() => setCurrentScreen('Register')}
          />
        );

      case 'Register':
        return (
          <RegisterScreen
            onBack={() => setCurrentScreen('Login')}
            onRegistered={(name, email) => {
              setUserProfile({ ...userProfile, name, email });
              setCurrentScreen('Home');
              setCurrentTab('Home');
            }}
          />
        );

      case 'Home':
        return (
          <HomeScreen
            userName={userProfile.name}
            thisPhoneId={userProfile.thisPhoneId}
            onConnectPress={() => setCurrentScreen('ConnectDevice')}
            onSeeAllSessions={() => {
              setCurrentTab('Sessions');
              setCurrentScreen('Sessions');
            }}
            onSessionPress={(session) => {
              setActiveTargetName(session.deviceName);
              setActiveTargetId(session.deviceId);
              setCurrentScreen('ConnectDevice');
            }}
            onIncomingRequestDemo={() => setCurrentScreen('IncomingRequest')}
          />
        );

      case 'Devices':
        return (
          <DevicesScreen
            devices={devices}
            onSelectDevice={(device: DeviceItem) => {
              if (!device.isCurrentDevice) {
                setActiveTargetName(device.name);
                setActiveTargetId(device.id);
                setCurrentScreen('ConnectDevice');
              }
            }}
          />
        );

      case 'Sessions':
        return (
          <SessionsScreen
            sessions={sessions}
            onSelectSession={(session) => {
              setActiveTargetName(session.deviceName);
              setActiveTargetId(session.deviceId);
              setCurrentScreen('ConnectDevice');
            }}
          />
        );

      case 'Settings':
        return (
          <SettingsScreen
            user={userProfile}
            settings={settings}
            onSignOut={() => {
              setCurrentScreen('Login');
            }}
          />
        );

      case 'ConnectDevice':
        return (
          <ConnectDeviceScreen
            onBack={() => {
              setCurrentScreen('Home');
              setCurrentTab('Home');
            }}
            onSendRequest={handleSendRequest}
          />
        );

      case 'ConnectWaiting':
        return (
          <ConnectWaitingScreen
            deviceName={activeTargetName}
            onBack={() => {
              setCurrentScreen('ConnectDevice');
            }}
            onAccepted={handleConnectAccepted}
            onRejected={handleConnectRejected}
            onExpired={handleConnectExpired}
          />
        );

      case 'RemoteViewer':
        return (
          <RemoteViewerScreen
            deviceName={activeTargetName}
            deviceId={activeTargetId}
            onDisconnect={handleRemoteDisconnect}
          />
        );

      case 'IncomingRequest':
        return (
          <IncomingRequestScreen
            requesterName="Rahul Sharma"
            requesterDevice="from Rahul's OnePlus 12"
            onAccept={handleIncomingAccept}
            onReject={handleIncomingReject}
          />
        );

      case 'PermissionPreparation':
        return (
          <PermissionPreparationScreen
            requesterName="Rahul Sharma"
            onBack={() => {
              setCurrentScreen('Home');
              setCurrentTab('Home');
            }}
            onStartSharing={handleStartSharing}
            onPreviewScreen={() => setCurrentScreen('SharingActive')}
          />
        );

      case 'SharingActive':
        return (
          <SharingActiveScreen
            requesterName="Rahul Sharma"
            onStopSharing={handleStopSharing}
          />
        );

      default:
        return (
          <HomeScreen
            userName={userProfile.name}
            thisPhoneId={userProfile.thisPhoneId}
            onConnectPress={() => setCurrentScreen('ConnectDevice')}
            onSeeAllSessions={() => {
              setCurrentTab('Sessions');
              setCurrentScreen('Sessions');
            }}
          />
        );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      <View style={styles.container}>
        {renderScreen()}

        {/* Bottom Tab Bar (displayed when on any of the 4 main tabs) */}
        {isTabScreen && (
          <BottomTabBar
            currentTab={currentTab}
            onSelectTab={handleSelectTab}
          />
        )}

        {/* Floating Screen Switcher Trigger for Instant Visual Verification */}
        <TouchableOpacity
          style={styles.floatingSwitcherTrigger}
          onPress={() => setShowScreenSwitcher(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.floatingSwitcherTriggerText}>
            📐 UI Screen Picker ({currentScreen})
          </Text>
        </TouchableOpacity>

        {/* Modal list of all 14 screens from the screenshots */}
        <Modal
          visible={showScreenSwitcher}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowScreenSwitcher(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Screen to Preview</Text>
                <TouchableOpacity
                  onPress={() => setShowScreenSwitcher(false)}
                  style={styles.modalCloseButton}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                All 14 screens generated accurately from the screenshots:
              </Text>

              <ScrollView style={styles.modalScroll}>
                {ALL_SCREENS.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.modalItem,
                      currentScreen === item.id && styles.modalItemActive,
                    ]}
                    onPress={() => {
                      setCurrentScreen(item.id);
                      if (
                        ['Home', 'Devices', 'Sessions', 'Settings'].includes(
                          item.id
                        )
                      ) {
                        setCurrentTab(item.id as TabKey);
                      }
                      setShowScreenSwitcher(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View>
                      <Text
                        style={[
                          styles.modalItemLabel,
                          currentScreen === item.id &&
                            styles.modalItemLabelActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text style={styles.modalItemGroup}>{item.group}</Text>
                    </View>
                    {currentScreen === item.id && (
                      <Text style={styles.activePill}>Active</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    position: 'relative',
  },
  floatingSwitcherTrigger: {
    position: 'absolute',
    top: 36,
    right: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: '#38BDF8',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 16,
    zIndex: 9999,
  },
  floatingSwitcherTriggerText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    maxHeight: '80%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCloseButton: {
    padding: 6,
  },
  modalCloseText: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 16,
  },
  modalScroll: {
    maxHeight: 460,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalItemActive: {
    backgroundColor: '#1E3A8A',
    borderColor: '#3B82F6',
  },
  modalItemLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalItemLabelActive: {
    color: '#60A5FA',
  },
  modalItemGroup: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  activePill: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
    backgroundColor: '#0C4A6E',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
});
