// T008 — schema-contract suite. `expo-sqlite` is a native module and does not
// load under the Jest node runtime, so this asserts the DDL *contract* (required
// tables, indexes, foreign keys, CHECK constraints, partial unique indexes).
// Real-SQLite deletion/orphan behavior is validated once on-device (Polish/T079).

import {
  initializeSchema,
} from '../../../src/persistence/sqlite/Migrations';
import {
  addColumnIfMissing,
  readSchemaVersion,
  SCHEMA_STATEMENTS,
  SCHEMA_TABLES,
  SCHEMA_VERSION,
} from '../../../src/persistence/sqlite/Schema';
import type { SqliteDriver } from '../../../src/persistence/types';
import { createTestDatabase } from '../../helpers/nodeSqliteDriver';

const DDL = SCHEMA_STATEMENTS.join('\n');

function columnNames(driver: SqliteDriver): string[] {
  return driver
    .getAllSync<{ name: string }>('PRAGMA table_info(message)')
    .map((column) => column.name);
}

const REQUIRED_TABLES = [
  'conversation',
  'message',
  'image_asset',
  'message_image',
  'visual_evidence',
  'chunk',
  'durable_fact',
  'durable_fact_source',
  'embedding',
  'summary',
  'benchmark_run',
] as const;

describe('SQL schema contract', () => {
  it('defines a positive integer schema version', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('creates every required table', () => {
    for (const table of REQUIRED_TABLES) {
      expect(DDL).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
  });

  it('lists all tables in SCHEMA_TABLES for ordered teardown', () => {
    for (const table of REQUIRED_TABLES) {
      expect(SCHEMA_TABLES).toContain(table);
    }
    // children precede parents so DROP order respects FKs
    expect(SCHEMA_TABLES.indexOf('message')).toBeLessThan(
      SCHEMA_TABLES.indexOf('conversation'),
    );
    expect(SCHEMA_TABLES.indexOf('embedding')).toBeLessThan(
      SCHEMA_TABLES.indexOf('chunk'),
    );
  });

  it('cascades every conversation child on delete', () => {
    // Eight tables reference conversation(id) directly: message, image_asset,
    // visual_evidence, chunk, durable_fact, embedding, summary, benchmark_run.
    const directRefs = DDL.match(/REFERENCES conversation\(id\) ON DELETE CASCADE/g) ?? [];
    expect(directRefs.length).toBe(8);
    // The two link tables cascade transitively via their parents.
    expect(DDL).toMatch(/message_image[\s\S]*REFERENCES message\(id\) ON DELETE CASCADE/);
    expect(DDL).toMatch(/durable_fact_source[\s\S]*REFERENCES durable_fact\(id\) ON DELETE CASCADE/);
  });

  it('enforces role/attempt integrity and lowercase response mode via CHECK', () => {
    expect(DDL).toMatch(/response_mode IN \('low','medium','high'\)/);
    expect(DDL).toMatch(/role = 'user'[\s\S]*status = 'submitted'/);
    expect(DDL).toMatch(/role = 'assistant'[\s\S]*attempt_number IS NOT NULL/);
  });

  it('enforces exactly-one embedding source via CHECK', () => {
    expect(DDL).toMatch(/\(chunk_id IS NOT NULL\)[\s\S]*\(fact_id IS NOT NULL\) = 1/);
  });

  it('defines the keyset pagination indexes', () => {
    expect(DDL).toMatch(/ON conversation \(updated_at DESC, id DESC\)/);
    expect(DDL).toMatch(/ON message \(conversation_id, created_at DESC, id DESC\)/);
    expect(DDL).toMatch(/ON embedding \(conversation_id, embedding_version, model_artifact_hash, state\)/);
  });

  it('defines partial unique indexes for active attempt, ready facts, and ready embeddings', () => {
    expect(DDL).toMatch(/ux_message_active_attempt[\s\S]*WHERE is_active_attempt = 1/);
    expect(DDL).toMatch(/ux_fact_active_key[\s\S]*WHERE status = 'ready'/);
    expect(DDL).toMatch(/ux_embedding_chunk[\s\S]*WHERE chunk_id IS NOT NULL AND state = 'ready'/);
  });

  it('initializeSchema runs ordered migrations transactionally and stamps the latest user_version', () => {
    const executed: string[] = [];
    let inTransaction = false;
    let stampedVersion = 0;

    const driver: SqliteDriver = {
      execSync: (sql) => {
        const match = /PRAGMA user_version = (\d+)/.exec(sql);
        if (match) {
          stampedVersion = Number(match[1]);
          return;
        }
        executed.push(sql);
      },
      runSync: () => ({ changes: 0, lastInsertRowId: 0 }),
      getAllSync: () => [],
      getFirstSync: () => null,
      withTransactionSync: (fn) => {
        inTransaction = true;
        fn();
        inTransaction = false;
      },
      closeSync: () => undefined,
    };

    initializeSchema(driver);

    // v3 backfills `finish_reason` with ALTER TABLE after the v1/v2 DDL.
    expect(executed.length).toBe(SCHEMA_STATEMENTS.length + 1);
    expect(stampedVersion).toBe(SCHEMA_VERSION);
    expect(inTransaction).toBe(false);
  });

  it('declares the assistant finish_reason column on the message table', () => {
    expect(DDL).toMatch(/CREATE TABLE IF NOT EXISTS message[\s\S]*finish_reason TEXT/);
  });

  it('additively backfills finish_reason onto an existing message table without it', () => {
    const database = createTestDatabase();
    try {
      // Simulate a pre-existing store whose message table predates finish_reason
      // by replacing the freshly-initialized table with the older shape.
      database.driver.execSync('DROP TABLE message');
      database.driver.execSync(
        `CREATE TABLE message (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
          reply_to_message_id TEXT, attempt_number INTEGER, is_active_attempt INTEGER NOT NULL DEFAULT 0,
          text TEXT NOT NULL, status TEXT NOT NULL, error_message TEXT, finalized_at INTEGER,
          created_at INTEGER NOT NULL
        )`,
      );
      expect(columnNames(database.driver)).not.toContain('finish_reason');

      addColumnIfMissing(database.driver, 'message', 'finish_reason', 'TEXT');
      expect(columnNames(database.driver)).toContain('finish_reason');

      // Idempotent: a second pass must not throw (column already present).
      expect(() => addColumnIfMissing(database.driver, 'message', 'finish_reason', 'TEXT')).not.toThrow();
    } finally {
      database.close();
    }
  });

  it('readSchemaVersion returns 0 for a never-initialized database', () => {
    const driver: SqliteDriver = {
      execSync: () => undefined,
      runSync: () => ({ changes: 0, lastInsertRowId: 0 }),
      getAllSync: () => [],
      getFirstSync: <T>() => ({ user_version: 0 } as unknown as T),
      withTransactionSync: (fn) => fn(),
      closeSync: () => undefined,
    };
    expect(readSchemaVersion(driver)).toBe(0);
  });
});
