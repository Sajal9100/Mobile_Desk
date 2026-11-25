import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { Icon } from '../components/Icon';
import {
  UserProfile,
  SettingsState,
  initialUserProfile,
  initialSettings,
} from '../mock/mockData';

interface SettingsScreenProps {
  user?: UserProfile;
  settings?: SettingsState;
  onSignOut?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  user = initialUserProfile,
  settings = initialSettings,
  onSignOut,
}) => {
  const [hideIp, setHideIp] = useState(settings.hideIpAddress);
  const [onlyMyDevices, setOnlyMyDevices] = useState(
    settings.onlyAcceptFromMyDevices
  );
  const [requirePin, setRequirePin] = useState(settings.requireOneTimePin);

  return (
    <View style={styles.container}>
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.title}>Settings</Text>

        {/* ACCOUNT Section */}
        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Name</Text>
            <Text style={styles.rowValue}>{user.name}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue}>{user.email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>This phone</Text>
            <Text style={styles.rowValue}>{user.thisPhoneName}</Text>
          </View>
        </View>

        {/* SECURITY & PRIVACY Section */}
        <Text style={styles.sectionHeader}>SECURITY & PRIVACY</Text>
        <View style={styles.card}>
          {/* Toggle 1: Hide IP */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.toggleTitle}>Hide my IP address</Text>
              <Text style={styles.toggleSubtitle}>
                Route sessions through a relay server so the other person never
                sees your IP address. May add slight delay.
              </Text>
            </View>
            <Switch
              value={hideIp}
              onValueChange={setHideIp}
              trackColor={{ false: '#334155', true: '#2563EB' }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.divider} />

          {/* Toggle 2: Only accept from my devices */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.toggleTitle}>
                Only accept requests from my devices
              </Text>
              <Text style={styles.toggleSubtitle}>
                Requests from other accounts are blocked automatically.
              </Text>
            </View>
            <Switch
              value={onlyMyDevices}
              onValueChange={setOnlyMyDevices}
              trackColor={{ false: '#334155', true: '#2563EB' }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.divider} />

          {/* Toggle 3: Require one-time PIN */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.toggleTitle}>Require a one-time PIN</Text>
              <Text style={styles.toggleSubtitle}>
                People connecting must also type a PIN shown on this phone.
              </Text>
            </View>
            <Switch
              value={requirePin}
              onValueChange={setRequirePin}
              trackColor={{ false: '#334155', true: '#2563EB' }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Sub Links Card */}
        <View style={styles.card}>
          <TouchableOpacity style={styles.navRow} activeOpacity={0.7}>
            <Text style={styles.navLabel}>Blocked accounts</Text>
            <Icon name="chevron-right" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.navRow} activeOpacity={0.7}>
            <Text style={styles.navLabel}>Signed-in devices</Text>
            <Icon name="chevron-right" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* PERMISSIONS Section */}
        <Text style={styles.sectionHeader}>PERMISSIONS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Notifications</Text>
            <Text style={[styles.rowValue, { color: '#34D399' }]}>Allowed</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Screen capture</Text>
            <Text style={styles.rowValue}>Granted per session</Text>
          </View>
        </View>

        {/* Sign Out Button */}
        {onSignOut && (
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={onSignOut}
            activeOpacity={0.7}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        )}
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
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  toggleTextCol: {
    flex: 1,
    paddingRight: 16,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  toggleSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 4,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  navLabel: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  signOutButton: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#371217',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F87171',
  },
});
