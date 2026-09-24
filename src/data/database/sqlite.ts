import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseAdapter, QueryParams } from "./adapter";
import type Database from "better-sqlite3";

/**
 * better-sqlite3 exposes one synchronous connection. RADAR's adapter is async,
 * so an awaited transaction callback must retain exclusive ownership of that
 * connection until COMMIT/ROLLBACK. Otherwise unrelated promises can execute
 * inside the open transaction, and a second transaction can attempt a nested
 * BEGIN on the same connection.
 */
export class SqliteAdapter implements DatabaseAdapter {
  private transactionTail: Promise<void> = Promise.resolve();
  private activeTransactionCompletion: Promise<void> | null = null;
  private readonly transactionContext = new AsyncLocalStorage<symbol>();
  private activeTransactionOwner: symbol | null = null;

  constructor(private db: Database.Database) {
    // In-memory safety assurance: alert if instantiated with non-memory file in non-test mode.
    // Persistent SQLite is only selected by the explicit candidate runtime gate
    // in src/data/database/index.ts; direct construction remains conspicuous.
    if (!db.memory && db.name !== ":memory:" && db.name !== "" && process.env.RADAR_ENV !== "test") {
      console.warn(`[SqliteAdapter] Warning: SqliteAdapter instantiated with persistent file: ${db.name}`);
    }
  }

  /**
   * A better-sqlite3 operation is synchronous, so normal operations cannot
   * interleave with one another. They only need a barrier while an awaited
   * transaction owns the connection. Do not serialize all normal reads: that
   * would turn an otherwise local serving path into a needless promise queue.
   */
  private async runOperation<T>(fn: () => T | Promise<T>): Promise<T> {
    const owner = this.transactionContext.getStore();
    if (owner && owner === this.activeTransactionOwner) {
      return await fn();
    }

    // A new transaction can start while a prior one releases its barrier, so
    // re-check after every await before touching the connection.
    while (this.activeTransactionCompletion) {
      await this.activeTransactionCompletion;
    }
    return await fn();
  }

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    return this.runOperation(() => {
      const row = this.db.prepare(sql).get(...(params as any[]));
      return (row as T) || null;
    });
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    return this.runOperation(() => {
      const rows = this.db.prepare(sql).all(...(params as any[]));
      return (rows as T[]) || [];
    });
  }

  async execute(sql: string, params: QueryParams = []): Promise<{ rowsAffected: number; lastInsertRowid?: any }> {
    return this.runOperation(() => {
      const info = this.db.prepare(sql).run(...(params as any[]));
      return {
        rowsAffected: info.changes,
        lastInsertRowid: info.lastInsertRowid,
      };
    });
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const owner = this.transactionContext.getStore();
    if (owner && owner === this.activeTransactionOwner) {
      // Match TursoAdapter's nested-transaction behavior: nested callers share
      // the already-owned transaction rather than issuing another BEGIN.
      return await fn(this);
    }

    const previous = this.transactionTail;
    let releaseTransaction!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve; });
    await previous;

    const transactionOwner = Symbol("sqlite-transaction");
    let releaseActive!: () => void;
    this.activeTransactionCompletion = new Promise<void>((resolve) => { releaseActive = resolve; });
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.activeTransactionOwner = transactionOwner;
      return await this.transactionContext.run(transactionOwner, async () => {
        try {
          const result = await fn(this);
          this.db.exec("COMMIT");
          return result;
        } catch (err) {
          if (this.db.inTransaction) this.db.exec("ROLLBACK");
          throw err;
        }
      });
    } finally {
      this.activeTransactionOwner = null;
      this.activeTransactionCompletion = null;
      releaseActive();
      releaseTransaction();
    }
  }

  async executeMigration(statements: readonly string[], options?: { disableForeignKeys?: boolean }): Promise<void> {
    await this.transaction(async () => {
      const disableFk = options?.disableForeignKeys ?? false;
      if (disableFk) {
        this.db.pragma("foreign_keys = OFF");
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const stmt of statements) {
          this.db.prepare(stmt).run();
        }
        this.db.exec("COMMIT");
      } catch (err) {
        if (this.db.inTransaction) {
          this.db.exec("ROLLBACK");
        }
        throw err;
      } finally {
        if (disableFk) {
          this.db.pragma("foreign_keys = ON");
          const violations = this.db.pragma("foreign_key_check") as any[];
          if (violations && violations.length > 0) {
            throw new Error(`Foreign key constraint check failed after migration: ${JSON.stringify(violations)}`);
          }
        }
      }
    });
  }
}
