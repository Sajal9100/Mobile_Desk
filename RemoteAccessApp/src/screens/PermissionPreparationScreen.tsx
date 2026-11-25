import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';

interface PermissionPreparationScreenProps {
  requesterName?: string;
  onBack: () => void;
  onStartSharing: () => void;
  onPreviewScreen: () => void;
}

export const PermissionPreparationScreen: React.FC<
  PermissionPreparationScreenProps
> = ({
  requesterName = 'Rahul Sharma',
  onBack,
  onStartSharing,
  onPreviewScreen,
}) => {
  const permissionPoints = [
    {
      icon: 'window' as const,
      title: 'They see what you see',
      description:
        'Everything on your screen, including notifications. On Android 14+ you can choose to share a single app instead.',
    },
    {
      icon: 'bank' as const,
      title: 'Banking apps stay private',
      description:
        'Banking and payment apps usually appear black to the other person. That is expected.',
    },
    {
      icon: 'bell-slash' as const,
      title: 'One-time codes are hidden',
      description:
        'On Android 15+, sensitive notifications such as OTPs are hidden while sharing.',
    },
    {
      icon: 'stop-circle' as const,
      title: 'Stop any time',
      description:
        'A red banner and a notification stay visible the whole time, each with a Stop button.',
    },
  ];

  return (
    <View style={styles.container}>
      <AppHeader title="Share your screen" onBack={onBack} />
      <MockModeBanner />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Screen Cast Icon */}
        <View style={styles.iconBox}>
          <Icon name="screen-share" size={32} color="#38BDF8" />
        </View>

        <Text style={styles.title}>
          Share your screen with {requesterName}
        </Text>
        <Text style={styles.subtitle}>
          Android will show its own confirmation next. Here's what happens when
          you agree:
        </Text>

        {/* Feature Explanations */}
        <View style={styles.pointsList}>
          {permissionPoints.map((point, index) => (
            <View key={index} style={styles.pointRow}>
              <View style={styles.pointIconContainer}>
                <Icon name={point.icon} size={22} color={colors.textSecondary} />
              </View>
              <View style={styles.pointTextContainer}>
                <Text style={styles.pointTitle}>{point.title}</Text>
                <Text style={styles.pointDescription}>{point.description}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Mock Preview Box */}
        <View style={styles.mockBox}>
          <Text style={styles.mockBoxTitle}>
            ⚗️ MOCK: preview the next screen (nothing is shared)
          </Text>
          <Button
            title="Preview 'sharing active' screen"
            onPress={onPreviewScreen}
            variant="dark"
            style={styles.previewButton}
            textStyle={styles.previewButtonText}
          />
        </View>
      </ScrollView>

      {/* Bottom Buttons */}
      <View style={styles.bottomBar}>
        <Button
          title="Start sharing"
          onPress={onStartSharing}
          icon={<Icon name="screen-share" size={20} color="#FFFFFF" />}
        />
        <Button
          title="Cancel"
          onPress={onBack}
          variant="secondary"
          style={styles.cancelButton}
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
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 150,
  },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#122543',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  pointsList: {
    gap: 18,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pointIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#152136',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  pointTextContainer: {
    flex: 1,
  },
  pointTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pointDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 3,
  },
  mockBox: {
    width: '100%',
    backgroundColor: colors.mockBoxBg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.mockBoxBorder,
    borderRadius: 14,
    padding: 16,
    marginTop: 28,
  },
  mockBoxTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.mockBannerText,
    marginBottom: 12,
  },
  previewButton: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  previewButtonText: {
    fontSize: 14,
    color: colors.textPrimary,
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
  cancelButton: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
});
