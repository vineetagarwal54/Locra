// The ONE file permitted to import `expo-sqlite` (Constitution VIII / X). Every
// other persistence module depends on the `SqliteDriver` interface, never on the
// native module. Opens the canonical store with foreign keys + WAL enabled and
// brings the schema to the current version (dev-reset on incompatible versions).

import {
  openDatabaseSync,
  type SQLiteBindParams,
  type SQLiteDatabase,
} from 'expo-sqlite';

import type { SqlParams, SqliteDriver, SqlRunResult } from '../types';

import { ensureSchemaOrReset } from './DevSchemaReset';
import { applyAdditiveSchema } from './Schema';

export const LOCRA_DATABASE_NAME = 'locra.db';

export interface OpenDatabaseOptions {
  /** Overrides the on-disk database name (tests may use a throwaway name). */
  readonly databaseName?: string;
  /** True in development builds; enables destructive schema reset (FR-006). */
  readonly isDevelopment?: boolean;
}

/** Adapts an `expo-sqlite` handle to the driver-agnostic `SqliteDriver`. */
export function createSqliteDriver(db: SQLiteDatabase): SqliteDriver {
  return {
    execSync(sql: string): void {
      db.execSync(sql);
    },
    runSync(sql: string, params: SqlParams = []): SqlRunResult {
      const result = db.runSync(sql, params as SQLiteBindParams);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    getAllSync<T>(sql: string, params: SqlParams = []): T[] {
      return db.getAllSync<T>(sql, params as SQLiteBindParams);
    },
    getFirstSync<T>(sql: string, params: SqlParams = []): T | null {
      return db.getFirstSync<T>(sql, params as SQLiteBindParams);
    },
    withTransactionSync(fn: () => void): void {
      db.withTransactionSync(fn);
    },
    closeSync(): void {
      db.closeSync();
    },
  };
}

function resolveIsDevelopment(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  return (globalThis as { __DEV__?: boolean }).__DEV__ ?? false;
}

/**
 * Opens (or creates) the canonical Locra SQLite store, enables foreign keys and
 * WAL, ensures the schema is current, and returns a driver. PRAGMAs are applied
 * before any schema work so cascade deletes are enforced from the first write.
 */
export function openLocraDatabase(options: OpenDatabaseOptions = {}): SqliteDriver {
  const db = openDatabaseSync(options.databaseName ?? LOCRA_DATABASE_NAME);
  const driver = createSqliteDriver(db);
  driver.execSync('PRAGMA foreign_keys = ON');
  driver.execSync('PRAGMA journal_mode = WAL');
  ensureSchemaOrReset(driver, {
    isDevelopment: resolveIsDevelopment(options.isDevelopment),
  });
  // Additive tables (e.g. benchmark_run) are created idempotently on every open so
  // an existing store gains them without a destructive schema-version reset.
  applyAdditiveSchema(driver);
  return driver;
}

let sharedDriver: SqliteDriver | null = null;

/** Lazily opens and returns the process-wide database driver. */
export function getDatabase(): SqliteDriver {
  if (sharedDriver === null) {
    sharedDriver = openLocraDatabase();
  }
  return sharedDriver;
}
