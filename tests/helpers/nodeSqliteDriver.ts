// Test-only adapter: drives the repositories against a real, synchronous SQLite
// engine (Node's built-in `node:sqlite`) so persistence tests validate genuine
// SQL — keyset pagination, CHECK constraints, and ON DELETE CASCADE — without
// the native `expo-sqlite` module (which does not load under the Jest runtime).

import { DatabaseSync } from 'node:sqlite';

import { initializeSchema } from '../../src/persistence/sqlite/Schema';
import type { SqlParams, SqliteDriver } from '../../src/persistence/types';

export interface TestDatabase {
  readonly driver: SqliteDriver;
  close(): void;
}

// Structurally matches node:sqlite's SQLInputValue (SqlValue is a subset).
type SqliteInput = null | number | bigint | string | Uint8Array;

function toParams(params: SqlParams): SqliteInput[] {
  return [...params];
}

/** Opens an in-memory SQLite database with foreign keys on and the schema applied. */
export function createTestDatabase(): TestDatabase {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  const driver: SqliteDriver = {
    execSync(sql: string): void {
      db.exec(sql);
    },
    runSync(sql: string, params: SqlParams = []) {
      const result = db.prepare(sql).run(...toParams(params));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    getAllSync<T>(sql: string, params: SqlParams = []): T[] {
      return db.prepare(sql).all(...toParams(params)) as T[];
    },
    getFirstSync<T>(sql: string, params: SqlParams = []): T | null {
      return (db.prepare(sql).get(...toParams(params)) as T | undefined) ?? null;
    },
    withTransactionSync(fn: () => void): void {
      db.exec('BEGIN');
      try {
        fn();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    closeSync(): void {
      db.close();
    },
  };

  initializeSchema(driver);
  return { driver, close: () => db.close() };
}
