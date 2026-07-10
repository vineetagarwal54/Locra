import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  type ListRenderItem,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssistantIdentityRow } from '../components/chat/AssistantIdentityRow';
import { ChatComposer } from '../components/chat/ChatComposer';
import { ImagePromptCard } from '../components/chat/ImagePromptCard';
import { MessageBubble } from '../components/chat/MessageBubble';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { haptics, theme } from '../constants/theme';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { conversationStore } from '../store/conversationStore';
import { useHistoryStore } from '../store/historyStore';
import type {
  Conversation,
  ConversationMessage,
  ConversationRuntimeState,
  Draft,
} from '../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const READABLE_LINE_HEIGHT_RATIO = 1.48;

export function ChatScreen({ navigation, route }: Props) {
  const conversationId = route.params.conversationId;
  const historyRevision = useHistoryStore((s) => s.sessions);
  const listRef = useRef<FlatList<ConversationMessage> | null>(null);

  const [runtimeState, setRuntimeState] = useState<ConversationRuntimeState | null>(() =>
    conversationStore.getConversationRuntimeState(conversationId)
  );
  const [draft, setDraft] = useState<Draft>(() => conversationStore.getDraft(conversationId));
  const [screenError, setScreenError] = useState<string | null>(null);

  const conversation = useMemo(
    () =>
      conversationId === 'new'
        ? null
        : useHistoryStore.getState().getConversation(conversationId),
    [conversationId, historyRevision]
  );

  useEffect(() => {
    setRuntimeState(conversationStore.getConversationRuntimeState(conversationId));
    return conversationStore.subscribeToConversation(conversationId, setRuntimeState);
  }, [conversationId]);

  useEffect(() => {
    setDraft(conversationStore.getDraft(conversationId));
  }, [conversationId, historyRevision]);

  const isMissingConversation = conversationId !== 'new' && conversation === null;
  const activeOwner = conversationStore.getActiveGenerationOwner();
  const isOwnGeneration = runtimeState?.isOwnerOfActiveInference === true;
  const lockedByAnotherConversation =
    conversationStore.isAnyGenerationInFlight() && activeOwner !== null && activeOwner !== conversationId;
  const locked = isOwnGeneration || lockedByAnotherConversation;
  const lockLabel = isOwnGeneration
    ? 'Locra is answering in this conversation.'
    : lockedByAnotherConversation
      ? 'Generation is in progress elsewhere.'
      : null;
  const placeholder = getComposerPlaceholder(conversation, draft);

  const onOpenHistory = useCallback((): void => {
    void haptics.tap();
    navigation.navigate('History');
  }, [navigation]);

  const onOpenSettings = useCallback((): void => {
    void haptics.tap();
  }, []);

  const onOpenCamera = useCallback((): void => {
    navigation.navigate('Capture', { conversationId });
  }, [conversationId, navigation]);

  const onConversationResolved = useCallback(
    (resolvedConversationId: string): void => {
      if (conversationId === 'new') {
        navigation.replace('Chat', { conversationId: resolvedConversationId });
      }
    },
    [conversationId, navigation]
  );

  const onRetry = useCallback(
    (assistantMessageId: string): void => {
      setScreenError(null);
      void conversationStore
        .retryFailedMessage(conversationId, assistantMessageId)
        .catch((error: unknown) => {
          setScreenError(error instanceof Error ? error.message : 'Could not retry that response.');
          void haptics.error();
        });
    },
    [conversationId]
  );

  const renderItem: ListRenderItem<ConversationMessage> = useCallback(
    ({ item }) => {
      const streamingText =
        runtimeState?.assistantMessageId === item.id ? runtimeState.streamingText : '';

      return (
        <View>
          {item.role === 'assistant' ? <AssistantIdentityRow /> : null}
          <MessageBubble message={item} streamingText={streamingText} onRetry={onRetry} />
        </View>
      );
    },
    [onRetry, runtimeState?.assistantMessageId, runtimeState?.streamingText]
  );

  if (isMissingConversation) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <AppHeader onMenu={onOpenHistory} onSettings={onOpenSettings} />
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons
            name="chat-remove-outline"
            size={theme.space6 * 2}
            color={theme.textMuted}
          />
          <Text style={styles.emptyTitle}>This conversation is gone</Text>
          <Text style={styles.emptyBody}>It was deleted from history on this phone.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <AppHeader onMenu={onOpenHistory} onSettings={onOpenSettings} />
      {screenError !== null ? <Text style={styles.screenError}>{screenError}</Text> : null}
      <FlatList
        ref={listRef}
        data={conversation?.messages ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <ChatHeaderContent
            conversation={conversation}
            draft={draft}
            onSuggestion={(text) => {
              conversationStore.setDraftText(conversationId, text);
              setDraft(conversationStore.getDraft(conversationId));
            }}
            onPhotoSuggestion={onOpenCamera}
          />
        }
        onContentSizeChange={() => {
          listRef.current?.scrollToEnd({ animated: true });
        }}
      />
      <ChatComposer
        conversationId={conversationId}
        placeholder={placeholder}
        locked={locked}
        lockLabel={lockLabel}
        onOpenCamera={onOpenCamera}
        onDraftChange={setDraft}
        onConversationResolved={onConversationResolved}
      />
    </SafeAreaView>
  );
}

interface AppHeaderProps {
  onMenu: () => void;
  onSettings: () => void;
}

function AppHeader({ onMenu, onSettings }: AppHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open conversations"
        style={styles.headerButton}
        onPress={onMenu}
      >
        <MaterialCommunityIcons name="menu" size={24} color={theme.textSecondary} />
      </Pressable>
      <Text style={styles.headerTitle}>Locra</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        style={styles.headerButton}
        onPress={onSettings}
      >
        <OfflineIndicator />
      </Pressable>
    </View>
  );
}

interface ChatHeaderContentProps {
  conversation: Conversation | null;
  draft: Draft;
  onSuggestion: (text: string) => void;
  onPhotoSuggestion: () => void;
}

function ChatHeaderContent({
  conversation,
  draft,
  onSuggestion,
  onPhotoSuggestion,
}: ChatHeaderContentProps) {
  const hasMessages = conversation !== null && conversation.messages.length > 0;

  if (hasMessages) {
    return draft.imagePath !== null ? (
      <View style={styles.previewBlock}>
        <AssistantIdentityRow label="Locra is ready to inspect this image" />
        <ImagePromptCard
          imagePath={draft.imagePath}
          question={draft.text}
          metadata="Attached to your next message"
        />
      </View>
    ) : null;
  }

  return (
    <View style={styles.newChat}>
      <View style={styles.privacyIcon}>
        <MaterialCommunityIcons name="shield-check-outline" size={22} color={theme.accent} />
      </View>
      <Text style={styles.newChatTitle}>What is on your mind?</Text>
      <Text style={styles.newChatBody}>
        Processing locally on your device for absolute privacy.
      </Text>

      {draft.imagePath !== null ? (
        <View style={styles.previewBlock}>
          <AssistantIdentityRow label="Ready to analyze your image" />
          <ImagePromptCard
            imagePath={draft.imagePath}
            question={draft.text}
            metadata="Attached to your first message"
          />
        </View>
      ) : (
        <View style={styles.suggestionList}>
          <SuggestionCard
            icon="email-edit-outline"
            label="Draft an email"
            onPress={() => onSuggestion('Draft an email')}
          />
          <SuggestionCard
            icon="image-search-outline"
            label="Identify something in a photo"
            onPress={onPhotoSuggestion}
          />
          <SuggestionCard
            icon="school-outline"
            label="Explain a complex concept"
            onPress={() => onSuggestion('Explain a complex concept')}
          />
        </View>
      )}

      <Text style={styles.footerNote}>
        Locra can make mistakes. Consider verifying important information.
      </Text>
    </View>
  );
}

interface SuggestionCardProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}

function SuggestionCard({ icon, label, onPress }: SuggestionCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.suggestionCard, pressed && styles.suggestionCardPressed]}
      onPress={() => {
        void haptics.tap();
        onPress();
      }}
    >
      <MaterialCommunityIcons name={icon} size={20} color={theme.accent} />
      <Text style={styles.suggestionText}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={theme.textMuted} />
    </Pressable>
  );
}

function getComposerPlaceholder(conversation: Conversation | null, draft: Draft): string {
  if (draft.imagePath !== null) {
    return 'Analyze this image...';
  }

  if (conversation !== null && conversation.messages.length > 0) {
    return 'Ask a follow-up question...';
  }

  return 'Ask anything...';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.canvas,
  },
  header: {
    minHeight: theme.space6 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  headerButton: {
    minWidth: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
  },
  screenError: {
    color: theme.error,
    fontSize: theme.fontSizeSm,
    paddingHorizontal: theme.space4,
    paddingTop: theme.space2,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: theme.space4,
    paddingTop: theme.space5,
    paddingBottom: theme.space6 * 2,
  },
  newChat: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: theme.space6,
  },
  privacyIcon: {
    width: theme.space6 * 2,
    height: theme.space6 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusPill,
    backgroundColor: theme.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.accentBorder,
    marginBottom: theme.space4,
  },
  newChatTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeXl,
    fontWeight: '700',
    lineHeight: theme.fontSizeXl * 1.18,
    marginBottom: theme.space2,
  },
  newChatBody: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
    marginBottom: theme.space5,
  },
  suggestionList: {
    marginBottom: theme.space5,
  },
  suggestionCard: {
    minHeight: theme.space6 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space4,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    marginBottom: theme.space3,
  },
  suggestionCardPressed: {
    backgroundColor: theme.surface3,
  },
  suggestionText: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: theme.fontSizeMd,
    fontWeight: '600',
    marginHorizontal: theme.space3,
  },
  previewBlock: {
    marginBottom: theme.space5,
  },
  footerNote: {
    color: theme.textMuted,
    fontSize: theme.fontSizeXs,
    lineHeight: theme.fontSizeXs * READABLE_LINE_HEIGHT_RATIO,
    marginTop: theme.space4,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space5,
  },
  emptyTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontSizeLg,
    fontWeight: '700',
    marginTop: theme.space4,
    marginBottom: theme.space2,
  },
  emptyBody: {
    color: theme.textSecondary,
    fontSize: theme.fontSizeMd,
    textAlign: 'center',
    lineHeight: theme.fontSizeMd * READABLE_LINE_HEIGHT_RATIO,
  },
});
