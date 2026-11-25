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
import { SessionItem, initialSessions } from '../mock/mockData';

interface SessionsScreenProps {
  sessions?: SessionItem[];
  onSelectSession?: (session: SessionItem) => void;
}

export const SessionsScreen: React.FC<SessionsScreenProps> = ({
  sessions = initialSessions,
  onSelectSession,
}) => {
  return (
    <View style={styles.container}>
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.title}>Session history</Text>
        <Text style={styles.subtitle}>Who connected, when, and for how long.</Text>

        {/* Sessions List */}
        {sessions.map((session) => (
          <TouchableOpacity
            key={session.id}
            style={styles.card}
            onPress={() => onSelectSession && onSelectSession(session)}
            activeOpacity={0.7}
          >
            <View style={styles.cardLeft}>
              <Icon
                name={session.direction === 'outgoing' ? 'outgoing' : 'incoming'}
                size={38}
              />
              <View style={styles.details}>
                <Text style={styles.deviceName}>{session.deviceName}</Text>
                <Text style={styles.meta1}>
                  {session.direction === 'outgoing'
                    ? `You viewed · ${session.deviceId}`
                    : `Viewed your screen · ${session.deviceId.slice(0, 7)}...`}
                </Text>
                <Text style={styles.meta2}>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 10,
  },
  details: {
    marginLeft: 14,
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  meta1: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 3,
  },
  meta2: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
