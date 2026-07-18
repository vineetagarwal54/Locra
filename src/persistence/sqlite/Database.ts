// The ONE file permitted to import `expo-sqlite` (Constitution VIII / X). Every
// other persistence module depends on the `SqliteDriver` interface, never on the
// native module. Opens the canonical store with foreign keys + WAL enabled and
// brings the schema to the latest version via ordered, transactional migrations
// (Migrations.ts) — it NEVER resets in production.
//
// Repositories reach the driver through `getDatabase()`, which only returns once
// the async bootstrap (DatabaseBootstrap.ts) has migrated the store and marked it
// ready. Before that it throws, so nothing can touch conversation data before the
// database is proven usable.

import {
  openDatabaseSync,
  type SQLiteBindParams,
  type SQLiteDatabase,
} from 'expo-sqlite';

import type { SqlParams, SqliteDriver, SqlRunResult } from '../types';

import { runMigrations } from './Migrations';

export const LOCRA_DATABASE_NAME = 'locra.db';

export interface OpenDatabaseOptions {
  /** Overrides the on-disk database name (tests may use a throwaway name). */
  readonly databaseName?: string;
}

/** Thrown when a repository asks for the database before bootstrap reaches ready. */
export class DatabaseNotReadyError extends Error {
  constructor() {
    super('The database is not ready. Bootstrap must complete before repositories are used.');
    this.name = 'DatabaseNotReadyError';
  }
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

/**
 * Opens (or creates) the canonical store with foreign keys + WAL enabled, but does
 * NOT migrate. PRAGMAs are applied before any schema work so cascade deletes are
 * enforced from the first write. The bootstrap opens the connection, then migrates
 * separately so it can inspect the version and surface a recoverable failure.
 */
export function openDatabaseConnection(options: OpenDatabaseOptions = {}): SqliteDriver {
  const db = openDatabaseSync(options.databaseName ?? LOCRA_DATABASE_NAME);
  const driver = createSqliteDriver(db);
  driver.execSync('PRAGMA foreign_keys = ON');
  driver.execSync('PRAGMA journal_mode = WAL');
  return driver;
}

/** Opens the store and migrates it to the latest schema version (throws on failure). */
export function openLocraDatabase(options: OpenDatabaseOptions = {}): SqliteDriver {
  const driver = openDatabaseConnection(options);
  runMigrations(driver);
  return driver;
}

let readyDriver: SqliteDriver | null = null;

/** Registers the migrated driver once the bootstrap has proven the store usable. */
export function setReadyDatabase(driver: SqliteDriver): void {
  readyDriver = driver;
}

/** Clears the ready driver (bootstrap reset / test teardown). */
export function clearReadyDatabase(): void {
  readyDriver = null;
}

/**
 * Returns the process-wide database driver. Throws {@link DatabaseNotReadyError}
 * until the async bootstrap has completed successfully, so repositories cannot be
 * used before the database is ready.
 */
export function getDatabase(): SqliteDriver {
  if (readyDriver === null) {
    throw new DatabaseNotReadyError();
  }
  return readyDriver;
}
