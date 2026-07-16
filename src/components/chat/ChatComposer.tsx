import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { designTokens, haptics } from '../../constants/theme';
import type { ResponseMode } from '../../inference/ResponseMode';
import type { ConversationCandidate } from '../../retrieval/ConversationTargetResolver';
import { conversationStore } from '../../store/conversationStore';
import { useMediaStore } from '../../store/mediaStore';
import type { Draft } from '../../types/models';
import { LocraSheet } from '../LocraSheet';

import { ResponseModeSelector } from './ResponseModeSelector';
import { useVoiceDictation } from './useVoiceDictation';
import { VoiceMicButton, VoiceSheets } from './VoiceControl';

type LockVariant = 'self' | 'elsewhere';

interface ChatComposerProps {
  conversationId: string;
  placeholder: string;
  locked: boolean;
  lockLabel: string | null;
  lockVariant: LockVariant | null;
  canCancel: boolean;
  // Controlled: ChatScreen owns the draft (single source of truth, FR-031) —
  // the composer writes through conversationStore and reports back up.
  draft: Draft;
  onCancel: () => void;
  onOpenCamera: () => void;
  onDraftChange: (draft: Draft) => void;
  onConversationResolved: (conversationId: string) => void;
  targetCandidates: readonly ConversationCandidate[];
  selectedTargetId: string | null;
  onTargetChange: (conversationId: string | null) => void;
  responseMode: ResponseMode;
  onResponseModeChange: (mode: ResponseMode) => void;
}

export function ChatComposer({
  conversationId,
  placeholder,
  locked,
  lockLabel,
  lockVariant,
  canCancel,
  draft,
  onCancel,
  onOpenCamera,
  onDraftChange,
  onConversationResolved,
  targetCandidates,
  selectedTargetId,
  onTargetChange,
  responseMode,
  onResponseModeChange,
}: ChatComposerProps) {
  const pickImageFromLibrary = useMediaStore((s) => s.pickImageFromLibrary);
  const discardTemporaryImage = useMediaStore((s) => s.discardTemporaryImage);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [targetPickerVisible, setTargetPickerVisible] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onChangeText = useCallback(
    (text: string): void => {
      setSendError(null);
      conversationStore.setDraftText(conversationId, text);
      onDraftChange({ ...draft, text });
    },
    [conversationId, draft, onDraftChange]
  );

  const voice = useVoiceDictation({ draftText: draft.text, setDraftText: onChangeText });

  // Voice holds the composer exclusively: disable Send / image / past-chat while a
  // session is active, and make the field read-only while recording/finalizing so
  // the partial transcript cannot be edited — but never lock text editing otherwise.
  const canSend =
    !locked && !submitting && !voice.active && (draft.text.trim() !== '' || draft.imagePath !== null);
  const controlsDisabled = locked || submitting || voice.active;
  const inputEditable = !locked && !submitting && !voice.readOnly;
  const selectedTarget = targetCandidates.find((candidate) => candidate.id === selectedTargetId);

  const setDraftImage = useCallback(
    (imagePath: string | null): void => {
      conversationStore.setDraftImage(conversationId, imagePath);
      onDraftChange({ ...draft, imagePath });
    },
    [conversationId, draft, onDraftChange]
  );

  const onChooseCamera = useCallback((): void => {
    setSourceModalVisible(false);
    void haptics.tap();
    onOpenCamera();
  }, [onOpenCamera]);

  const onChooseGallery = useCallback(async (): Promise<void> => {
    setSourceModalVisible(false);
    setSendError(null);
    void haptics.tap();
    try {
      const localPath = await pickImageFromLibrary();
      if (localPath !== null) {
        if (draft.imagePath !== null && draft.imagePath !== localPath) {
          await discardTemporaryImage(draft.imagePath);
        }
        setDraftImage(localPath);
      }
    } catch {
      setSendError('That image could not be opened.');
      void haptics.error();
    }
  }, [discardTemporaryImage, draft.imagePath, pickImageFromLibrary, setDraftImage]);

  const onSubmit = useCallback((): void => {
    if (!canSend) {
      return;
    }

    const question = draft.text.trim();
    const imagePath = draft.imagePath;
    setSubmitting(true);
    setSendError(null);
    void haptics.tap();
    void conversationStore
      .submit(conversationId, {
        question,
        imagePath,
        ...(selectedTargetId === null ? {} : { conversationTargetId: selectedTargetId }),
      })
      .then((result) => {
        setSendError(result.targetNotice ?? null);
        onTargetChange(null);
        onDraftChange(conversationStore.getDraft(conversationId));
        onConversationResolved(result.conversationId);
      })
      .catch((error: unknown) => {
        setSendError(error instanceof Error ? error.message : 'Could not send that message.');
        void haptics.error();
      })
      .finally(() => {
        setSubmitting(false);
      });
  }, [
    canSend,
    conversationId,
    draft.imagePath,
    draft.text,
    onConversationResolved,
    onDraftChange,
    onTargetChange,
    selectedTargetId,
  ]);

  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: designTokens.spacing.space8 }}
      style={styles.dock}
    >
      {draft.imagePath !== null ? (
        <View style={styles.attachmentPill}>
          <MaterialCommunityIcons
            name="image-outline"
            size={16}
            color={designTokens.color.primary}
          />
          <Text style={styles.attachmentText} numberOfLines={1}>
            Image attached
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove attached image"
            disabled={controlsDisabled}
            hitSlop={designTokens.spacing.space8}
            style={({ pressed }) => [
              styles.attachmentRemove,
              pressed && !controlsDisabled && styles.attachmentRemovePressed,
              controlsDisabled && styles.disabled,
            ]}
            onPress={() => {
              void haptics.tap();
              if (draft.imagePath !== null) void discardTemporaryImage(draft.imagePath);
              setDraftImage(null);
            }}
          >
            <MaterialCommunityIcons name="close" size={16} color={designTokens.color.primary} />
          </Pressable>
        </View>
      ) : null}

      {selectedTarget !== undefined ? (
        <View style={styles.attachmentPill}>
          <MaterialCommunityIcons name="message-text-outline" size={16} color={designTokens.color.primary} />
          <Text style={styles.attachmentText} numberOfLines={1}>
            Using: {selectedTarget.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove past conversation target"
            disabled={controlsDisabled}
            hitSlop={designTokens.spacing.space8}
            style={({ pressed }) => [
              styles.attachmentRemove,
              pressed && !controlsDisabled && styles.attachmentRemovePressed,
              controlsDisabled && styles.disabled,
            ]}
            onPress={() => onTargetChange(null)}
          >
            <MaterialCommunityIcons name="close" size={16} color={designTokens.color.primary} />
          </Pressable>
        </View>
      ) : null}

      {sendError !== null ? <Text style={styles.errorText}>{sendError}</Text> : null}
      {lockLabel !== null ? (
        <View
          style={[
            styles.lockRow,
            lockVariant === 'elsewhere' && styles.lockRowElsewhere,
          ]}
        >
          <MaterialCommunityIcons
            name={lockVariant === 'elsewhere' ? 'lock-outline' : 'loading'}
            size={14}
            color={
              lockVariant === 'elsewhere' ? designTokens.color.textSecondary : designTokens.color.primary
            }
          />
          <Text style={styles.lockText}>{lockLabel}</Text>
        </View>
      ) : null}

      {voice.micMode !== 'idle' ? (
        <View style={styles.recordingRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            {voice.micMode === 'recording'
              ? `Recording… ${voice.elapsedLabel}`
              : 'Finishing transcription…'}
          </Text>
          {voice.micMode === 'recording' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel voice recording"
              hitSlop={designTokens.spacing.space8}
              onPress={() => {
                void haptics.tap();
                voice.onCancel();
              }}
            >
              <MaterialCommunityIcons name="close" size={16} color={designTokens.color.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          style={[styles.input, !inputEditable && styles.inputDisabled]}
          value={draft.text}
          onChangeText={onChangeText}
          placeholder={
            locked
              ? 'Generation in progress...'
              : voice.micMode === 'recording'
                ? 'Listening…'
                : placeholder
          }
          placeholderTextColor={designTokens.color.textSecondary}
          editable={inputEditable}
          multiline
        />

        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach image"
            disabled={controlsDisabled}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && !controlsDisabled && styles.iconButtonPressed,
              controlsDisabled && styles.disabled,
            ]}
            onPress={() => {
              setSourceModalVisible(true);
            }}
          >
            <MaterialCommunityIcons name="image-plus" size={22} color={designTokens.color.primary} />
          </Pressable>

          <ResponseModeSelector
            value={responseMode}
            disabled={controlsDisabled}
            onChange={onResponseModeChange}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use a past conversation"
            accessibilityState={{ disabled: controlsDisabled || targetCandidates.length === 0 }}
            disabled={controlsDisabled || targetCandidates.length === 0}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && !controlsDisabled && styles.iconButtonPressed,
              (controlsDisabled || targetCandidates.length === 0) && styles.disabled,
            ]}
            onPress={() => setTargetPickerVisible(true)}
          >
            <MaterialCommunityIcons
              name="message-text-outline"
              size={22}
              color={designTokens.color.primary}
            />
          </Pressable>

          <View style={styles.controlsSpacer} />

          {/* Right-side vertical action column: microphone directly ABOVE Send. */}
          <View style={styles.rightColumn}>
            {voice.enabled ? (
              <VoiceMicButton
                mode={voice.micMode}
                disabled={locked || submitting}
                onPress={voice.onMicPress}
              />
            ) : null}

            {canCancel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop generating"
                style={({ pressed }) => [styles.stopButton, pressed && styles.stopButtonPressed]}
                onPress={() => {
                  void haptics.tap();
                  onCancel();
                }}
              >
                <MaterialCommunityIcons name="stop" size={22} color={designTokens.color.onPrimary} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                style={({ pressed }) => [
                  styles.sendButton,
                  pressed && canSend && styles.sendButtonPressed,
                  !canSend && styles.disabled,
                ]}
                onPress={onSubmit}
              >
                <MaterialCommunityIcons name="arrow-up" size={22} color={designTokens.color.onPrimary} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <VoiceSheets />

      <SourceModal
        visible={sourceModalVisible}
        onCamera={onChooseCamera}
        onGallery={() => {
          void onChooseGallery();
        }}
        onCancel={() => {
          setSourceModalVisible(false);
        }}
      />
      <LocraSheet
        visible={targetPickerVisible}
        title="Use a past conversation"
        message="Choose one conversation to use for this request only."
        onRequestClose={() => setTargetPickerVisible(false)}
      >
        {targetCandidates.map((candidate) => (
          <SourceButton
            key={candidate.id}
            icon="message-text-outline"
            label={candidate.title}
            onPress={() => {
              onTargetChange(candidate.id);
              setTargetPickerVisible(false);
            }}
          />
        ))}
      </LocraSheet>
    </KeyboardStickyView>
  );
}

interface SourceModalProps {
  visible: boolean;
  onCamera: () => void;
  onGallery: () => void;
  onCancel: () => void;
}

function SourceModal({ visible, onCamera, onGallery, onCancel }: SourceModalProps) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <Pressable style={styles.modalScrim} onPress={onCancel}>
        <View style={styles.sourceSheet}>
          <Text style={styles.sourceTitle}>Attach image</Text>
          <SourceButton icon="camera-outline" label="Camera" onPress={onCamera} />
          <SourceButton icon="image-multiple-outline" label="Gallery" onPress={onGallery} />
          <SourceButton icon="close" label="Cancel" onPress={onCancel} quiet />
        </View>
      </Pressable>
    </Modal>
  );
}

interface SourceButtonProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  quiet?: boolean;
}

function SourceButton({ icon, label, onPress, quiet = false }: SourceButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.sourceButton,
        quiet && styles.sourceButtonQuiet,
        pressed && styles.sourceButtonPressed,
      ]}
      onPress={onPress}
    >
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={quiet ? designTokens.color.textSecondary : designTokens.color.primary}
      />
      <Text style={[styles.sourceButtonLabel, quiet && styles.sourceButtonLabelQuiet]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space12,
    paddingBottom: designTokens.spacing.space12,
    backgroundColor: designTokens.color.canvas,
    // borderTopWidth: designTokens.borderWidth,
    borderTopColor: designTokens.color.divider,
  },
  attachmentPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    paddingVertical: designTokens.spacing.space8,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space8,
  },
  attachmentText: {
    color: designTokens.color.primary,
    fontSize: designTokens.type.supporting.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginLeft: designTokens.spacing.space8,
  },
  attachmentRemove: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: designTokens.spacing.space8,
  },
  attachmentRemovePressed: {
    opacity: 0.7,
  },
  errorText: {
    color: designTokens.color.error,
    fontSize: designTokens.type.supporting.fontSize,
    marginBottom: designTokens.spacing.space8,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: designTokens.spacing.space4,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space8,
  },
  lockRowElsewhere: {
    backgroundColor: designTokens.color.surface,
    borderColor: designTokens.color.border,
  },
  lockText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
    marginLeft: designTokens.spacing.space8,
  },
  composer: {
    overflow: 'hidden',
    borderRadius: designTokens.radius.composer,
    backgroundColor: designTokens.color.surfaceStrong,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.spacing.space8,
    minHeight: designTokens.spacing.space24 + designTokens.spacing.space16,
    paddingHorizontal: designTokens.spacing.space8,
    paddingVertical: designTokens.spacing.space4,
    // borderTopWidth: designTokens.borderWidth,
    borderTopColor: designTokens.color.divider,
  },
  controlsSpacer: {
    flex: 1,
  },
  rightColumn: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: designTokens.spacing.space8,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: designTokens.spacing.space8,
    paddingVertical: designTokens.spacing.space4,
    paddingHorizontal: designTokens.spacing.space12,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space8,
  },
  recordingDot: {
    width: designTokens.spacing.space8,
    height: designTokens.spacing.space8,
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.error,
  },
  recordingText: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.supporting.fontSize,
  },
  iconButton: {
    width: designTokens.spacing.space24 + designTokens.spacing.space16,
    height: designTokens.spacing.space24 + designTokens.spacing.space16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  iconButtonPressed: {
    backgroundColor: designTokens.color.divider,
  },
  input: {
    minHeight: designTokens.spacing.space24 * 2,
    maxHeight: designTokens.spacing.space24 * 5,
    paddingHorizontal: designTokens.spacing.space16,
    paddingVertical: designTokens.spacing.space12,
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    color: designTokens.color.textSecondary,
  },
  sendButton: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
  sendButtonPressed: {
    backgroundColor: designTokens.color.primarySoft,
  },
  stopButton: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.primary,
  },
  stopButtonPressed: {
    backgroundColor: designTokens.color.primarySoft,
  },
  disabled: {
    opacity: 0.45,
  },
  modalScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: designTokens.color.scrim,
  },
  sourceSheet: {
    paddingHorizontal: designTokens.spacing.space20,
    paddingTop: designTokens.spacing.space16,
    paddingBottom: designTokens.spacing.space24,
    backgroundColor: designTokens.color.surfaceStrong,
    borderTopLeftRadius: designTokens.radius.card,
    borderTopRightRadius: designTokens.radius.card,
    borderTopWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
  },
  sourceTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.bodyStrong.fontSize,
    fontWeight: designTokens.type.bodyStrong.fontWeight,
    marginBottom: designTokens.spacing.space12,
  },
  sourceButton: {
    minHeight: designTokens.spacing.space24 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designTokens.spacing.space16,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space8,
  },
  sourceButtonQuiet: {
    backgroundColor: designTokens.color.surfaceStrong,
  },
  sourceButtonPressed: {
    backgroundColor: designTokens.color.divider,
  },
  sourceButtonLabel: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
    marginLeft: designTokens.spacing.space12,
  },
  sourceButtonLabelQuiet: {
    color: designTokens.color.textSecondary,
  },
});
