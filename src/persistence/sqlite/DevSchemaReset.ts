// Explicit, deliberate database reset — kept SEPARATE from the normal migration
// path (Migrations.ts). Normal startup NEVER resets: it migrates forward and
// preserves conversations. A reset is only reached by:
//   - a development build choosing to rebuild a mismatched dev store, or
//   - the user explicitly confirming "Reset local data" on the recovery screen.
// Both paths drop every table and rebuild a clean latest-schema store; neither is
// silent.

import type { SqliteDriver } from '../types';

import { initializeSchema } from './Migrations';
import { SCHEMA_TABLES } from './Schema';

/** Drops every known table (children first) so the schema can be rebuilt cleanly. */
export function dropAllTables(driver: SqliteDriver): void {
  driver.withTransactionSync(() => {
    for (const table of SCHEMA_TABLES) {
      driver.execSync(`DROP TABLE IF EXISTS ${table}`);
    }
  });
}

/**
 * Destroys ALL local conversation data and rebuilds an empty store at the latest
 * schema version. Only ever call this from an explicit, confirmed reset path — the
 * dev rebuild or the recovery screen's "Reset local data" action.
 */
export function resetDatabase(driver: SqliteDriver): void {
  dropAllTables(driver);
  driver.execSync('PRAGMA user_version = 0');
  initializeSchema(driver);
}
