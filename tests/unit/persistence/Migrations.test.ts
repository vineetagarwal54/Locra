import { runDatabaseBootstrap } from '../../../src/persistence/DatabaseBootstrap';
import { DatabaseNotReadyError, clearReadyDatabase, getDatabase, setReadyDatabase } from '../../../src/persistence/sqlite/Database';
import { MIGRATIONS, runMigrations, UnsupportedFutureSchemaError } from '../../../src/persistence/sqlite/Migrations';
import { readSchemaVersion, SCHEMA_VERSION } from '../../../src/persistence/sqlite/Schema';
import type { SqliteDriver } from '../../../src/persistence/types';
import { createTestDatabase } from '../../helpers/nodeSqliteDriver';

describe('production SQLite migrations', () => {
  afterEach(() => clearReadyDatabase());

  it('creates the latest schema for a fresh database in migration order', () => {
    const database = createTestDatabase({ initialize: false });
    try {
      expect(runMigrations(database.driver).applied).toEqual(MIGRATIONS.map((migration) => migration.version));
      expect(readSchemaVersion(database.driver)).toBe(SCHEMA_VERSION);
      expect(database.driver.getFirstSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation'")).not.toBeNull();
    } finally { database.close(); }
  });

  it('upgrades an older schema through every missing version in order', () => {
    const database = createTestDatabase({ initialize: false });
    try {
      const v1 = MIGRATIONS[0];
      database.driver.withTransactionSync(() => {
        v1.up(database.driver);
        database.driver.execSync('PRAGMA user_version = 1');
      });
      expect(runMigrations(database.driver).applied).toEqual([2, 3]);
      expect(readSchemaVersion(database.driver)).toBe(3);
    } finally { database.close(); }
  });

  it('rolls back a failed migration and does not advance its version', () => {
    const database = createTestDatabase({ initialize: false });
    const driver: SqliteDriver = {
      ...database.driver,
      execSync(sql: string): void {
        if (sql.includes('CREATE TABLE IF NOT EXISTS benchmark_run')) throw new Error('transient DDL failure');
        database.driver.execSync(sql);
      },
    };
    try {
      expect(() => runMigrations(driver)).toThrow('Migration to schema version 2 failed');
      expect(readSchemaVersion(database.driver)).toBe(1);
      expect(database.driver.getFirstSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='benchmark_run'")).toBeNull();
    } finally { database.close(); }
  });

  it('retries successfully after a transient migration failure', async () => {
    const database = createTestDatabase({ initialize: false });
    let fail = true;
    const driver: SqliteDriver = { ...database.driver, execSync(sql: string): void { if (fail && sql.includes('benchmark_run')) throw new Error('temporary'); database.driver.execSync(sql); } };
    try {
      const first = await runDatabaseBootstrap({ openConnection: () => driver, migrate: runMigrations, readVersion: readSchemaVersion, onReady: setReadyDatabase });
      expect(first.status).toBe('failed');
      fail = false;
      const second = await runDatabaseBootstrap({ openConnection: () => database.driver, migrate: runMigrations, readVersion: readSchemaVersion, onReady: setReadyDatabase });
      expect(second.status).toBe('ready');
      expect(readSchemaVersion(database.driver)).toBe(SCHEMA_VERSION);
    } finally { database.close(); }
  });

  it('rejects a future schema without resetting it', async () => {
    const database = createTestDatabase();
    try {
      database.driver.execSync('PRAGMA user_version = 99');
      expect(() => runMigrations(database.driver)).toThrow(UnsupportedFutureSchemaError);
      const outcome = await runDatabaseBootstrap({ openConnection: () => database.driver, migrate: runMigrations, readVersion: readSchemaVersion, onReady: setReadyDatabase });
      expect(outcome.failure?.reason).toBe('unsupported-future-schema');
      expect(readSchemaVersion(database.driver)).toBe(99);
    } finally { database.close(); }
  });

  it('keeps repositories unavailable until bootstrap marks the database ready', () => {
    expect(() => getDatabase()).toThrow(DatabaseNotReadyError);
  });
});
