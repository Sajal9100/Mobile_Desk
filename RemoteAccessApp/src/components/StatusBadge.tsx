import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export type BadgeVariant =
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'online'
  | 'offline'
  | 'unknown'
  | 'sample'
  | 'this-phone'
  | 'amber'
  | 'waiting'
  | 'connecting';

interface StatusBadgeProps {
  label: string;
  variant: BadgeVariant;
  showDot?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  variant,
  showDot = true,
}) => {
  const getBadgeStyles = () => {
    switch (variant) {
      case 'completed':
      case 'online':
        return {
          bg: colors.successBg,
          text: colors.successText,
          dot: colors.success,
        };
      case 'rejected':
        return {
          bg: colors.dangerBg,
          text: colors.dangerText,
          dot: colors.danger,
        };
      case 'expired':
      case 'offline':
      case 'unknown':
        return {
          bg: colors.neutralBg,
          text: colors.neutralText,
          dot: colors.textMuted,
        };
      case 'sample':
        return {
          bg: colors.purpleBadgeBg,
          text: colors.purpleBadgeText,
          dot: colors.purpleBadgeText,
        };
      case 'this-phone':
        return {
          bg: '#123055',
          text: '#60A5FA',
          dot: '#38BDF8',
        };
      case 'amber':
        return {
          bg: colors.warningBg,
          text: colors.warningText,
          dot: colors.warning,
        };
      case 'waiting':
        return {
          bg: colors.infoBg,
          text: colors.info,
          dot: colors.info,
          border: colors.infoBorder,
        };
      case 'connecting':
        return {
          bg: colors.warningBg,
          text: colors.warningText,
          dot: colors.warning,
          border: colors.warningBorder,
        };
      default:
        return {
          bg: colors.neutralBg,
          text: colors.neutralText,
          dot: colors.textMuted,
        };
    }
  };

  const style = getBadgeStyles();

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: style.bg,
          borderColor: style.border || 'transparent',
          borderWidth: style.border ? 1 : 0,
        },
      ]}
    >
      {showDot && (
        <View style={[styles.dot, { backgroundColor: style.dot }]} />
      )}
      <Text style={[styles.badgeText, { color: style.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
