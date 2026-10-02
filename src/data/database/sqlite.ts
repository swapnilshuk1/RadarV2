import { serializeLocal } from "./local-serialization";
import type { DatabaseAdapter, QueryParams } from "./adapter";
import type Database from "better-sqlite3";

export class SqliteAdapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {
    // In-memory safety assurance: alert if instantiated with non-memory file in non-test mode
    if (
      !db.memory &&
      db.name !== ":memory:" &&
      db.name !== "" &&
      process.env.RADAR_ENV !== "test"
    ) {
      console.warn(
        `[SqliteAdapter] Warning: SqliteAdapter instantiated with persistent file: ${db.name}`,
      );
    }
  }

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    return serializeLocal(this.db, () => this.oneRaw<T>(sql, params));
  }
  private async oneRaw<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...(params as any[]));
    return (row as T) || null;
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    return serializeLocal(this.db, () => this.manyRaw<T>(sql, params));
  }
  private async manyRaw<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    const rows = this.db.prepare(sql).all(...(params as any[]));
    return (rows as T[]) || [];
  }

  async execute(
    sql: string,
    params: QueryParams = [],
  ): Promise<{ rowsAffected: number; lastInsertRowid?: number | bigint }> {
    return serializeLocal(this.db, () => this.executeRaw(sql, params));
  }
  private async executeRaw(
    sql: string,
    params: QueryParams = [],
  ): Promise<{ rowsAffected: number; lastInsertRowid?: any }> {
    const info = this.db.prepare(sql).run(...(params as any[]));
    return {
      rowsAffected: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return serializeLocal(this.db, async () => {
      this.db.exec("BEGIN");
      const tx: DatabaseAdapter = {
        one: this.oneRaw.bind(this),
        many: this.manyRaw.bind(this),
        execute: this.executeRaw.bind(this),
        transaction: async (sub) => sub(tx),
      };
      try {
        const result = await fn(tx);
        this.db.exec("COMMIT");
        return result;
      } catch (err) {
        if (this.db.inTransaction) {
          this.db.exec("ROLLBACK");
        }
        throw err;
      }
    });
  }

  async executeMigration(
    statements: readonly string[],
    options?: { disableForeignKeys?: boolean },
  ): Promise<void> {
    return serializeLocal(this.db, async () => {
      const disableFk = options?.disableForeignKeys ?? false;
      if (disableFk) {
        this.db.pragma("foreign_keys = OFF");
      }
      this.db.exec("BEGIN");
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
            throw new Error(
              `Foreign key constraint check failed after migration: ${JSON.stringify(violations)}`,
            );
          }
        }
      }
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
