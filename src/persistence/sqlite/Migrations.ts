// T089 — production-safe SQLite migrations.
//
// The store is built and upgraded by an ORDERED list of numbered migrations
// (v1 -> v2 -> v3). Each migration runs inside a transaction; the stored schema
// version (`PRAGMA user_version`) is stamped last inside the migration transaction.
// If a migration throws, its transaction rolls back and the version is
// left unchanged, so the previous usable database is preserved — production data is
// never silently dropped or recreated. Migrations are idempotent where practical
// (`CREATE TABLE IF NOT EXISTS`, `addColumnIfMissing`).
//
// A store whose version is HIGHER than the latest known migration (a downgrade /
// unknown future build) is rejected with UnsupportedFutureSchemaError so the app
// can route to recovery instead of destroying newer data.

import type { SqliteDriver } from '../types';

import {
  addColumnIfMissing,
  BENCHMARK_SCHEMA_STATEMENTS,
  CORE_SCHEMA_STATEMENTS,
  readSchemaVersion,
  SCHEMA_VERSION,
} from './Schema';

export interface Migration {
  /** Target schema version this migration brings the store TO. */
  readonly version: number;
  readonly description: string;
  /** Applies the schema change. Must NOT open its own transaction (the runner does). */
  up(driver: SqliteDriver): void;
}

function runStatements(driver: SqliteDriver, statements: ReadonlyArray<string>): void {
  for (const statement of statements) {
    driver.execSync(statement);
  }
}

/**
 * Ordered migrations. Numbers are contiguous starting at 1 and must only ever be
 * appended (never reordered or renumbered) so existing stores upgrade correctly.
 */
export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    description: 'core schema (conversation, message, images, evidence, chunks, facts, embeddings, summaries)',
    up: (driver) => runStatements(driver, CORE_SCHEMA_STATEMENTS),
  },
  {
    version: 2,
    description: 'benchmark_run table + indexes',
    up: (driver) => runStatements(driver, BENCHMARK_SCHEMA_STATEMENTS),
  },
  {
    version: 3,
    description: 'message.finish_reason column',
    up: (driver) => addColumnIfMissing(driver, 'message', 'finish_reason', 'TEXT'),
  },
];

/** The version a fully-migrated store ends at (highest migration number). */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Guard against SCHEMA_VERSION drifting away from the migration list.
if (LATEST_SCHEMA_VERSION !== SCHEMA_VERSION) {
  throw new Error(
    `SCHEMA_VERSION (${SCHEMA_VERSION}) must equal the latest migration version (${LATEST_SCHEMA_VERSION}).`,
  );
}

/** The store's schema version is newer than this build understands. */
export class UnsupportedFutureSchemaError extends Error {
  constructor(readonly foundVersion: number, readonly latestKnownVersion: number) {
    super(
      `Database schema version ${foundVersion} is newer than this app supports ` +
        `(latest known ${latestKnownVersion}).`,
    );
    this.name = 'UnsupportedFutureSchemaError';
  }
}

/** A specific migration failed; the store was rolled back to `atVersion`. */
export class MigrationFailedError extends Error {
  constructor(
    readonly migrationVersion: number,
    readonly atVersion: number,
    readonly cause: unknown,
  ) {
    super(
      `Migration to schema version ${migrationVersion} failed; ` +
        `the database was rolled back to version ${atVersion}.`,
    );
    this.name = 'MigrationFailedError';
  }
}

export interface MigrationRunResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Versions applied this run, in order. Empty when already current. */
  readonly applied: ReadonlyArray<number>;
}

/**
 * Runs every pending migration in order. Each migration executes in its own
 * transaction; the version is stamped last within that transaction.
 * Throws {@link UnsupportedFutureSchemaError} for a newer-than-known store, and
 * {@link MigrationFailedError} (with the store left at the last good version) if a
 * migration throws.
 */
export function runMigrations(driver: SqliteDriver): MigrationRunResult {
  const fromVersion = readSchemaVersion(driver);
  if (fromVersion > LATEST_SCHEMA_VERSION) {
    throw new UnsupportedFutureSchemaError(fromVersion, LATEST_SCHEMA_VERSION);
  }

  const applied: number[] = [];
  let currentVersion = fromVersion;
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }
    try {
      // The schema and its version are one atomic unit; the stamp is last.
      driver.withTransactionSync(() => {
        migration.up(driver);
        driver.execSync(`PRAGMA user_version = ${migration.version}`);
      });
    } catch (cause) {
      // Version was never advanced, so the previous usable DB is preserved.
      throw new MigrationFailedError(migration.version, currentVersion, cause);
    }
    currentVersion = migration.version;
    applied.push(migration.version);
  }

  return { fromVersion, toVersion: currentVersion, applied };
}

/**
 * Brings a fresh or partially-migrated store to the latest schema version.
 * Idempotent — safe to call on an already-current store.
 */
export function initializeSchema(driver: SqliteDriver): void {
  runMigrations(driver);
}
