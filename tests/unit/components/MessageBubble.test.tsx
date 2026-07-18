import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import { MessageBubble } from '../../../src/components/chat/MessageBubble';
import type { ConversationMessage } from '../../../src/types/models';

const mockCopyText = jest.fn(async () => undefined);
const mockShareText = jest.fn(async () => undefined);

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../../src/components/chat/StreamingMessage', () => ({
  StreamingMessage: 'StreamingMessage',
}));
jest.mock('../../../src/components/chat/MessageActions', () => ({
  copyText: mockCopyText,
  shareText: mockShareText,
}));

function message(
  role: 'user' | 'assistant',
  text: string,
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: `${role}-1`,
    role,
    text,
    attachments: [],
    status: 'completed',
    errorMessage: null,
    createdAt: 1,
    ...overrides,
  };
}

function renderBubble(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) throw new Error('Message bubble did not render.');
  return renderer;
}

function byLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => node.props.accessibilityLabel === label);
}

describe('MessageBubble', () => {
  beforeEach(() => {
    mockCopyText.mockClear();
    mockShareText.mockClear();
  });

  it.each([
    'Hello! How can I assist you today?',
    'A long response. '.repeat(120),
  ])('uses content height without artificial card sizing', (text) => {
    const renderer = renderBubble(<MessageBubble message={message('assistant', text)} />);
    const style = StyleSheet.flatten(renderer.root.findByProps({ testID: 'assistant-message-card' }).props.style);

    expect(style).not.toHaveProperty('height');
    expect(style).not.toHaveProperty('minHeight');
    expect(style).not.toHaveProperty('flex');
    expect(style).not.toHaveProperty('justifyContent', 'space-between');
  });

  it('renders assistant actions as icon-only accessible controls and invokes handlers', () => {
    const regenerate = jest.fn();
    const report = jest.fn();
    const renderer = renderBubble(
      <MessageBubble
        message={message('assistant', 'Visible answer')}
        onRegenerate={regenerate}
        onReportIssue={report}
      />,
    );
    const labels = ['Regenerate response', 'Report issue', 'Copy message', 'Share message'];
    labels.forEach((label) => {
      const control = byLabel(renderer.root, label);
      expect(control.props.accessibilityRole).toBe('button');
      expect(control.props.accessibilityHint).toBeTruthy();
    });
    const visibleText = renderer.root.findAllByType(Text).flatMap((node) => node.props.children);
    expect(visibleText).not.toEqual(expect.arrayContaining(['Regenerate', 'Report issue', 'Copy', 'Share']));

    act(() => byLabel(renderer.root, 'Regenerate response').props.onPress());
    act(() => byLabel(renderer.root, 'Report issue').props.onPress());
    expect(regenerate).toHaveBeenCalledWith('assistant-1');
    expect(report).toHaveBeenCalledWith('assistant-1');
  });

  it('keeps user actions attached to and right-aligned with the user bubble', () => {
    const renderer = renderBubble(<MessageBubble message={message('user', 'My question')} />);
    const group = renderer.root.findByProps({ testID: 'user-message-group' });
    const card = group.findByProps({ testID: 'user-message-card' });
    const actions = group.findByProps({ testID: 'user-message-actions' });

    expect(card).toBeTruthy();
    expect(StyleSheet.flatten(actions.props.style)).toEqual(expect.objectContaining({ alignSelf: 'flex-end' }));
    expect(byLabel(renderer.root, 'Copy message').props.accessibilityRole).toBe('button');
    expect(byLabel(renderer.root, 'Share message').props.accessibilityRole).toBe('button');
  });

  it('renders a compact image thumbnail for a durable image message', () => {
    const renderer = renderBubble(
      <MessageBubble
        message={message('user', 'What is this?', {
          attachments: [{ kind: 'image', path: '/durable/conversation/image.jpg', available: true }],
        })}
      />,
    );

    expect(renderer.root.findByProps({ testID: 'image-message-thumbnail' })).toBeTruthy();
    expect(byLabel(renderer.root, 'Preview original image')).toBeTruthy();
  });

  it('keeps retry, continue, copy, share and report behavior distinct', async () => {
    const retry = jest.fn();
    const report = jest.fn();
    const failed = renderBubble(
      <MessageBubble
        message={message('assistant', 'Partial', { status: 'failed' })}
        onRetry={retry}
        onReportIssue={report}
      />,
    );
    act(() => byLabel(failed.root, 'Retry response').props.onPress());
    expect(retry).toHaveBeenCalledWith('assistant-1');

    const continueResponse = jest.fn();
    const truncated = renderBubble(
      <MessageBubble
        message={message('assistant', 'Cut off', { finishReason: 'length' })}
        onContinue={continueResponse}
      />,
    );
    act(() => byLabel(truncated.root, 'Continue response').props.onPress());
    expect(byLabel(truncated.root, 'Copy message').props.accessibilityRole).toBe('button');
    expect(byLabel(truncated.root, 'Share message').props.accessibilityRole).toBe('button');
    expect(continueResponse).toHaveBeenCalledWith('assistant-1');
  });
});
