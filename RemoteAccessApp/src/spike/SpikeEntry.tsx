// SPIKE-ONLY (Milestone 1). THROWAWAY.
// Dev-only entry. App.tsx loads this module only when __DEV__ is true, and Metro removes that branch
// from release bundles, so production navigation can never reach the spike. SpikeScreen is required
// lazily so that merely rendering <App /> (for example in Jest) never loads the native WebRTC module.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SpikeEntry() {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  if (open) {
    const SpikeScreen = require('./SpikeScreen').default as typeof import('./SpikeScreen').default;
    return (
      <View style={StyleSheet.absoluteFill}>
        <SpikeScreen onClose={() => setOpen(false)} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => setOpen(true)}
      testID="spike-open"
      accessibilityRole="button"
      accessibilityLabel="Open spike screen (dev only)"
      style={[styles.fab, { top: insets.top + 8 }]}
    >
      <Text style={styles.text}>SPIKE (dev)</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 8,
    backgroundColor: '#b3261e',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    zIndex: 10,
    elevation: 10,
  },
  text: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
