import { type ReactElement } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, SecondaryTextButton, SetupStateIcon } from '../components/onboarding/OnboardingKit';
import { designTokens } from '../constants/theme';
import type { DatabaseBootstrapFailure } from '../persistence/DatabaseBootstrap';

interface Props {
  readonly failure: DatabaseBootstrapFailure;
  readonly onRetry: () => void;
  readonly onReset: () => void;
}

function diagnosticsText(failure: DatabaseBootstrapFailure): string {
  return JSON.stringify({
    appVersion: '1.0.0',
    databaseVersion: failure.databaseVersion,
    expectedSchemaVersion: failure.expectedVersion,
    failedMigrationId: failure.failedMigrationVersion,
    error: failure.message,
  }, null, 2);
}

export function DatabaseRecoveryScreen({ failure, onRetry, onReset }: Props): ReactElement {
  function exportDiagnostics(): void {
    void Share.share({ message: diagnosticsText(failure), title: 'Locra database diagnostics' });
  }

  function confirmReset(): void {
    Alert.alert(
      'Delete local conversations?',
      'This permanently deletes every conversation and local context on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset local data', style: 'destructive', onPress: onReset },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <SetupStateIcon icon="database" shape="rounded" tone="error" />
      <Text style={styles.title}>Database recovery needed</Text>
      <Text style={styles.body}>Locra could not safely open your local conversations. Your data has not been changed.</Text>
      <View style={styles.actions}>
        <PrimaryButton label="Retry startup" onPress={onRetry} />
        <SecondaryTextButton label="Export diagnostics" onPress={exportDiagnostics} />
        <SecondaryTextButton label="Reset local data" onPress={confirmReset} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: designTokens.spacing.space24, backgroundColor: designTokens.color.canvas },
  title: { marginTop: designTokens.spacing.space24, color: designTokens.color.textPrimary, fontSize: designTokens.type.screenTitle.fontSize, fontWeight: designTokens.type.screenTitle.fontWeight, textAlign: 'center' },
  body: { marginTop: designTokens.spacing.space12, color: designTokens.color.textSecondary, textAlign: 'center', lineHeight: 22 },
  actions: { width: '100%', marginTop: designTokens.spacing.space24 },
});
