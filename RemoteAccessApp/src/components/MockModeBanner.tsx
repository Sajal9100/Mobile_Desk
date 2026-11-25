import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export const MockModeBanner: React.FC = () => {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        <Text style={styles.flaskIcon}>⚗️ </Text>
        MOCK MODE · sample data, no server connected
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.mockBannerBg,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.mockBannerBorder,
  },
  bannerText: {
    color: colors.mockBannerText,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  flaskIcon: {
    fontSize: 12,
  },
});
