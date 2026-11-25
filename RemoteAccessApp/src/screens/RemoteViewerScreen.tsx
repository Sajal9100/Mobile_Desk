import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';

interface RemoteViewerScreenProps {
  deviceName?: string;
  deviceId?: string;
  onDisconnect: () => void;
}

export const RemoteViewerScreen: React.FC<RemoteViewerScreenProps> = ({
  deviceName = "Mom's Galaxy A54",
  deviceId = '731 004 582',
  onDisconnect,
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const controls = [
    { name: 'back' as const, label: 'Back' },
    { name: 'home' as const, label: 'Home' },
    { name: 'recents' as const, label: 'Recents' },
    { name: 'type' as const, label: 'Type' },
    { name: 'tap' as const, label: 'Tap' },
  ];

  return (
    <View style={styles.container}>
      <AppHeader
        title={deviceName}
        subtitle={deviceId}
        onBack={onDisconnect}
        rightElement={
          <StatusBadge label="Connecting..." variant="connecting" />
        }
      />
      <MockModeBanner />

      {/* Main Viewport Area (Simulated Screen Stream) */}
      <View style={styles.viewport}>
        <View style={styles.waitingContainer}>
          <ActivityIndicator size="large" color="#38BDF8" />
          <Text style={styles.waitingTitle}>Waiting for their screen...</Text>
          <Text style={styles.mockStreamingNote}>
            MOCK: screen streaming is built in Milestone 6. No video is shown
            until a real stream arrives.
          </Text>
        </View>

        {/* Floating Zoom and Fullscreen Buttons */}
        <View style={styles.fabControlsColumn}>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={() => setZoomLevel(zoomLevel === 1 ? 1.5 : 1)}
            activeOpacity={0.7}
          >
            <Icon name="zoom" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={() => setIsFullscreen(!isFullscreen)}
            activeOpacity={0.7}
          >
            <Icon name="fullscreen" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Remote Interaction Toolbar */}
      <View style={styles.bottomControlsArea}>
        <View style={styles.controlButtonsRow}>
          {controls.map((ctrl) => (
            <TouchableOpacity
              key={ctrl.label}
              style={styles.ctrlBtn}
              activeOpacity={0.7}
            >
              <View style={styles.ctrlIconWrapper}>
                <Icon name={ctrl.name} size={22} color={colors.textSecondary} />
              </View>
              <Text style={styles.ctrlLabel}>{ctrl.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.viewOnlyDisclaimer}>
          View only in this version: you can see the screen but not control it.
        </Text>

        {/* Red End Call / Disconnect Round FAB */}
        <TouchableOpacity
          style={styles.disconnectFab}
          onPress={onDisconnect}
          activeOpacity={0.8}
        >
          <Icon name="disconnect" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  viewport: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  waitingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  waitingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 20,
  },
  mockStreamingNote: {
    fontSize: 13,
    color: '#C084FC',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 12,
  },
  fabControlsColumn: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    gap: 12,
  },
  floatingButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomControlsArea: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: '#18243A',
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  controlButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 10,
  },
  ctrlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  ctrlIconWrapper: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  ctrlLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  viewOnlyDisclaimer: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: 12,
  },
  disconnectFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
});
