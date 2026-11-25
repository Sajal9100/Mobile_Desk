import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { DeviceItem, initialDevices } from '../mock/mockData';

interface DevicesScreenProps {
  devices?: DeviceItem[];
  onSelectDevice?: (device: DeviceItem) => void;
}

export const DevicesScreen: React.FC<DevicesScreenProps> = ({
  devices = initialDevices,
  onSelectDevice,
}) => {
  return (
    <View style={styles.container}>
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.title}>My devices</Text>
        <Text style={styles.subtitle}>
          Phones signed in to your account. Tap one to connect.
        </Text>

        {/* Devices List */}
        {devices.map((device) => (
          <TouchableOpacity
            key={device.id}
            style={styles.card}
            onPress={() => onSelectDevice && onSelectDevice(device)}
            activeOpacity={0.7}
          >
            <View style={styles.cardRow}>
              {/* Phone Icon */}
              <View style={styles.phoneIconBox}>
                <Icon name="phone" size={20} color={colors.textSecondary} />
              </View>

              {/* Device Info */}
              <View style={styles.infoCol}>
                <View style={styles.titleRow}>
                  <Text style={styles.deviceName}>{device.name}</Text>
                  {device.isCurrentDevice ? (
                    <StatusBadge label="This phone" variant="this-phone" />
                  ) : (
                    <Icon name="chevron-right" size={20} color={colors.textSecondary} />
                  )}
                </View>

                <Text style={styles.metaText}>
                  {device.id}
                  {device.lastSeen ? ` · ${device.lastSeen}` : ''}
                </Text>

                <View style={styles.statusBadgeRow}>
                  <StatusBadge
                    label={
                      device.status === 'online'
                        ? 'Online'
                        : device.status === 'offline'
                        ? 'Offline'
                        : 'Unknown'
                    }
                    variant={device.status}
                  />
                </View>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        <Text style={styles.footerNote}>
          Rename and remove options arrive with the device API.
        </Text>
      </ScrollView>
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
    paddingTop: 24,
    paddingBottom: 30,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  phoneIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#1E2D4A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    marginTop: 2,
  },
  infoCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metaText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  statusBadgeRow: {
    marginTop: 10,
  },
  footerNote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
});
