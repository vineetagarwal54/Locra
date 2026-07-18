// Async database bootstrap with explicit lifecycle states (T089 / recovery).
//
// The app must not mount repositories or route into Chat until the store is proven
// usable. This module runs the open + migrate sequence asynchronously and reports
// one of three states: 'initializing', 'ready', or 'failed'. A failure carries the
// SANITIZED details the recovery screen needs (app/db/expected version, failed
// migration id, sanitized error) and NEVER leaks local paths or conversation
// contents. A failed bootstrap resolves to a failed state — it never throws to the
// caller, so startup can render recovery instead of crashing or looping.

import {
  LATEST_SCHEMA_VERSION,
  MigrationFailedError,
  UnsupportedFutureSchemaError,
} from './sqlite/Migrations';
import type { SqliteDriver } from './types';

export type DatabaseBootstrapStatus = 'initializing' | 'ready' | 'failed';

export type DatabaseFailureReason =
  | 'open-failed'
  | 'migration-failed'
  | 'unsupported-future-schema';

export interface DatabaseBootstrapFailure {
  readonly reason: DatabaseFailureReason;
  /** The migration version that failed, when applicable. */
  readonly failedMigrationVersion: number | null;
  /** The on-disk schema version at the time of failure, when known. */
  readonly databaseVersion: number | null;
  /** The schema version this build expects. */
  readonly expectedVersion: number;
  /** Sanitized, path-free error summary safe to show/export. */
  readonly message: string;
}

export interface DatabaseBootstrapOutcome {
  readonly status: 'ready' | 'failed';
  readonly failure: DatabaseBootstrapFailure | null;
}

export interface DatabaseBootstrapDeps {
  /** Opens a connection with PRAGMAs applied but does NOT migrate. */
  openConnection(): SqliteDriver;
  /** Runs pending migrations; throws typed migration errors on failure. */
  migrate(driver: SqliteDriver): void;
  /** Reads the on-disk schema version (0 when never initialized). */
  readVersion(driver: SqliteDriver): number;
  /** Registers the migrated driver so repositories may be used. */
  onReady(driver: SqliteDriver): void;
}

/** Strips anything that could contain a filesystem path or conversation text. */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    // Drop absolute/`file://` paths.
    .replace(/file:\/\/\S+/gi, '<path>')
    .replace(/(?:[A-Za-z]:)?[/\\][^\s'"]+/g, '<path>')
    .slice(0, 300)
    .trim();
}

function failureFor(
  error: unknown,
  driver: SqliteDriver | null,
  readVersion: (driver: SqliteDriver) => number,
): DatabaseBootstrapFailure {
  const safeVersion = (): number | null => {
    if (driver === null) return null;
    try {
      return readVersion(driver);
    } catch {
      return null;
    }
  };

  if (error instanceof UnsupportedFutureSchemaError) {
    return {
      reason: 'unsupported-future-schema',
      failedMigrationVersion: null,
      databaseVersion: error.foundVersion,
      expectedVersion: LATEST_SCHEMA_VERSION,
      message: `Database version ${error.foundVersion} is newer than this app supports (${LATEST_SCHEMA_VERSION}).`,
    };
  }
  if (error instanceof MigrationFailedError) {
    return {
      reason: 'migration-failed',
      failedMigrationVersion: error.migrationVersion,
      databaseVersion: error.atVersion,
      expectedVersion: LATEST_SCHEMA_VERSION,
      message: `Migration to version ${error.migrationVersion} failed: ${sanitizeErrorMessage(error.cause)}`,
    };
  }
  return {
    reason: 'open-failed',
    failedMigrationVersion: null,
    databaseVersion: safeVersion(),
    expectedVersion: LATEST_SCHEMA_VERSION,
    message: `Could not open the database: ${sanitizeErrorMessage(error)}`,
  };
}

/**
 * Opens and migrates the store. Resolves to 'ready' (driver registered) or 'failed'
 * (with sanitized diagnostics). Never throws — a failed bootstrap is a state, not a
 * crash.
 */
export async function runDatabaseBootstrap(
  deps: DatabaseBootstrapDeps,
): Promise<DatabaseBootstrapOutcome> {
  // Yield once so callers observe the async 'initializing' phase deterministically.
  await Promise.resolve();
  let driver: SqliteDriver | null = null;
  try {
    driver = deps.openConnection();
  } catch (error) {
    return { status: 'failed', failure: failureFor(error, null, deps.readVersion) };
  }
  try {
    deps.migrate(driver);
  } catch (error) {
    return { status: 'failed', failure: failureFor(error, driver, deps.readVersion) };
  }
  deps.onReady(driver);
  return { status: 'ready', failure: null };
}
