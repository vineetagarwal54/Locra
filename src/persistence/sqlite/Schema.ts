// Spec 006 — canonical SQL schema (data-model.md). Pure SQL + a driver-agnostic
// initializer so the schema contract is testable without the native module.
// Table creation order respects foreign-key parent-before-child dependencies.

import type { SqliteDriver } from '../types';

/** Bump when the schema changes incompatibly. Dev builds reset on mismatch (FR-006). */
export const SCHEMA_VERSION = 1;

/**
 * Ordered DDL statements that build the entire store. Parents precede children
 * so foreign keys resolve. Every child of `conversation` cascades on delete so a
 * conversation deletion leaves zero orphans (FR-005/006, SC-014).
 */
export const SCHEMA_STATEMENTS: ReadonlyArray<string> = [
  // conversation — unit of isolation and deletion.
  `CREATE TABLE IF NOT EXISTS conversation (
    id TEXT PRIMARY KEY,
    title TEXT,
    normalized_title TEXT,
    response_mode TEXT NOT NULL CHECK (response_mode IN ('low','medium','high')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS ix_conversation_updated
    ON conversation (updated_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_conversation_title
    ON conversation (normalized_title, updated_at DESC, id DESC)`,

  // message — submitted user messages and assistant attempts share one table.
  `CREATE TABLE IF NOT EXISTS message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    reply_to_message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
    attempt_number INTEGER,
    is_active_attempt INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    finalized_at INTEGER,
    created_at INTEGER NOT NULL,
    CHECK (
      (role = 'user'
        AND reply_to_message_id IS NULL
        AND attempt_number IS NULL
        AND status = 'submitted')
      OR
      (role = 'assistant'
        AND reply_to_message_id IS NOT NULL
        AND attempt_number IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS ix_message_conversation
    ON message (conversation_id, created_at DESC, id DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_message_attempt
    ON message (reply_to_message_id, attempt_number)
    WHERE role = 'assistant'`,
  // At most one active assistant attempt per source user message.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_message_active_attempt
    ON message (reply_to_message_id)
    WHERE is_active_attempt = 1`,

  // image_asset — one physical file, may be linked by many messages.
  `CREATE TABLE IF NOT EXISTS image_asset (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    local_path TEXT NOT NULL UNIQUE,
    available INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_image_asset_conversation
    ON image_asset (conversation_id)`,

  // message_image — link table between messages and image assets.
  `CREATE TABLE IF NOT EXISTS message_image (
    message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    image_asset_id TEXT NOT NULL REFERENCES image_asset(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, image_asset_id)
  )`,

  // visual_evidence — structured vision output, persisted once, reused.
  `CREATE TABLE IF NOT EXISTS visual_evidence (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    source_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    image_asset_id TEXT NOT NULL REFERENCES image_asset(id) ON DELETE CASCADE,
    evidence_version TEXT NOT NULL,
    subject_object TEXT NOT NULL,
    visible_features_json TEXT NOT NULL,
    visible_text_json TEXT NOT NULL,
    visible_condition TEXT NOT NULL,
    uncertainty_json TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_evidence_conversation
    ON visual_evidence (conversation_id)`,
  `CREATE INDEX IF NOT EXISTS ix_evidence_source_message
    ON visual_evidence (source_message_id)`,
  `CREATE INDEX IF NOT EXISTS ix_evidence_image
    ON visual_evidence (image_asset_id)`,

  // chunk — searchable fragment of a message; never an independent original.
  `CREATE TABLE IF NOT EXISTS chunk (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    source_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    image_asset_id TEXT REFERENCES image_asset(id) ON DELETE CASCADE,
    chunk_version TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_chunk_source
    ON chunk (source_message_id, chunk_version, ordinal)`,
  `CREATE INDEX IF NOT EXISTS ix_chunk_conversation
    ON chunk (conversation_id)`,

  // durable_fact — created before embedding (embedding references fact_id).
  `CREATE TABLE IF NOT EXISTS durable_fact (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    normalized_key TEXT NOT NULL,
    value_text TEXT NOT NULL,
    fact_type TEXT NOT NULL CHECK (fact_type IN ('fact','decision')),
    extraction_version TEXT NOT NULL,
    status TEXT NOT NULL,
    supersedes_fact_id TEXT REFERENCES durable_fact(id) ON DELETE SET NULL,
    source_view_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_fact_conversation
    ON durable_fact (conversation_id)`,
  `CREATE INDEX IF NOT EXISTS ix_fact_key
    ON durable_fact (normalized_key)`,
  // One active (ready) fact per normalized key within a conversation.
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_fact_active_key
    ON durable_fact (conversation_id, normalized_key)
    WHERE status = 'ready'`,

  // durable_fact_source — fact ↔ source message links (multi-source).
  `CREATE TABLE IF NOT EXISTS durable_fact_source (
    fact_id TEXT NOT NULL REFERENCES durable_fact(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    PRIMARY KEY (fact_id, message_id)
  )`,

  // embedding — enforceable nullable source FKs; exactly one set.
  `CREATE TABLE IF NOT EXISTS embedding (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES chunk(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
    evidence_id TEXT REFERENCES visual_evidence(id) ON DELETE CASCADE,
    fact_id TEXT REFERENCES durable_fact(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_artifact_hash TEXT NOT NULL,
    embedding_version TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    source_revision TEXT NOT NULL,
    vector BLOB NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (
      (chunk_id IS NOT NULL)
      + (message_id IS NOT NULL)
      + (evidence_id IS NOT NULL)
      + (fact_id IS NOT NULL) = 1
    )
  )`,
  `CREATE INDEX IF NOT EXISTS ix_embedding_scope
    ON embedding (conversation_id, embedding_version, model_artifact_hash, state)`,
  // One compatible ready row per source unit (four partial unique indexes).
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_embedding_chunk
    ON embedding (chunk_id, embedding_version, model_artifact_hash)
    WHERE chunk_id IS NOT NULL AND state = 'ready'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_embedding_message
    ON embedding (message_id, embedding_version, model_artifact_hash)
    WHERE message_id IS NOT NULL AND state = 'ready'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_embedding_evidence
    ON embedding (evidence_id, embedding_version, model_artifact_hash)
    WHERE evidence_id IS NOT NULL AND state = 'ready'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_embedding_fact
    ON embedding (fact_id, embedding_version, model_artifact_hash)
    WHERE fact_id IS NOT NULL AND state = 'ready'`,

  // summary — versioned condensation of one contiguous older range.
  `CREATE TABLE IF NOT EXISTS summary (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    first_source_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    last_source_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    source_view_hash TEXT NOT NULL,
    summarizer_version TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ix_summary_conversation
    ON summary (conversation_id)`,
  `CREATE INDEX IF NOT EXISTS ix_summary_status
    ON summary (conversation_id, status)`,
];

/** Table names in dependency order (children before parents for DROP). */
export const SCHEMA_TABLES: ReadonlyArray<string> = [
  'summary',
  'embedding',
  'durable_fact_source',
  'durable_fact',
  'chunk',
  'visual_evidence',
  'message_image',
  'image_asset',
  'message',
  'conversation',
];

/** Creates every table/index and stamps `user_version`. Idempotent. */
export function initializeSchema(driver: SqliteDriver): void {
  driver.withTransactionSync(() => {
    for (const statement of SCHEMA_STATEMENTS) {
      driver.execSync(statement);
    }
  });
  driver.execSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Reads the persisted schema version (0 when never initialized). */
export function readSchemaVersion(driver: SqliteDriver): number {
  const row = driver.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}
