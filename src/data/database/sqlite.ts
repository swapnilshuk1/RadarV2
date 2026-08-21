import type { DatabaseAdapter, QueryParams } from "./adapter";
import type Database from "better-sqlite3";

export class SqliteAdapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {
    // In-memory safety assurance: alert if instantiated with non-memory file in non-test mode
    if (!db.memory && db.name !== ":memory:" && db.name !== "" && process.env.RADAR_ENV !== "test") {
      console.warn(`[SqliteAdapter] Warning: SqliteAdapter instantiated with persistent file: ${db.name}`);
    }
  }

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...(params as any[]));
    return (row as T) || null;
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    const rows = this.db.prepare(sql).all(...(params as any[]));
    return (rows as T[]) || [];
  }

  async execute(sql: string, params: QueryParams = []): Promise<{ rowsAffected: number; lastInsertRowid?: any }> {
    const info = this.db.prepare(sql).run(...(params as any[]));
    return {
      rowsAffected: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      if (this.db.inTransaction) {
        this.db.exec("ROLLBACK");
      }
      throw err;
    }
  }
}
