// UI-facing database bootstrap state. Drives the splash → recovery → ready gate in
// AppNavigator. Wraps the pure bootstrap logic (DatabaseBootstrap.ts) with the real
// SQLite wiring and exposes retry + explicit (confirmed) reset actions.

import { create } from 'zustand';

import {
  runDatabaseBootstrap,
  type DatabaseBootstrapDeps,
  type DatabaseBootstrapFailure,
  type DatabaseBootstrapStatus,
} from '../persistence/DatabaseBootstrap';
import {
  clearReadyDatabase,
  openDatabaseConnection,
  setReadyDatabase,
} from '../persistence/sqlite/Database';
import { resetDatabase } from '../persistence/sqlite/DevSchemaReset';
import { runMigrations } from '../persistence/sqlite/Migrations';
import { readSchemaVersion } from '../persistence/sqlite/Schema';

const realDeps: DatabaseBootstrapDeps = {
  openConnection: () => openDatabaseConnection(),
  migrate: (driver) => runMigrations(driver),
  readVersion: (driver) => readSchemaVersion(driver),
  onReady: (driver) => setReadyDatabase(driver),
};

interface DatabaseBootstrapStoreState {
  readonly status: DatabaseBootstrapStatus;
  readonly failure: DatabaseBootstrapFailure | null;
  /** Runs (or re-runs) the async open + migrate sequence. */
  bootstrap(): Promise<void>;
  /** Retry after a failure — identical to bootstrap. */
  retry(): Promise<void>;
  /** EXPLICIT, confirmed reset: drops all data and rebuilds a clean latest store. */
  resetLocalData(): Promise<void>;
}

let deps = realDeps;

/** Test seam: swap the SQLite wiring for an in-memory driver. */
export function configureDatabaseBootstrapDeps(next: DatabaseBootstrapDeps): void {
  deps = next;
}

async function doBootstrap(set: (patch: Partial<DatabaseBootstrapStoreState>) => void): Promise<void> {
  set({ status: 'initializing', failure: null });
  const outcome = await runDatabaseBootstrap(deps);
  if (outcome.status === 'ready') {
    set({ status: 'ready', failure: null });
  } else {
    set({ status: 'failed', failure: outcome.failure });
  }
}

export const useDatabaseBootstrapStore = create<DatabaseBootstrapStoreState>((set) => ({
  status: 'initializing',
  failure: null,
  bootstrap: () => doBootstrap(set),
  retry: () => doBootstrap(set),
  resetLocalData: async (): Promise<void> => {
    set({ status: 'initializing', failure: null });
    try {
      clearReadyDatabase();
      const driver = deps.openConnection();
      resetDatabase(driver);
      deps.onReady(driver);
      set({ status: 'ready', failure: null });
    } catch {
      // Even a reset can fail (unwritable store); stay recoverable rather than crash.
      await doBootstrap(set);
    }
  },
}));
