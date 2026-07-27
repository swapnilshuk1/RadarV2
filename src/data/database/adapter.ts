export type QueryParams = readonly unknown[];

export interface DatabaseAdapter {
  one<T>(sql: string, params?: QueryParams): Promise<T | null>;
  many<T>(sql: string, params?: QueryParams): Promise<T[]>;
  execute(sql: string, params?: QueryParams): Promise<{ rowsAffected: number; lastInsertRowid?: number | bigint | string }>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
}
