import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  QwenImageUnreadableError,
  convertToQwenMessages,
  normalizeLocalImageUri,
  type QwenContentPart,
} from '../../../src/inference/llamaRn/QwenMessageConverter';

const readable = { isReadableFile: () => true };

describe('Qwen message converter', () => {
  it('maps a plain text message to a string-content message', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: 'You are Locra.' },
      { role: 'user', content: 'Hello' },
    ];

    expect(convertToQwenMessages(messages, readable)).toEqual([
      { role: 'system', content: 'You are Locra.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('builds a text + local image_url part for an image message without base64', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'user', content: 'What is this?', mediaPath: '/data/app/processed.jpg' },
    ];

    const [converted] = convertToQwenMessages(messages, readable);
    const parts = converted.content as QwenContentPart[];
    expect(parts).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'file:///data/app/processed.jpg' } },
    ]);
    // No base64 payload is ever produced.
    expect(JSON.stringify(parts)).not.toContain('base64');
  });

  it('normalizes a bare device path to a file:// URI and passes existing URIs through', () => {
    expect(normalizeLocalImageUri('/data/app/img.jpg')).toBe('file:///data/app/img.jpg');
    expect(normalizeLocalImageUri('file:///data/app/img.jpg')).toBe('file:///data/app/img.jpg');
    expect(normalizeLocalImageUri('content://media/1')).toBe('content://media/1');
  });

  it('omits an empty text part but always includes the image part', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'user', content: '   ', mediaPath: '/data/app/img.jpg' },
    ];

    const [converted] = convertToQwenMessages(messages, readable);
    expect(converted.content).toEqual([
      { type: 'image_url', image_url: { url: 'file:///data/app/img.jpg' } },
    ]);
  });

  it('throws QwenImageUnreadableError when a processed image is not readable', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'user', content: 'What is this?', mediaPath: '/data/app/missing.jpg' },
    ];

    expect(() => convertToQwenMessages(messages, { isReadableFile: () => false })).toThrow(
      QwenImageUnreadableError
    );
  });

  it('treats the supplied message list as the only authoritative context (no injected history)', () => {
    const messages: ModelRequestMessage[] = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Answer one' },
      { role: 'user', content: 'Follow-up' },
    ];

    const converted = convertToQwenMessages(messages, readable);
    expect(converted).toHaveLength(3);
    expect(converted.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
