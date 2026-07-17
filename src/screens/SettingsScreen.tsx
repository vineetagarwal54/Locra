import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LocraSheet } from '../components/LocraSheet';
import { useConfirmSheet } from '../components/useConfirmSheet';
import { designTokens, haptics } from '../constants/theme';
import { deleteAllDiagnosticsExports } from '../diagnostics/DiagnosticsExportRuntime';
import { diagnosticsTraceStore } from '../diagnostics/DiagnosticsTraceStore';
import { RESPONSE_MODES, type ResponseMode } from '../inference/ResponseMode';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import { createQwenModelPresentation } from '../model/ModelPresentation';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { SCHEMA_VERSION } from '../persistence/sqlite/Schema';
import { openAndroidAppSettings } from '../platform/AppSettings';
import {
  SettingsMaintenanceService,
  type SettingsMaintenanceOperation,
} from '../settings/SettingsMaintenanceService';
import { clearLocraTemporaryFiles } from '../settings/TemporaryFileCleanup';
import { useHistoryStore } from '../store/historyStore';
import { useModelStore } from '../store/modelStore';
import { useSettingsStore } from '../store/settingsStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const maintenance = new SettingsMaintenanceService({
  deleteModel: () => useModelStore.getState().cancelDownload(),
  clearTemporaryFiles: clearLocraTemporaryFiles,
  // Clearing diagnostics removes stored traces AND every generated export ZIP,
  // but never conversations or image files.
  clearDiagnostics: async () => {
    diagnosticsTraceStore.clear();
    deleteAllDiagnosticsExports();
  },
  clearConversations: async () => useHistoryStore.getState().clear(),
});

export function SettingsScreen({ navigation, route }: Props) {
  const responseMode = useSettingsStore((state) => state.responseMode);
  const setResponseMode = useSettingsStore((state) => state.setResponseMode);
  const modelPhase = useModelStore((state) => state.setupPhase);
  const modelIntegrityVerified = useModelStore((state) => state.integrityVerified);
  const historyRevision = useHistoryStore((state) => state.conversations);
  const conversationId = route.params?.conversationId;
  const conversation = conversationId === undefined
    ? null
    : useHistoryStore.getState().getConversation(conversationId);
  void historyRevision;

  const [running, setRunning] = useState<SettingsMaintenanceOperation | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameText, setRenameText] = useState(conversation?.title ?? '');
  const { confirm, dialog } = useConfirmSheet();
  const presentation = createQwenModelPresentation();

  const onBack = useCallback((): void => {
    void haptics.tap();
    navigation.goBack();
  }, [navigation]);

  const runOperation = useCallback(async (
    operation: SettingsMaintenanceOperation,
    successMessage: string,
    onSuccess?: () => void,
  ): Promise<void> => {
    if (maintenance.isRunning(operation)) return;
    setRunning(operation);
    setResult(null);
    const operationResult = await maintenance.run(operation);
    setRunning(null);
    if (operationResult.status === 'success') {
      setResult(successMessage);
      onSuccess?.();
    } else if (operationResult.status === 'failed') {
      setResult('That action could not be completed. Try again.');
      void haptics.error();
    }
  }, []);

  const confirmOperation = useCallback((input: {
    title: string;
    message: string;
    label: string;
    operation: SettingsMaintenanceOperation;
    successMessage: string;
    onSuccess?: () => void;
  }): void => {
    confirm({
      title: input.title,
      message: input.message,
      confirmLabel: input.label,
      destructive: true,
      onConfirm: () => { void runOperation(input.operation, input.successMessage, input.onSuccess); },
    });
  }, [confirm, runOperation]);

  const openRename = useCallback((): void => {
    setRenameText(conversation?.title ?? '');
    setRenameVisible(true);
  }, [conversation?.title]);

  const saveRename = useCallback((): void => {
    if (conversationId === undefined || renameText.trim() === '') return;
    useHistoryStore.getState().rename(conversationId, renameText);
    setRenameVisible(false);
    setResult('Conversation renamed.');
  }, [conversationId, renameText]);

  const modelActionLabel = modelPhase === 'ready' ? 'Redownload model' : 'Repair / redownload model';
  const modelStatus = modelPhase === 'ready' && modelIntegrityVerified ? 'Ready and verified' : modelPhase.replace('_', ' ');

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" style={styles.headerButton} onPress={onBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={designTokens.color.textSecondary} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SectionLabel>ON-DEVICE MODEL</SectionLabel>
        <View style={styles.card}>
          <View style={styles.modelRow}>
            <MaterialCommunityIcons name="cube-outline" size={22} color={designTokens.color.primary} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{QWEN_V1_DESCRIPTOR.displayName}</Text>
              <Text style={styles.rowText}>{presentation.downloadSizeLabel} · {modelStatus}</Text>
            </View>
          </View>
          <SettingsActionRow
            icon="download-outline"
            label={modelActionLabel}
            detail="Repairs both the language model and projector. Conversations stay intact."
            disabled={running === 'delete-model'}
            onPress={() => confirmOperation({
              title: modelActionLabel,
              message: 'The current model files will be removed, then Locra will return to model setup. Conversations and settings will not be deleted.',
              label: modelActionLabel,
              operation: 'delete-model',
              successMessage: 'Ready to redownload the model.',
              onSuccess: () => navigation.navigate('DownloadProgress', { autoStart: true }),
            })}
          />
          <SettingsActionRow
            icon="delete-outline"
            label="Delete model"
            detail="Frees model storage without deleting conversations."
            destructive
            disabled={running === 'delete-model'}
            onPress={() => confirmOperation({
              title: 'Delete the on-device model?',
              message: 'Locra cannot answer until the model is downloaded again. Conversations and settings remain on this device.',
              label: 'Delete model',
              operation: 'delete-model',
              successMessage: 'Model deleted. Download it again whenever you are ready.',
            })}
          />
        </View>

        {conversation !== null ? (
          <>
            <SectionLabel>THIS CONVERSATION</SectionLabel>
            <View style={styles.card}>
              <SettingsActionRow
                icon="pencil-outline"
                label="Rename conversation"
                detail={conversation.title ?? 'Untitled conversation'}
                onPress={openRename}
              />
            </View>
          </>
        ) : null}

        <SectionLabel>RESPONSE DETAIL</SectionLabel>
        <View style={styles.modeRow}>
          {RESPONSE_MODES.map((mode) => {
            const selected = mode === responseMode;
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={`${mode} response detail`}
                accessibilityState={{ selected }}
                onPress={() => { void haptics.tap(); setResponseMode(mode as ResponseMode); }}
                style={[styles.modeButton, selected && styles.modeButtonSelected]}
              >
                <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{mode}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>STORAGE & PRIVACY</SectionLabel>
        <View style={styles.card}>
          <SettingsActionRow
            icon="broom"
            label="Clear temporary files"
            detail="Removes Locra-owned cache files, not model or conversation data."
            disabled={running === 'clear-temporary-files'}
            onPress={() => confirmOperation({
              title: 'Clear temporary files?',
              message: 'Locra-owned cache files will be removed. The model and conversations are not affected.',
              label: 'Clear files',
              operation: 'clear-temporary-files',
              successMessage: 'Temporary files cleared.',
            })}
          />
          <SettingsActionRow
            icon="bug-outline"
            label="Clear diagnostics"
            detail="Removes stored diagnostic traces and exported diagnostic files only."
            disabled={running === 'clear-diagnostics'}
            onPress={() => confirmOperation({
              title: 'Clear diagnostics?',
              message: 'Stored diagnostic traces and any exported diagnostic files will be removed. Conversations are not affected.',
              label: 'Clear diagnostics',
              operation: 'clear-diagnostics',
              successMessage: 'Diagnostics cleared.',
            })}
          />
          <SettingsActionRow
            icon="chat-remove-outline"
            label="Clear conversations"
            detail="Permanently deletes every conversation and its linked local data."
            destructive
            disabled={running === 'clear-conversations'}
            onPress={() => confirmOperation({
              title: 'Clear all conversations?',
              message: 'This permanently deletes all conversations and cannot be undone. The on-device model remains installed.',
              label: 'Clear conversations',
              operation: 'clear-conversations',
              successMessage: 'All conversations cleared.',
            })}
          />
          <SettingsActionRow
            icon="cog-outline"
            label="Open Android app settings"
            detail="Recover camera, microphone, or notification permissions after permanent denial."
            onPress={() => { void openAndroidAppSettings().catch(() => setResult('Android settings could not be opened.')); }}
          />
        </View>

        <SectionLabel>DIAGNOSTICS</SectionLabel>
        <View style={styles.card}>
          <SettingsActionRow
            icon="archive-arrow-up-outline"
            label="Export diagnostics"
            detail="Choose conversations and review what is included. Nothing is uploaded."
            onPress={() => navigation.navigate('DiagnosticsExport')}
          />
          {/* Temporary internal entry for the offline-voice device gate (T092).
              Remove once VOICE_INPUT_ENABLED is validated on device. */}
          <SettingsActionRow
            icon="microphone-outline"
            label="Voice validation"
            detail="Runs one offline speech session and records device metrics. Internal."
            onPress={() => navigation.navigate('VoiceDiagnostics')}
          />
        </View>

        <SectionLabel>VERSIONS</SectionLabel>
        <View style={styles.card}>
          <VersionRow label="App" value={DeviceInfo.getVersion()} />
          <VersionRow label="Build" value={DeviceInfo.getBuildNumber()} />
          <VersionRow label="Model" value="Locra V1 · Qwen3-VL 2B" />
          <VersionRow label="Database" value={`Schema ${SCHEMA_VERSION}`} />
        </View>

        {result !== null ? <Text accessibilityLiveRegion="polite" style={styles.result}>{result}</Text> : null}
      </ScrollView>

      <LocraSheet
        visible={renameVisible}
        title="Rename conversation"
        onRequestClose={() => setRenameVisible(false)}
        actions={[
          { label: 'Save', variant: 'primary', onPress: saveRename },
          { label: 'Cancel', variant: 'quiet', onPress: () => setRenameVisible(false) },
        ]}
      >
        <TextInput
          autoFocus
          value={renameText}
          onChangeText={setRenameText}
          maxLength={120}
          placeholder="Conversation name"
          placeholderTextColor={designTokens.color.textSecondary}
          style={styles.renameInput}
        />
      </LocraSheet>
      {dialog}
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function SettingsActionRow({
  icon,
  label,
  detail,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: IconName;
  label: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed, disabled && styles.disabled]}
      onPress={onPress}
    >
      <MaterialCommunityIcons name={icon} size={21} color={destructive ? designTokens.color.error : designTokens.color.primary} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, destructive && styles.destructiveText]}>{label}</Text>
        <Text style={styles.rowText}>{detail}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={designTokens.color.textSecondary} />
    </Pressable>
  );
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.versionRow}>
      <Text style={styles.versionLabel}>{label}</Text>
      <Text selectable style={styles.versionValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: designTokens.color.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: designTokens.spacing.space12, paddingVertical: designTokens.spacing.space12 },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { color: designTokens.color.textPrimary, fontSize: designTokens.type.sectionTitle.fontSize, fontWeight: designTokens.type.sectionTitle.fontWeight },
  content: { paddingHorizontal: designTokens.spacing.space20, paddingBottom: designTokens.spacing.space32 },
  sectionLabel: { color: designTokens.color.textSecondary, fontSize: designTokens.type.caption.fontSize, fontWeight: designTokens.type.caption.fontWeight, marginTop: designTokens.spacing.space24, marginBottom: designTokens.spacing.space8 },
  card: { overflow: 'hidden', borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card, backgroundColor: designTokens.color.surfaceStrong },
  modelRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: designTokens.spacing.space16, paddingVertical: designTokens.spacing.space12 },
  actionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: designTokens.spacing.space16, paddingVertical: designTokens.spacing.space8, borderTopWidth: designTokens.borderWidth, borderTopColor: designTokens.color.divider },
  rowBody: { flex: 1, marginHorizontal: designTokens.spacing.space12 },
  rowTitle: { color: designTokens.color.textPrimary, fontSize: designTokens.type.cardTitle.fontSize, fontWeight: designTokens.type.cardTitle.fontWeight },
  rowText: { color: designTokens.color.textSecondary, fontSize: designTokens.type.supporting.fontSize, lineHeight: designTokens.type.supporting.lineHeight, marginTop: designTokens.spacing.space4 },
  destructiveText: { color: designTokens.color.error },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
  modeRow: { flexDirection: 'row' },
  modeButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card, backgroundColor: designTokens.color.surfaceStrong, marginRight: designTokens.spacing.space8 },
  modeButtonSelected: { borderColor: designTokens.color.primary, backgroundColor: designTokens.color.surface },
  modeText: { color: designTokens.color.textSecondary, fontSize: designTokens.type.button.fontSize, fontWeight: designTokens.type.button.fontWeight },
  modeTextSelected: { color: designTokens.color.primary },
  versionRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: designTokens.spacing.space16, borderBottomWidth: designTokens.borderWidth, borderBottomColor: designTokens.color.divider },
  versionLabel: { color: designTokens.color.textSecondary, fontSize: designTokens.type.supporting.fontSize },
  versionValue: { color: designTokens.color.textPrimary, fontSize: designTokens.type.supporting.fontSize, fontWeight: designTokens.type.bodyStrong.fontWeight, textAlign: 'right', flexShrink: 1 },
  result: { color: designTokens.color.textSecondary, fontSize: designTokens.type.supporting.fontSize, lineHeight: designTokens.type.supporting.lineHeight, marginTop: designTokens.spacing.space16, textAlign: 'center' },
  renameInput: { minHeight: 48, marginTop: designTokens.spacing.space8, paddingHorizontal: designTokens.spacing.space12, borderWidth: designTokens.borderWidth, borderColor: designTokens.color.border, borderRadius: designTokens.radius.card, color: designTokens.color.textPrimary, backgroundColor: designTokens.color.surface },
});
