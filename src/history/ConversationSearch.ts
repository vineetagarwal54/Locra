import type { Conversation, ConversationMessage } from '../types/models';

export const IMAGE_CONVERSATION_TITLE = 'Image conversation';
export const UNTITLED_CONVERSATION_TITLE = 'Untitled conversation';

export function deriveConversationTitle(conversation: Conversation): string {
  const persistedTitle = conversation.title?.trim();
  if (persistedTitle !== undefined && persistedTitle !== '') {
    return persistedTitle;
  }

  const firstMessage = conversation.messages[0];
  if (firstMessage === undefined) {
    return UNTITLED_CONVERSATION_TITLE;
  }

  const text = firstMessage.text.trim();
  if (text !== '') {
    return text;
  }

  return firstMessage.attachments.length > 0
    ? IMAGE_CONVERSATION_TITLE
    : UNTITLED_CONVERSATION_TITLE;
}

export function deriveConversationPreview(conversation: Conversation): string {
  const lastMessage = conversation.messages.at(-1);
  if (
    lastMessage !== undefined &&
    lastMessage.role === 'assistant' &&
    lastMessage.status === 'completed'
  ) {
    const text = lastMessage.text.trim();
    if (text !== '') {
      return text;
    }
  }

  const userMessage = findMostRecentUserMessage(conversation.messages);
  if (userMessage !== null && userMessage.text.trim() !== '') {
    return userMessage.text.trim();
  }

  return deriveConversationTitle(conversation);
}

export function searchConversations(
  conversations: Conversation[],
  query: string
): Conversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === '') {
    return conversations;
  }

  return conversations.filter((conversation) => {
    const searchableText = [
      deriveConversationTitle(conversation),
      ...conversation.messages.map((message) => message.text),
    ]
      .join('\n')
      .toLocaleLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

function findMostRecentUserMessage(messages: ConversationMessage[]): ConversationMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }

  return null;
}
