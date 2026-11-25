import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';

interface OnboardingScreenProps {
  onComplete: () => void;
}

const slides = [
  {
    title: 'Help someone with their phone',
    description:
      'Enter the ID shown on their phone to ask to see their screen. Great for helping family or teammates with settings and apps.',
  },
  {
    title: 'Safe and permission-based',
    description:
      'Sessions require explicit approval from the phone owner every time. Sensitive apps like banking are kept private.',
  },
  {
    title: 'Instant one-tap disconnect',
    description:
      'You are always in full control. Stop sharing at any moment from the persistent banner or notification.',
  },
];

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      onComplete();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.centerContainer}>
        <Icon name="help-hands" size={110} />
        <Text style={styles.title}>{slides[currentSlide].title}</Text>
        <Text style={styles.description}>{slides[currentSlide].description}</Text>

        {/* Pagination Dots */}
        <View style={styles.dotsRow}>
          {slides.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === currentSlide ? styles.activeDot : styles.inactiveDot,
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.bottomContainer}>
        <Button
          title={currentSlide === slides.length - 1 ? 'Get Started' : 'Next'}
          onPress={handleNext}
        />
        <TouchableOpacity
          style={styles.skipButton}
          onPress={onComplete}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 12,
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 23,
    marginTop: 16,
    paddingHorizontal: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 48,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    marginHorizontal: 4,
  },
  activeDot: {
    width: 24,
    backgroundColor: colors.primary,
  },
  inactiveDot: {
    width: 6,
    backgroundColor: '#334155',
  },
  bottomContainer: {
    width: '100%',
    alignItems: 'center',
  },
  skipButton: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});
