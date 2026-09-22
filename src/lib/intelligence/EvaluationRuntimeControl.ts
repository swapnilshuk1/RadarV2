import type { DatabaseAdapter } from "@/data/database";

export type EvaluationRuntimeState = "RUNNING" | "PAUSED" | "STOPPED";

export interface EvaluationRuntimeControlRecord {
  desiredState: EvaluationRuntimeState;
  updatedAt: number;
  updatedBy: string | null;
}

export class EvaluationRuntimeControl {
  constructor(private readonly db: DatabaseAdapter) {}

  async get(): Promise<EvaluationRuntimeControlRecord> {
    const row = await this.db.one<{
      desired_state: EvaluationRuntimeState;
      updated_at: number;
      updated_by: string | null;
    }>(
      `SELECT desired_state,updated_at,updated_by
       FROM evaluation_runtime_control
       WHERE id='global'`,
    );
    if (!row) {
      throw new Error("EVALUATION_RUNTIME_CONTROL_MISSING");
    }
    return {
      desiredState: row.desired_state,
      updatedAt: Number(row.updated_at),
      updatedBy: row.updated_by,
    };
  }

  async set(
    desiredState: EvaluationRuntimeState,
    updatedBy: string,
  ): Promise<EvaluationRuntimeControlRecord> {
    const updatedAt = Date.now();
    await this.db.execute(
      `INSERT INTO evaluation_runtime_control(id,desired_state,updated_at,updated_by)
       VALUES('global',?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         desired_state=excluded.desired_state,
         updated_at=excluded.updated_at,
         updated_by=excluded.updated_by`,
      [desiredState, updatedAt, updatedBy],
    );
    return { desiredState, updatedAt, updatedBy };
  }
}
