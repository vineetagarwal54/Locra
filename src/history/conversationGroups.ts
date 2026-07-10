// Read-time recency grouping for the Conversation Drawer (T045) and Full History
// (T047). Pure functions over Conversation.updatedAt so both surfaces share one
// source of truth for the day math. Every stored conversation lands in exactly
// one bucket — nothing is ever dropped, including anything in 'older' (FR-019,
// design.md §7.14: "Conversations older than seven days must not disappear").

import type { Conversation } from '../types/models';

export type RecencyBucket = 'today' | 'yesterday' | 'previous7' | 'older';

export interface ConversationRecencyGroup {
  bucket: RecencyBucket;
  conversations: Conversation[];
}

export const RECENCY_BUCKET_ORDER: RecencyBucket[] = [
  'today',
  'yesterday',
  'previous7',
  'older',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function bucketForTimestamp(updatedAt: number, now: number): RecencyBucket {
  const todayStart = startOfLocalDay(now);
  if (updatedAt >= todayStart) {
    return 'today';
  }
  if (updatedAt >= todayStart - MS_PER_DAY) {
    return 'yesterday';
  }
  // Within the last seven days but before yesterday.
  if (updatedAt >= todayStart - 7 * MS_PER_DAY) {
    return 'previous7';
  }
  return 'older';
}

export function groupConversationsByRecency(
  conversations: Conversation[],
  now: number = Date.now()
): ConversationRecencyGroup[] {
  const byBucket = new Map<RecencyBucket, Conversation[]>();
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const conversation of sorted) {
    const bucket = bucketForTimestamp(conversation.updatedAt, now);
    const existing = byBucket.get(bucket);
    if (existing === undefined) {
      byBucket.set(bucket, [conversation]);
    } else {
      existing.push(conversation);
    }
  }

  return RECENCY_BUCKET_ORDER.flatMap((bucket) => {
    const group = byBucket.get(bucket);
    return group === undefined ? [] : [{ bucket, conversations: group }];
  });
}
