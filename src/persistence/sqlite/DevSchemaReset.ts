// Development-only destructive reset. This is NOT a production migration path:
// spec 006 is a development-stage SQL cutover (FR-006), so on an incompatible
// schema version a development build may drop and rebuild the store. A
// production build must never silently reset — it throws instead, forcing an
// explicit, deliberate migration decision later.

import type { SqliteDriver } from '../types';

import {
  initializeSchema,
  readSchemaVersion,
  SCHEMA_TABLES,
  SCHEMA_VERSION,
} from './Schema';

export interface DevSchemaResetOptions {
  /** True only in development builds (e.g. from `__DEV__`). */
  readonly isDevelopment: boolean;
}

export class IncompatibleSchemaError extends Error {
  constructor(readonly foundVersion: number, readonly expectedVersion: number) {
    super(
      `SQLite schema version ${foundVersion} is incompatible with expected ${expectedVersion}. ` +
        'A production build will not auto-reset; a migration is required.',
    );
    this.name = 'IncompatibleSchemaError';
  }
}

/** Drops every known table (children first) so the schema can be rebuilt cleanly. */
export function dropAllTables(driver: SqliteDriver): void {
  driver.withTransactionSync(() => {
    for (const table of SCHEMA_TABLES) {
      driver.execSync(`DROP TABLE IF EXISTS ${table}`);
    }
  });
}

/**
 * Ensures the store is at the current schema version.
 * - Fresh DB (version 0): initialize.
 * - Matching version: no-op.
 * - Mismatched version in development: drop + reinitialize.
 * - Mismatched version in production: throw `IncompatibleSchemaError`.
 */
export function ensureSchemaOrReset(
  driver: SqliteDriver,
  options: DevSchemaResetOptions,
): void {
  const version = readSchemaVersion(driver);
  if (version === SCHEMA_VERSION) {
    return;
  }
  if (version === 0) {
    initializeSchema(driver);
    return;
  }
  if (!options.isDevelopment) {
    throw new IncompatibleSchemaError(version, SCHEMA_VERSION);
  }
  dropAllTables(driver);
  initializeSchema(driver);
}
