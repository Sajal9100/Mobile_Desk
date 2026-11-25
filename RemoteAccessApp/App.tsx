/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { StatusBar, StyleSheet, View } from 'react-native';
import {
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';

// SPIKE-ONLY (Milestone 1, REMOVE at cleanup): dev-only entry to the throwaway spike screen.
// __DEV__ is false in release bundles, so Metro folds this to null and drops the spike code with it.
const SpikeEntry = __DEV__ ? (require('./src/spike/SpikeEntry').default as typeof import('./src/spike/SpikeEntry').default) : null;

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  return (
    <View style={styles.container}>
      <AppNavigator />
      {SpikeEntry !== null && <SpikeEntry />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
