// Transaction helper. Runs work atomically and rolls back on any throw so an
// interrupted write never leaves partial/orphaned data (data-model invariants).

import type { SqliteDriver } from '../types';

/**
 * Runs `work` inside a single transaction and returns its result. If `work`
 * throws, the underlying driver rolls the transaction back and the error
 * propagates unchanged.
 */
export function runInTransaction<T>(driver: SqliteDriver, work: () => T): T {
  let result!: T;
  driver.withTransactionSync(() => {
    result = work();
  });
  return result;
}
