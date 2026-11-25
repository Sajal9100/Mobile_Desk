import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';

interface ConnectWaitingScreenProps {
  deviceName?: string;
  onBack: () => void;
  onAccepted: () => void;
  onRejected: () => void;
  onExpired: () => void;
}

export const ConnectWaitingScreen: React.FC<ConnectWaitingScreenProps> = ({
  deviceName = "Mom's Galaxy A54",
  onBack,
  onAccepted,
  onRejected,
  onExpired,
}) => {
  return (
    <View style={styles.container}>
      <AppHeader title="Connect to a device" onBack={onBack} />
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Animated / styled waiting indicator */}
        <View style={styles.iconCircle}>
          <Icon name="clock" size={40} color="#38BDF8" />
        </View>

        <StatusBadge
          label="Waiting for the other person to accept..."
          variant="waiting"
        />

        <Text style={styles.deviceName}>{deviceName}</Text>
        <Text style={styles.description}>
          The owner of this phone needs to accept your request. Ask them to
          check their screen.
        </Text>

        {/* Mock Simulation Box */}
        <View style={styles.mockBox}>
          <Text style={styles.mockBoxTitle}>
            ⚗️ MOCK: simulate the other phone's answer
          </Text>
          <View style={styles.simButtonsRow}>
            <Button
              title="Accepted"
              onPress={onAccepted}
              variant="dark"
              style={styles.simButton}
              textStyle={styles.simButtonText}
            />
            <Button
              title="Rejected"
              onPress={onRejected}
              variant="dark"
              style={styles.simButton}
              textStyle={styles.simButtonText}
            />
            <Button
              title="Expired"
              onPress={onExpired}
              variant="dark"
              style={styles.simButton}
              textStyle={styles.simButtonText}
            />
          </View>
        </View>
      </ScrollView>

      {/* Bottom Cancel Action */}
      <View style={styles.bottomBar}>
        <Button
          title="Cancel request"
          onPress={onBack}
          variant="secondary"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 90,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#13243F',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  deviceName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 20,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 10,
    paddingHorizontal: 16,
  },
  mockBox: {
    width: '100%',
    backgroundColor: colors.mockBoxBg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.mockBoxBorder,
    borderRadius: 14,
    padding: 16,
    marginTop: 48,
  },
  mockBoxTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.mockBannerText,
    marginBottom: 12,
  },
  simButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  simButton: {
    flex: 1,
    height: 44,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  simButtonText: {
    fontSize: 14,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: '#18243A',
  },
});
