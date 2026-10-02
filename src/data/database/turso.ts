import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeLocal } from "./local-serialization";
import type { DatabaseAdapter, QueryParams } from "./adapter";
import { createClient, type Client } from "@libsql/client";

export class TursoAdapter implements DatabaseAdapter {
  private client: Client;
  private readonly localKey?: string;
  private readonly ready: Promise<void>;

  constructor(url: string, authToken: string) {
    if (url.startsWith("file:")) {
      const file = url.startsWith("file://")
        ? fileURLToPath(url)
        : resolve(decodeURIComponent(url.slice(5)));
      this.localKey = process.platform === "win32" ? file.toLowerCase() : file;
    }
    this.client = createClient({ url, authToken });
    this.ready = url.startsWith("file:") ? this.configureLocalFile() : Promise.resolve();
  }

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    return this.localKey ? serializeLocal(this.localKey, run) : run();
  }
  private async configureLocalFile(): Promise<void> {
    return this.serialized(async () => {
      // Acceptance/dev may run evaluator, dossier, and review workers as separate
      // processes against one local libSQL file. WAL permits readers alongside a
      // writer; the explicit timeout lets short concurrent writes serialize
      // instead of dropping telemetry/state with SQLITE_BUSY.
      await this.client.execute("PRAGMA journal_mode=WAL");
      await this.client.execute("PRAGMA busy_timeout=15000");
    });
  }

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    await this.ready;
    const res = await this.serialized(() => this.client.execute({ sql, args: params as any[] }));
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapRow(res.rows[0], res.columns) as T;
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    await this.ready;
    const res = await this.serialized(() => this.client.execute({ sql, args: params as any[] }));
    if (!res.rows) return [];
    return res.rows.map((r) => this.mapRow(r, res.columns) as T);
  }

  async execute(
    sql: string,
    params: QueryParams = [],
  ): Promise<{ rowsAffected: number; lastInsertRowid?: any }> {
    await this.ready;
    const res = await this.serialized(() => this.client.execute({ sql, args: params as any[] }));
    return {
      rowsAffected: res.rowsAffected,
      lastInsertRowid: res.lastInsertRowid ? String(res.lastInsertRowid) : undefined,
    };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    await this.ready;
    return this.serialized(async () => {
      // The local libSQL transaction API detaches its connection on every
      // claim, leaving native handles for GC. Keep one local connection instead;
      // file-level serialization permits an explicit transaction on that client.
      // Remote clients retain their normal transaction/stream lifecycle.
      if (this.localKey) await this.client.execute("BEGIN IMMEDIATE");
      const tx = this.localKey
        ? {
            execute: this.client.execute.bind(this.client),
            commit: async () => {
              await this.client.execute("COMMIT");
            },
            rollback: async () => {
              await this.client.execute("ROLLBACK");
            },
            close: () => {},
          }
        : await this.client.transaction("write");
      const adapterTx: DatabaseAdapter = {
        one: async <R>(sql: string, params: QueryParams = []): Promise<R | null> => {
          const res = await tx.execute({ sql, args: params as any[] });
          if (!res.rows || res.rows.length === 0) return null;
          return this.mapRow(res.rows[0], res.columns) as R;
        },
        many: async <R>(sql: string, params: QueryParams = []): Promise<R[]> => {
          const res = await tx.execute({ sql, args: params as any[] });
          if (!res.rows) return [];
          return res.rows.map((r) => this.mapRow(r, res.columns) as R);
        },
        execute: async (sql: string, params: QueryParams = []) => {
          const res = await tx.execute({ sql, args: params as any[] });
          return {
            rowsAffected: res.rowsAffected,
            lastInsertRowid: res.lastInsertRowid ? String(res.lastInsertRowid) : undefined,
          };
        },
        transaction: async <R>(subFn: (innerTx: DatabaseAdapter) => Promise<R>): Promise<R> => {
          return await subFn(adapterTx);
        },
      };

      try {
        const result = await fn(adapterTx);
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback();
        throw err;
      } finally {
        tx.close();
      }
    });
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

  async executeMigration(
    statements: readonly string[],
    options?: { disableForeignKeys?: boolean },
  ): Promise<void> {
    await this.ready;
    const disableFk = options?.disableForeignKeys ?? false;
    if (disableFk) {
      await this.serialized(() => this.client.migrate(statements as string[]));
    } else {
      await this.transaction(async (tx) => {
        for (const stmt of statements) {
          await tx.execute(stmt);
        }
      });
    }
  }

  async close(): Promise<void> {
    await this.ready;
    this.client.close();
  }
}
