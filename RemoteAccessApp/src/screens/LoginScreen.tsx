import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { colors } from '../theme/colors';
import { MockModeBanner } from '../components/MockModeBanner';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { Button } from '../components/Button';

interface LoginScreenProps {
  onSignIn: (email: string) => void;
  onNavigateToRegister: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignIn,
  onNavigateToRegister,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSignIn(email || 'sample.user@example.com');
    }, 600);
  };

  return (
    <View style={styles.container}>
      <MockModeBanner />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoContainer}>
            <Icon name="app-logo" size={60} />
          </View>

          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Welcome back to MobileDesk.</Text>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="sample.user@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder=""
            secureTextEntry
          />

          <View style={styles.buttonWrapper}>
            <Button
              title="Sign in"
              onPress={handleSubmit}
              loading={loading}
            />
          </View>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>New to MobileDesk? </Text>
            <TouchableOpacity onPress={onNavigateToRegister} activeOpacity={0.7}>
              <Text style={styles.createAccountLink}>Create an account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 40,
  },
  logoContainer: {
    marginBottom: 24,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 6,
    marginBottom: 32,
  },
  buttonWrapper: {
    marginTop: 10,
    marginBottom: 28,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  footerText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  createAccountLink: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});
