// Shared persistence types used by every repository and by the SQLite boundary.
// This file is deliberately free of any `expo-sqlite` import so it can be used
// from tests and non-persistence modules without pulling in the native module
// (Constitution VIII / X — only src/persistence/sqlite/Database.ts imports expo-sqlite).

/** A value that can be bound to a SQL statement parameter. */
export type SqlValue = string | number | null | Uint8Array;

/** Positional parameters for a prepared statement. */
export type SqlParams = ReadonlyArray<SqlValue>;

export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertRowId: number;
}

/**
 * Minimal synchronous SQLite surface the persistence layer depends on. The real
 * implementation adapts `expo-sqlite`'s `SQLiteDatabase`; tests may supply an
 * in-memory fake. Repositories depend on this interface, never on expo-sqlite.
 */
export interface SqliteDriver {
  execSync(sql: string): void;
  runSync(sql: string, params?: SqlParams): SqlRunResult;
  getAllSync<T>(sql: string, params?: SqlParams): T[];
  getFirstSync<T>(sql: string, params?: SqlParams): T | null;
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  withTransactionSync(fn: () => void): void;
  closeSync(): void;
}

/** Stable keyset cursor: order by (timestamp DESC, id DESC) then page after this point. */
export interface Keyset {
  readonly ts: number;
  readonly id: string;
}

/** A bounded page of rows plus the cursor for the next page (null when exhausted). */
export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: Keyset | null;
}

/** Hard ceiling on any interactive page (FR-004). */
export const MAX_PAGE_SIZE = 50;
