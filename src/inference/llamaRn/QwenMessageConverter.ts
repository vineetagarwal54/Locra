// Converts Locra's authoritative supplied context into llama.rn Qwen messages
// (Spec 005, T027).
//
// The supplied `ModelRequestMessage[]` IS the only authoritative conversation
// context — the converter never injects hidden history and never relies on
// native chat state. Image messages carry a local `image_url` alongside text;
// JavaScript does NOT base64-encode the image (llama.rn converts the local URI to
// a media path internally, matching the validated spike). Processed image files
// are re-verified readable immediately before they are handed to the model.
//
// No custom chat template is applied here: llama.rn/model defaults handle the
// Instruct chat template. This module only shapes the message list.

import type { ModelRequestMessage } from '../ContextBuilder';

export type QwenChatRole = 'system' | 'user' | 'assistant';

export type QwenContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface QwenChatMessage {
  role: QwenChatRole;
  content: string | QwenContentPart[];
}

export interface QwenMessageConverterDeps {
  /** True only when the processed local file exists and is readable/non-empty. */
  isReadableFile: (fileUri: string) => boolean;
}

/** Thrown when a processed image file is missing/unreadable at generation time. */
export class QwenImageUnreadableError extends Error {
  constructor(public readonly imagePath: string) {
    super('The processed image could not be read for inference.');
    this.name = 'QwenImageUnreadableError';
  }
}

/**
 * Normalizes a local image path to the `file://` URI llama.rn expects. Absolute
 * device paths (no scheme) are prefixed; existing `file://`/`content://` URIs are
 * passed through unchanged.
 */
export function normalizeLocalImageUri(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) {
    return path;
  }
  return `file://${path}`;
}

export function convertToQwenMessages(
  messages: ModelRequestMessage[],
  deps: QwenMessageConverterDeps
): QwenChatMessage[] {
  return messages.map((message) => convertMessage(message, deps));
}

function convertMessage(
  message: ModelRequestMessage,
  deps: QwenMessageConverterDeps
): QwenChatMessage {
  const role = message.role;
  if (message.mediaPath === undefined || message.mediaPath === '') {
    return { role, content: message.content };
  }

  // Re-verify the processed file is readable immediately before inference.
  if (!deps.isReadableFile(message.mediaPath)) {
    throw new QwenImageUnreadableError(message.mediaPath);
  }

  const parts: QwenContentPart[] = [];
  if (message.content.trim() !== '') {
    parts.push({ type: 'text', text: message.content });
  }
  parts.push({
    type: 'image_url',
    image_url: { url: normalizeLocalImageUri(message.mediaPath) },
  });
  return { role, content: parts };
}
