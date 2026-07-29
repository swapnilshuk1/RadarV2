import type { DatabaseAdapter, QueryParams } from "./adapter";
import type Database from "better-sqlite3";

export class SqliteAdapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}

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
    // Sqlite sync transaction wrapper
    let result: T;
    const tx = this.db.transaction(() => {
      // Execute the async function synchronously using un-promised queries inside sqlite transaction
      // Note: for better-sqlite3, queries run immediately on connection
    });
    
    // For SqliteAdapter, run inner fn passing this adapter
    result = await fn(this);
    return result;
  }
}
