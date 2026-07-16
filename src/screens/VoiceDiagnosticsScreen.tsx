import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Paths } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { designTokens, haptics } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  createSherpaVoiceRuntime,
  isVoiceRuntimeAvailable,
  voiceModelIsInstalled,
} from '../voice/SherpaVoiceRuntime';
import { DEFAULT_VOICE_MODEL, VOICE_MODEL_DIR_NAME } from '../voice/VoiceModelDescriptor';
import { VoiceValidationRun, type VoiceValidationReport } from '../voice/VoiceValidationMetrics';

type Props = NativeStackScreenProps<RootStackParamList, 'VoiceDiagnostics'>;

// Isolated INTERNAL screen for the T092 physical-device gate. It drives one real
// offline session and records the metrics required before VOICE_INPUT_ENABLED may
// flip to true. It never touches conversations and persists no audio.
const VALIDATION_DURATION_MS = 8_000;

function modelDirectory(): string {
  return `${Paths.document.uri}/${VOICE_MODEL_DIR_NAME}/${DEFAULT_VOICE_MODEL.id}`;
}

export function VoiceDiagnosticsScreen({ navigation }: Props) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<VoiceValidationReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runtimeAvailable = isVoiceRuntimeAvailable();
  const config = { descriptor: DEFAULT_VOICE_MODEL, modelDirectory: modelDirectory() };
  const modelInstalled = runtimeAvailable && voiceModelIsInstalled(config);

  const onRun = useCallback((): void => {
    void haptics.tap();
    setMessage(null);
    setReport(null);
    setRunning(true);
    void runValidation(config)
      .then((result) => setReport(result))
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Validation failed.');
      })
      .finally(() => setRunning(false));
  }, [config]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={designTokens.color.textSecondary} />
        </Pressable>
        <Text style={styles.title}>Voice validation</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>MODEL</Text>
        <Row label="Name" value={DEFAULT_VOICE_MODEL.displayName} />
        <Row label="Id" value={DEFAULT_VOICE_MODEL.id} />
        <Row label="Size" value={formatBytes(DEFAULT_VOICE_MODEL.approxSizeBytes)} />
        <Row label="Runtime installed" value={runtimeAvailable ? 'yes' : 'no'} />
        <Row label="Model installed" value={modelInstalled ? 'yes' : 'no'} />

        <Text style={styles.sectionLabel}>RESULTS</Text>
        {report === null ? (
          <Text style={styles.muted}>Run a validation to record metrics.</Text>
        ) : (
          <ReportView report={report} />
        )}
        {message !== null ? <Text style={styles.error}>{message}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run voice validation"
          accessibilityState={{ disabled: running || !runtimeAvailable || !modelInstalled }}
          disabled={running || !runtimeAvailable || !modelInstalled}
          style={[styles.runButton, (running || !runtimeAvailable || !modelInstalled) && styles.disabled]}
          onPress={onRun}
        >
          <Text style={styles.runButtonLabel}>
            {running ? 'Recording 8s…' : 'Run 8-second validation'}
          </Text>
        </Pressable>
        {!runtimeAvailable ? (
          <Text style={styles.muted}>
            The Sherpa-ONNX voice runtime is not present in this build. Install the native packages
            and rebuild, then return here.
          </Text>
        ) : !modelInstalled ? (
          <Text style={styles.muted}>Install the speech model before validating.</Text>
        ) : null}
        <Text style={styles.muted}>
          Airplane-mode and peak-memory figures must be confirmed manually on device while this run
          executes.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

async function runValidation(config: {
  descriptor: typeof DEFAULT_VOICE_MODEL;
  modelDirectory: string;
}): Promise<VoiceValidationReport> {
  const run = new VoiceValidationRun(config.descriptor);
  const runtime = createSherpaVoiceRuntime(config);
  run.markStart();
  const session = await runtime.start();
  run.markInitialized();
  session.onPartial(() => {
    run.markPartial();
    run.sampleMemory(readJsHeapBytes());
  });
  await new Promise<void>((resolve) => setTimeout(resolve, VALIDATION_DURATION_MS));
  run.markStopRequested();
  await session.stop();
  run.markFinal();
  run.markReleaseStart();
  await session.release();
  run.markReleaseDone();
  return run.build();
}

function readJsHeapBytes(): number | null {
  const memory = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance
    ?.memory;
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
}

function ReportView({ report }: { report: VoiceValidationReport }) {
  return (
    <>
      <Row label="First partial" value={formatMs(report.firstPartialLatencyMs)} />
      <Row label="Mean partial interval" value={formatMs(report.meanPartialIntervalMs)} />
      <Row label="Partial updates" value={String(report.partialUpdateCount)} />
      <Row label="Final latency" value={formatMs(report.finalTranscriptLatencyMs)} />
      <Row label="Init" value={formatMs(report.initMs)} />
      <Row label="Release" value={formatMs(report.releaseMs)} />
      <Row label="Peak JS heap" value={report.peakMemoryBytes === null ? '—' : formatBytes(report.peakMemoryBytes)} />
      <Row label="Cancelled" value={report.cancelled ? 'yes' : 'no'} />
      <Row label="Airplane mode" value={report.airplaneModeResult} />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function formatMs(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms)} ms`;
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: designTokens.color.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designTokens.spacing.space12,
    paddingVertical: designTokens.spacing.space12,
  },
  headerButton: {
    minWidth: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  content: {
    paddingHorizontal: designTokens.spacing.space16,
    paddingBottom: designTokens.spacing.space24,
  },
  sectionLabel: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    fontWeight: '700',
    marginTop: designTokens.spacing.space16,
    marginBottom: designTokens.spacing.space8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: designTokens.spacing.space8,
    borderBottomWidth: designTokens.borderWidth,
    borderBottomColor: designTokens.color.divider,
  },
  rowLabel: { color: designTokens.color.textSecondary, fontSize: designTokens.type.body.fontSize },
  rowValue: { color: designTokens.color.textPrimary, fontSize: designTokens.type.body.fontSize },
  muted: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space8,
  },
  error: {
    color: designTokens.color.error,
    fontSize: designTokens.type.supporting.fontSize,
    marginTop: designTokens.spacing.space8,
  },
  runButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: designTokens.spacing.space20,
    paddingVertical: designTokens.spacing.space12,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.primary,
  },
  runButtonLabel: {
    color: designTokens.color.onPrimary,
    fontSize: designTokens.type.body.fontSize,
    fontWeight: '700',
  },
  disabled: { opacity: 0.5 },
});
