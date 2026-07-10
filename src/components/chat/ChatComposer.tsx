import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
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

import { VoiceButton } from '../../components/VoiceButton';
import { haptics, theme } from '../../constants/theme';
import { conversationStore } from '../../store/conversationStore';
import { useMediaStore } from '../../store/mediaStore';
import type { Draft } from '../../types/models';

const READABLE_LINE_HEIGHT_RATIO = 1.45;

interface ChatComposerProps {
  conversationId: string;
  placeholder: string;
  locked: boolean;
  lockLabel: string | null;
  onOpenCamera: () => void;
  onDraftChange?: (draft: Draft) => void;
  onConversationResolved: (conversationId: string) => void;
}

export function ChatComposer({
  conversationId,
  placeholder,
  locked,
  lockLabel,
  onOpenCamera,
  onDraftChange,
  onConversationResolved,
}: ChatComposerProps) {
  const pickImageFromLibrary = useMediaStore((s) => s.pickImageFromLibrary);
  const [draft, setDraft] = useState<Draft>(() => conversationStore.getDraft(conversationId));
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const nextDraft = conversationStore.getDraft(conversationId);
      setDraft(nextDraft);
      onDraftChange?.(nextDraft);
      return undefined;
    }, [conversationId, onDraftChange])
  );

  const canSend =
    !locked && !submitting && (draft.text.trim() !== '' || draft.imagePath !== null);
  const controlsDisabled = locked || submitting;

  const onChangeText = useCallback(
    (text: string): void => {
      setSendError(null);
      conversationStore.setDraftText(conversationId, text);
      setDraft((current) => {
        const nextDraft = { ...current, text };
        onDraftChange?.(nextDraft);
        return nextDraft;
      });
    },
    [conversationId, onDraftChange]
  );

  const onVoiceTranscript = useCallback(
    (text: string): void => {
      const nextText = draft.text.trim() === '' ? text : `${draft.text.trim()} ${text}`;
      onChangeText(nextText);
    },
    [draft.text, onChangeText]
  );

  const setDraftImage = useCallback(
    (imagePath: string | null): void => {
      conversationStore.setDraftImage(conversationId, imagePath);
      setDraft((current) => {
        const nextDraft = { ...current, imagePath };
        onDraftChange?.(nextDraft);
        return nextDraft;
      });
    },
    [conversationId, onDraftChange]
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
        setDraftImage(localPath);
      }
    } catch {
      setSendError('That image could not be opened.');
      void haptics.error();
    }
  }, [pickImageFromLibrary, setDraftImage]);

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
      .submit(conversationId, { question, imagePath })
      .then((result) => {
        const nextDraft = conversationStore.getDraft(conversationId);
        setDraft(nextDraft);
        onDraftChange?.(nextDraft);
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
  ]);

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: theme.space2 }} style={styles.dock}>
      {draft.imagePath !== null ? (
        <View style={styles.attachmentPill}>
          <MaterialCommunityIcons name="image-outline" size={16} color={theme.accent} />
          <Text style={styles.attachmentText} numberOfLines={1}>
            Image attached
          </Text>
        </View>
      ) : null}

      {sendError !== null ? <Text style={styles.errorText}>{sendError}</Text> : null}
      {lockLabel !== null ? <Text style={styles.lockText}>{lockLabel}</Text> : null}

      <View style={styles.composer}>
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
          <MaterialCommunityIcons name="image-plus" size={22} color={theme.accent} />
        </Pressable>

        <TextInput
          style={[styles.input, controlsDisabled && styles.inputDisabled]}
          value={draft.text}
          onChangeText={onChangeText}
          placeholder={locked ? 'Generation in progress...' : placeholder}
          placeholderTextColor={theme.textSecondary}
          editable={!controlsDisabled}
          multiline
        />

        <VoiceButton disabled={controlsDisabled} onTranscript={onVoiceTranscript} />

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
          <MaterialCommunityIcons name="arrow-up" size={22} color={theme.textPrimary} />
        </Pressable>
      </View>

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
        color={quiet ? theme.textSecondary : theme.accent}
      />
      <Text style={[styles.sourceButtonLabel, quiet && styles.sourceButtonLabelQuiet]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: theme.space4,
    paddingTop: theme.space3,
    paddingBottom: theme.space3,
    backgroundColor: theme.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  attachmentPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    paddingVertical: theme.space2,
    paddingHorizontal: theme.space3,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space2,
  },
  attachmentText: {
    color: theme.accent,
    fontSize: theme.fontSizeSm,
    fontWeight: '700',
    marginLeft: theme.space2,
  },
  errorText: {
    color: theme.error,
    fontSize: theme.fontSizeSm,
    marginBottom: theme.space2,
  },
  lockText: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeSm,
    marginBottom: theme.space2,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.space2,
  },
  iconButton: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  iconButtonPressed: {
    backgroundColor: theme.surface3,
  },
  input: {
    flex: 1,
    minHeight: theme.space6 * 2,
    maxHeight: theme.space6 * 5,
    paddingHorizontal: theme.space4,
    paddingVertical: theme.space3,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
  inputDisabled: {
    color: theme.textSecondary,
  },
  sendButton: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accent,
  },
  sendButtonPressed: {
    backgroundColor: theme.accentDim,
  },
  disabled: {
    opacity: 0.42,
  },
  modalScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.scrim,
  },
  sourceSheet: {
    paddingHorizontal: theme.space5,
    paddingTop: theme.space4,
    paddingBottom: theme.space6,
    backgroundColor: theme.canvas,
    borderTopLeftRadius: theme.radiusLg,
    borderTopRightRadius: theme.radiusLg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  sourceTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '700',
    marginBottom: theme.space3,
  },
  sourceButton: {
    minHeight: theme.space6 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space4,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginBottom: theme.space2,
  },
  sourceButtonQuiet: {
    backgroundColor: theme.canvas,
  },
  sourceButtonPressed: {
    backgroundColor: theme.surface3,
  },
  sourceButtonLabel: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
    marginLeft: theme.space3,
  },
  sourceButtonLabelQuiet: {
    color: theme.textSecondary,
  },
});
