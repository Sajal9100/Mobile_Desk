import React, { useState } from 'react';
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
import { Button } from '../components/Button';
import { SessionItem, initialSessions } from '../mock/mockData';

interface HomeScreenProps {
  userName: string;
  thisPhoneId: string;
  onConnectPress: () => void;
  onSeeAllSessions: () => void;
  onSessionPress?: (session: SessionItem) => void;
  onIncomingRequestDemo?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  userName = 'Sample User',
  thisPhoneId = '482 915 736',
  onConnectPress,
  onSeeAllSessions,
  onSessionPress,
  onIncomingRequestDemo,
}) => {
  const [copied, setCopied] = useState(false);
  const [showNotificationCard, setShowNotificationCard] = useState(true);

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const recentSessions = initialSessions.slice(0, 2);

  return (
    <View style={styles.container}>
      <MockModeBanner />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header Greeting */}
        <View style={styles.header}>
          <Text style={styles.greetingSub}>Hello,</Text>
          <Text style={styles.greetingName}>{userName}</Text>
        </View>

        {/* This Phone's ID Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>THIS PHONE'S ID</Text>
            <StatusBadge label="Sample ID" variant="sample" />
          </View>

          <View style={styles.idRow}>
            <Text style={styles.idNumber}>{thisPhoneId}</Text>
            <TouchableOpacity
              style={styles.copyButton}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Icon name="copy" size={16} color={colors.textPrimary} />
              <Text style={styles.copyText}>{copied ? 'Copied!' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.cardHelper}>
            Share this ID only with people you trust. They still need your
            approval to see your screen.
          </Text>
        </View>

        {/* Notification Permission Card */}
        {showNotificationCard && (
          <View style={styles.notificationCard}>
            <View style={styles.notificationHeader}>
              <View style={styles.notificationTitleRow}>
                <Icon name="bell" size={18} color="#38BDF8" />
                <Text style={styles.notificationTitle}>
                  Get requests when the app is closed
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowNotificationCard(false)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.notificationBody}>
              Turn on notifications so you don't miss a request from someone
              you're helping.
            </Text>

            <TouchableOpacity
              style={styles.notificationButton}
              onPress={() => setShowNotificationCard(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.notificationButtonText}>
                Turn on notifications
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Connect to a Device Action Button */}
        <Button
          title="Connect to a device"
          onPress={onConnectPress}
          icon={<Icon name="connect-screen" size={20} color="#FFFFFF" />}
          style={styles.connectButton}
        />

        {/* Recent Sessions Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>RECENT SESSIONS</Text>
          <TouchableOpacity onPress={onSeeAllSessions} activeOpacity={0.7}>
            <Text style={styles.seeAllText}>See all</Text>
          </TouchableOpacity>
        </View>

        {recentSessions.map((session) => (
          <TouchableOpacity
            key={session.id}
            style={styles.sessionCard}
            onPress={() => onSessionPress && onSessionPress(session)}
            activeOpacity={0.7}
          >
            <View style={styles.sessionLeft}>
              <Icon
                name={session.direction === 'outgoing' ? 'outgoing' : 'incoming'}
                size={38}
              />
              <View style={styles.sessionDetails}>
                <Text style={styles.sessionDeviceName}>
                  {session.deviceName}
                </Text>
                <Text style={styles.sessionMeta1}>
                  {session.direction === 'outgoing'
                    ? `You viewed · ${session.deviceId}`
                    : `Viewed your screen · ${session.deviceId.slice(0, 7)}...`}
                </Text>
                <Text style={styles.sessionMeta2}>
                  {session.timestamp}
                  {session.duration ? ` · ${session.duration}` : ''}
                </Text>
              </View>
            </View>

            <StatusBadge
              label={
                session.status === 'completed'
                  ? 'Completed'
                  : session.status === 'rejected'
                  ? 'Rejected'
                  : 'Expired'
              }
              variant={session.status}
            />
          </TouchableOpacity>
        ))}

        {/* Simulated Demo Trigger for Incoming Request */}
        {onIncomingRequestDemo && (
          <View style={styles.demoBox}>
            <Text style={styles.demoLabel}>
              ⚗️ DEMO SHORTCUT: Test screen-sharing approval
            </Text>
            <TouchableOpacity
              style={styles.demoButton}
              onPress={onIncomingRequestDemo}
              activeOpacity={0.7}
            >
              <Text style={styles.demoButtonText}>
                Simulate Incoming Request Screen
              </Text>
            </TouchableOpacity>
          </View>
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
    paddingTop: 20,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 20,
  },
  greetingSub: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  greetingName: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  idRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  idNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 1.5,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2D4A',
    borderWidth: 1,
    borderColor: '#2E436E',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  copyText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: 6,
  },
  cardHelper: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 14,
  },
  notificationCard: {
    backgroundColor: '#0E1F35',
    borderWidth: 1,
    borderColor: '#0284C7',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 8,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: 10,
    flex: 1,
  },
  notificationBody: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 8,
  },
  notificationButton: {
    backgroundColor: '#132845',
    borderWidth: 1,
    borderColor: '#234470',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
    marginTop: 14,
  },
  notificationButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  connectButton: {
    marginBottom: 24,
    height: 52,
    borderRadius: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryLight,
  },
  sessionCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sessionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 10,
  },
  sessionDetails: {
    marginLeft: 14,
    flex: 1,
  },
  sessionDeviceName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sessionMeta1: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 3,
  },
  sessionMeta2: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  demoBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4C1D95',
    backgroundColor: '#1F1235',
  },
  demoLabel: {
    fontSize: 12,
    color: '#D8B4FE',
    fontWeight: '600',
    marginBottom: 8,
  },
  demoButton: {
    backgroundColor: '#371B5C',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  demoButtonText: {
    color: '#F3E8FF',
    fontSize: 13,
    fontWeight: '600',
  },
});
