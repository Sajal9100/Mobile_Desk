import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';

interface SharingActiveScreenProps {
  requesterName?: string;
  onStopSharing: () => void;
}

export const SharingActiveScreen: React.FC<SharingActiveScreenProps> = ({
  requesterName = 'Rahul Sharma',
  onStopSharing,
}) => {
  const [seconds, setSeconds] = useState(3);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.container}>
      {/* Top Red Status Bar */}
      <View style={styles.redStatusBar}>
        <View style={styles.redStatusLeft}>
          <Icon name="screen-share" size={20} color="#FFFFFF" />
          <Text style={styles.redStatusText}>
            {requesterName} can see your screen
          </Text>
        </View>
        <TouchableOpacity
          style={styles.stopPillButton}
          onPress={onStopSharing}
          activeOpacity={0.8}
        >
          <Text style={styles.stopPillText}>STOP</Text>
        </TouchableOpacity>
      </View>

      <MockModeBanner />

      {/* Main Body */}
      <View style={styles.centerContent}>
        <View style={styles.redCircle}>
          <Icon name="screen-share" size={44} color="#EF4444" />
        </View>

        <Text style={styles.title}>Preview: sharing screen</Text>
        <Text style={styles.subtitle}>
          This is how the screen looks during a session. Nothing is actually
          being shared.
        </Text>

        <Text style={styles.timerText}>{seconds} s</Text>

        <View style={styles.infoCard}>
          <Icon name="hand" size={20} color="#94A3B8" />
          <Text style={styles.infoCardText}>
            View only: they can't tap or type on your phone.
          </Text>
        </View>
      </View>

      {/* Bottom Button */}
      <View style={styles.bottomBar}>
        <Button
          title="Stop sharing"
          onPress={onStopSharing}
          variant="danger"
        />
        <Text style={styles.footerNote}>
          You can also stop from the notification at any time.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  redStatusBar: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  redStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  redStatusText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  stopPillButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 6,
  },
  stopPillText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '800',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  redCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#2D1418',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    paddingHorizontal: 12,
  },
  timerText: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 20,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 32,
    width: '100%',
  },
  infoCardText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 12,
    flex: 1,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 12,
    alignItems: 'center',
  },
  footerNote: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 12,
  },
});
