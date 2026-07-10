import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDrawerStatus } from '@react-navigation/drawer';
import { DrawerActions, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import { designTokens, haptics } from '../constants/theme';
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

// FR-013: auto-follow streamed content only while the user sits within this many
// points of the bottom; beyond it we assume they scrolled up to re-read and never
// force a jump back down.
const AUTO_FOLLOW_THRESHOLD = 96;

// Id of the most recent user turn, used to detect a freshly sent message
// (text / image / voice all append a user message) so the list can reveal it.
function lastUserMessageId(messages: ConversationMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      return messages[i].id;
    }
  }
  return null;
}

export function ChatScreen({ navigation, route }: Props) {
  const conversationId = route.params.conversationId;
  const historyRevision = useHistoryStore((s) => s.conversations);
  const listRef = useRef<FlatList<ConversationMessage> | null>(null);
  const isNearBottomRef = useRef(true);

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

  // FR-031: switching away from and back to a conversation (including the
  // not-yet-created 'new' slot) restores its exact draft from conversationStore.
  useFocusEffect(
    useCallback(() => {
      setDraft(conversationStore.getDraft(conversationId));
      setRuntimeState(conversationStore.getConversationRuntimeState(conversationId));
      return undefined;
    }, [conversationId])
  );

  // ── Smart auto-scroll ──────────────────────────────────────────────────────
  const prevLastUserMessageIdRef = useRef<string | null>(null);

  // Switching/resuming a conversation: baseline the last-user-turn tracker and
  // jump to the latest message without animation, so a resumed thread opens at
  // the bottom with no visible jump.
  useEffect(() => {
    const messages =
      conversationId === 'new'
        ? []
        : (useHistoryStore.getState().getConversation(conversationId)?.messages ?? []);
    prevLastUserMessageIdRef.current = lastUserMessageId(messages);
    isNearBottomRef.current = true;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, [conversationId]);

  // A freshly sent turn (text, image, or voice transcript) appends a new user
  // message — reveal it and re-arm auto-follow so the assistant reply streams
  // into view while the user stays near the bottom.
  useEffect(() => {
    const id = lastUserMessageId(conversation?.messages ?? []);
    if (id !== null && id !== prevLastUserMessageIdRef.current) {
      prevLastUserMessageIdRef.current = id;
      isNearBottomRef.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [conversation?.messages]);

  // ── Android back button ────────────────────────────────────────────────────
  const drawerStatus = useDrawerStatus();
  const drawerStatusRef = useRef(drawerStatus);
  useEffect(() => {
    drawerStatusRef.current = drawerStatus;
  }, [drawerStatus]);

  const keyboardVisibleRef = useRef(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisibleRef.current = true;
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Try normal navigation first — close the drawer, dismiss the keyboard, or pop
  // a nested screen — and only confirm exit at the Chat root where back would
  // otherwise leave the app. Active ONLY while Chat is focused, so onboarding,
  // model setup, recovery, and nested screens keep their default back behavior.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = (): boolean => {
        if (drawerStatusRef.current === 'open') {
          navigation.dispatch(DrawerActions.closeDrawer());
          return true;
        }
        if (keyboardVisibleRef.current) {
          Keyboard.dismiss();
          return true;
        }
        if (navigation.canGoBack()) {
          return false;
        }
        Alert.alert('Exit Locra?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
        ]);
        return true;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [navigation])
  );

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
  const lockVariant = isOwnGeneration ? 'self' : lockedByAnotherConversation ? 'elsewhere' : null;
  // T049 / contracts/inference-ownership.md point 3: the stop control exists only
  // for the conversation that actually owns the in-flight generation.
  const canCancel = activeOwner === conversationId;
  const placeholder = getComposerPlaceholder(conversation, draft);

  const onOpenDrawer = useCallback((): void => {
    void haptics.tap();
    // The action bubbles up from this stack screen to the parent drawer (T046).
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const onCancelGeneration = useCallback((): void => {
    conversationStore.cancelActiveGeneration(conversationId);
  }, [conversationId]);

  const onOpenSettings = useCallback((): void => {
    void haptics.tap();
  }, []);

  const onOpenCamera = useCallback((): void => {
    navigation.navigate('Capture', { conversationId });
  }, [conversationId, navigation]);

  const onRemoveDraftImage = useCallback((): void => {
    conversationStore.setDraftImage(conversationId, null);
    setDraft(conversationStore.getDraft(conversationId));
  }, [conversationId]);

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

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    isNearBottomRef.current = distanceFromBottom <= AUTO_FOLLOW_THRESHOLD;
  }, []);

  const onContentSizeChange = useCallback((): void => {
    if (isNearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

  const renderItem: ListRenderItem<ConversationMessage> = useCallback(
    ({ item }) => {
      const streamingText =
        runtimeState?.assistantMessageId === item.id ? runtimeState.streamingText : '';
      // FR-030: a persisted 'generating' message that no live runtime owns (e.g.
      // the process died mid-generation) is shown as interrupted, matched by the
      // message's own id — never an indefinite spinner.
      const message: ConversationMessage =
        item.status === 'generating' && runtimeState?.assistantMessageId !== item.id
          ? { ...item, status: 'interrupted' }
          : item;

      return (
        <View>
          {message.role === 'assistant' ? <AssistantIdentityRow /> : null}
          <MessageBubble message={message} streamingText={streamingText} onRetry={onRetry} />
        </View>
      );
    },
    [onRetry, runtimeState?.assistantMessageId, runtimeState?.streamingText]
  );

  if (isMissingConversation) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <AppHeader onMenu={onOpenDrawer} onSettings={onOpenSettings} />
        <View style={styles.emptyWrap}>
          <MaterialCommunityIcons
            name="chat-remove-outline"
            size={designTokens.spacing.space24 * 2}
            color={designTokens.color.textSecondary}
          />
          <Text style={styles.emptyTitle}>This conversation is gone</Text>
          <Text style={styles.emptyBody}>It was deleted from history on this phone.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <AppHeader onMenu={onOpenDrawer} onSettings={onOpenSettings} />
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
            onRemoveImage={onRemoveDraftImage}
          />
        }
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
      />
      <ChatComposer
        conversationId={conversationId}
        placeholder={placeholder}
        locked={locked}
        lockLabel={lockLabel}
        lockVariant={lockVariant}
        canCancel={canCancel}
        draft={draft}
        onCancel={onCancelGeneration}
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
        <MaterialCommunityIcons name="menu" size={24} color={designTokens.color.textSecondary} />
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
  onRemoveImage: () => void;
}

function ChatHeaderContent({
  conversation,
  draft,
  onSuggestion,
  onPhotoSuggestion,
  onRemoveImage,
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
          onRemove={onRemoveImage}
        />
      </View>
    ) : null;
  }

  return (
    <View style={styles.newChat}>
      <View style={styles.privacyIcon}>
        <MaterialCommunityIcons
          name="shield-check-outline"
          size={22}
          color={designTokens.color.primary}
        />
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
            onRemove={onRemoveImage}
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
      <MaterialCommunityIcons name={icon} size={20} color={designTokens.color.primary} />
      <Text style={styles.suggestionText}>{label}</Text>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={designTokens.color.textSecondary}
      />
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
    backgroundColor: designTokens.color.canvas,
  },
  header: {
    minHeight: designTokens.spacing.space24 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designTokens.spacing.space16,
    borderBottomWidth: designTokens.borderWidth,
    borderBottomColor: designTokens.color.divider,
  },
  headerButton: {
    minWidth: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
  },
  screenError: {
    color: designTokens.color.error,
    fontSize: designTokens.type.supporting.fontSize,
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space8,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: designTokens.spacing.space16,
    paddingTop: designTokens.spacing.space20,
    paddingBottom: designTokens.spacing.space24 * 2,
  },
  newChat: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: designTokens.spacing.space24,
  },
  privacyIcon: {
    width: designTokens.spacing.space24 * 2,
    height: designTokens.spacing.space24 * 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.pill,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space16,
  },
  newChatTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.screenTitle.fontSize,
    fontWeight: designTokens.type.screenTitle.fontWeight,
    lineHeight: designTokens.type.screenTitle.lineHeight,
    marginBottom: designTokens.spacing.space8,
  },
  newChatBody: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    lineHeight: designTokens.type.body.lineHeight,
    marginBottom: designTokens.spacing.space20,
  },
  suggestionList: {
    marginBottom: designTokens.spacing.space20,
  },
  suggestionCard: {
    minHeight: designTokens.spacing.space24 * 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designTokens.spacing.space16,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface,
    borderWidth: designTokens.borderWidth,
    borderColor: designTokens.color.border,
    marginBottom: designTokens.spacing.space12,
  },
  suggestionCardPressed: {
    backgroundColor: designTokens.color.divider,
  },
  suggestionText: {
    flex: 1,
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.cardTitle.fontSize,
    fontWeight: designTokens.type.cardTitle.fontWeight,
    marginHorizontal: designTokens.spacing.space12,
  },
  previewBlock: {
    marginBottom: designTokens.spacing.space20,
  },
  footerNote: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.caption.fontSize,
    lineHeight: designTokens.type.caption.lineHeight,
    marginTop: designTokens.spacing.space16,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: designTokens.spacing.space20,
  },
  emptyTitle: {
    color: designTokens.color.textPrimary,
    fontSize: designTokens.type.sectionTitle.fontSize,
    fontWeight: designTokens.type.sectionTitle.fontWeight,
    marginTop: designTokens.spacing.space16,
    marginBottom: designTokens.spacing.space8,
  },
  emptyBody: {
    color: designTokens.color.textSecondary,
    fontSize: designTokens.type.body.fontSize,
    textAlign: 'center',
    lineHeight: designTokens.type.body.lineHeight,
  },
});
