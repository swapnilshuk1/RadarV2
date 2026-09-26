import type { DatabaseAdapter } from "@/data/database";
import type { AuthorizedPersonScope } from "@/lib/security/auth";

export type EvaluationRuntimeState = "RUNNING" | "PAUSED" | "STOPPED";

export interface EvaluationRuntimeControlRecord {
  desiredState: EvaluationRuntimeState;
  updatedAt: number;
  updatedBy: string | null;
}

export class EvaluationRuntimeControl {
  constructor(private readonly db: DatabaseAdapter) {}

  async get(scope: AuthorizedPersonScope): Promise<EvaluationRuntimeControlRecord> {
    try {
      const row = await this.db.one<{
        desired_state: EvaluationRuntimeState;
        updated_at: number;
        updated_by: string | null;
      }>(
        `SELECT desired_state,updated_at,updated_by
         FROM evaluation_runtime_control
         WHERE tenant_id=? AND person_id=?`, [scope.tenantId, scope.personId],
      );
      if (!row) {
        // Migration 059 intentionally begins with no rows. An absent row is
        // the durable default, matching the worker claim predicate.
        return { desiredState: "RUNNING", updatedAt: 0, updatedBy: null };
      }
      return {
        desiredState: row.desired_state,
        updatedAt: Number(row.updated_at),
        updatedBy: row.updated_by,
      };
    } catch (error) {
      throw error;
    }
  }

  async set(
    scope: AuthorizedPersonScope,
    desiredState: EvaluationRuntimeState,
    updatedBy: string,
  ): Promise<EvaluationRuntimeControlRecord> {
    const updatedAt = Date.now();
    await this.db.execute(
      `INSERT INTO evaluation_runtime_control(tenant_id,person_id,desired_state,updated_at,updated_by)
       VALUES(?,?,?,?,?)
       ON CONFLICT(tenant_id,person_id) DO UPDATE SET
         desired_state=excluded.desired_state,
         updated_at=excluded.updated_at,
         updated_by=excluded.updated_by`,
      [scope.tenantId, scope.personId, desiredState, updatedAt, updatedBy],
    );
    return { desiredState, updatedAt, updatedBy };
  }
}
