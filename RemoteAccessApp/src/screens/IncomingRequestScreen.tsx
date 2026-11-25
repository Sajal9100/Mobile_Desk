import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';

interface IncomingRequestScreenProps {
  requesterName?: string;
  requesterDevice?: string;
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingRequestScreen: React.FC<IncomingRequestScreenProps> = ({
  requesterName = 'Rahul Sharma',
  requesterDevice = "from Rahul's OnePlus 12",
  onAccept,
  onReject,
}) => {
  const [countdown, setCountdown] = useState(2);
  const [canAccept, setCanAccept] = useState(false);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCanAccept(true);
    }
  }, [countdown]);

  return (
    <View style={styles.container}>
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Titles */}
        <Text style={styles.preTitle}>SCREEN SHARING REQUEST</Text>
        <Text style={styles.title}>
          {requesterName} wants to see your screen
        </Text>
        <Text style={styles.expiryText}>Expires in 57s</Text>

        {/* User Requester Card */}
        <View style={styles.userCard}>
          <View style={styles.avatarCircle}>
            <Icon name="avatar" size={44} />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{requesterName}</Text>
            <Text style={styles.userDevice}>{requesterDevice}</Text>
            <View style={styles.badgeRow}>
              <StatusBadge label="New account · 2 days old" variant="amber" />
              <View style={styles.badgeSpacing} />
              <StatusBadge label="First time connecting" variant="amber" />
            </View>
          </View>
        </View>

        {/* Anti-Scam Warning Card */}
        <View style={styles.warningCard}>
          <View style={styles.warningTitleRow}>
            <Icon name="shield-warn" size={24} color="#F59E0B" />
            <Text style={styles.warningTitle}>
              Stop if someone asked you to do this
            </Text>
          </View>

          <Text style={styles.warningMainText}>
            Banks, UPI apps, telecom companies and the police will never ask
            you to install a screen-sharing app or accept a request.
          </Text>

          <View style={styles.bulletList}>
            <View style={styles.bulletItem}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>
                If you are on a call with someone asking you to accept, reject
                this request.
              </Text>
            </View>

            <View style={styles.bulletItem}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>
                The other person will see everything on your screen, including
                messages.
              </Text>
            </View>

            <View style={styles.bulletItem}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>
                Banking and payment apps will appear black to them. That is
                expected.
              </Text>
            </View>

            <View style={styles.bulletItem}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>
                You can stop sharing at any time from the banner or the
                notification.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.bottomBar}>
        <Button
          title={canAccept ? 'Accept' : `Accept available in ${countdown}s`}
          onPress={onAccept}
          disabled={!canAccept}
          variant="primary"
          style={!canAccept ? styles.acceptDisabledButton : undefined}
          textStyle={!canAccept ? styles.acceptDisabledText : undefined}
        />
        <Button
          title="Reject"
          onPress={onReject}
          variant="danger"
          style={styles.rejectButton}
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
    paddingTop: 20,
    paddingBottom: 150,
  },
  preTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 6,
    lineHeight: 32,
  },
  expiryText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 16,
  },
  userCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  avatarCircle: {
    marginRight: 14,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  userDevice: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'column',
    gap: 6,
  },
  badgeSpacing: {
    height: 2,
  },
  warningCard: {
    backgroundColor: '#17130E',
    borderWidth: 1.5,
    borderColor: '#D97706',
    borderRadius: 14,
    padding: 16,
  },
  warningTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: 10,
    flex: 1,
  },
  warningMainText: {
    fontSize: 14,
    color: '#E2E8F0',
    lineHeight: 20,
    marginBottom: 12,
  },
  bulletList: {
    gap: 10,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletDot: {
    color: '#F59E0B',
    fontSize: 16,
    lineHeight: 18,
    marginRight: 8,
  },
  bulletText: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 18,
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: '#18243A',
    gap: 10,
  },
  acceptDisabledButton: {
    backgroundColor: '#1E293B',
  },
  acceptDisabledText: {
    color: colors.textSecondary,
  },
  rejectButton: {
    backgroundColor: colors.dangerRed,
  },
});
