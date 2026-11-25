import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { DeviceItem, initialDevices } from '../mock/mockData';

interface ConnectDeviceScreenProps {
  onBack: () => void;
  onSendRequest: (deviceId: string, deviceName: string) => void;
}

export const ConnectDeviceScreen: React.FC<ConnectDeviceScreenProps> = ({
  onBack,
  onSendRequest,
}) => {
  const [deviceId, setDeviceId] = useState('123 456 789');

  const savedDevices = initialDevices.filter((d) => !d.isCurrentDevice);

  const handleSelectDevice = (device: DeviceItem) => {
    setDeviceId(device.id);
  };

  const handleSend = () => {
    const targetName =
      savedDevices.find((d) => d.id === deviceId)?.name || "Mom's Galaxy A54";
    onSendRequest(deviceId, targetName);
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Connect to a device" onBack={onBack} />
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.subtitle}>
          Enter the ID shown on the other phone's MobileDesk home screen.
          They'll need to accept before you can see anything.
        </Text>

        <Input
          label="Device ID"
          value={deviceId}
          onChangeText={setDeviceId}
          placeholder="123 456 789"
          keyboardType="numeric"
        />

        <Text style={styles.sectionLabel}>YOUR DEVICES</Text>

        {savedDevices.map((device) => (
          <TouchableOpacity
            key={device.id}
            style={styles.deviceCard}
            onPress={() => handleSelectDevice(device)}
            activeOpacity={0.7}
          >
            <View style={styles.deviceRow}>
              <View style={styles.phoneIconBox}>
                <Icon name="phone" size={20} color={colors.textSecondary} />
              </View>
              <View style={styles.deviceInfo}>
                <Text style={styles.deviceName}>{device.name}</Text>
                <Text style={styles.deviceMeta}>
                  {device.id} · {device.status}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.mockHint}>
          MOCK: 000000000 = offline device, 111111111 = unknown device.
        </Text>
      </ScrollView>

      {/* Bottom Button */}
      <View style={styles.bottomBar}>
        <Button
          title="Send request"
          onPress={handleSend}
          icon={<Icon name="connect-screen" size={20} color="#FFFFFF" />}
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 90,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 12,
  },
  deviceCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    marginBottom: 10,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  phoneIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1E2D4A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  deviceMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  mockHint: {
    fontSize: 12,
    color: '#D8B4FE',
    marginTop: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
