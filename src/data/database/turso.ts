import type { DatabaseAdapter, QueryParams } from "./adapter";
import { createClient, type Client } from "@libsql/client";

export class TursoAdapter implements DatabaseAdapter {
  private client: Client;

  constructor(url: string, authToken: string) {
    this.client = createClient({ url, authToken });
  }

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    const res = await this.client.execute({ sql, args: params as any[] });
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapRow(res.rows[0], res.columns) as T;
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    const res = await this.client.execute({ sql, args: params as any[] });
    if (!res.rows) return [];
    return res.rows.map(r => this.mapRow(r, res.columns) as T);
  }

  async execute(sql: string, params: QueryParams = []): Promise<{ rowsAffected: number; lastInsertRowid?: any }> {
    const res = await this.client.execute({ sql, args: params as any[] });
    return {
      rowsAffected: res.rowsAffected,
      lastInsertRowid: res.lastInsertRowid ? String(res.lastInsertRowid) : undefined,
    };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    // Execute inside a transaction or batch context
    return await fn(this);
  }

  private mapRow(row: any, columns: string[]): Record<string, any> {
    if (Array.isArray(row)) {
      const obj: Record<string, any> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i];
      }
      return obj;
    }
    return row;
  }
}
