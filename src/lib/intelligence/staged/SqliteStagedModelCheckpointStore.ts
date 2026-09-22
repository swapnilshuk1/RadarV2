import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "@/data/database";
import type { ReasoningModel } from "@/dossier/contracts";

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest("hex");
}

export interface StagedCheckpointIdentity {
  tenantId: string;
  personId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  inputFingerprint: string;
}

export class SqliteStagedModelCheckpointStore {
  readonly scopeFingerprint: string;

  constructor(
    private readonly db: DatabaseAdapter,
    identity: StagedCheckpointIdentity,
  ) {
    this.scopeFingerprint = stableHash(identity);
  }

  requestFingerprint(
    model: ReasoningModel,
    stage: string,
    instruction: string,
    input: unknown,
    schema: Record<string, unknown>,
  ) {
    return stableHash({
      model: [
        model.id,
        model.version,
        model.configurationFingerprint ?? "unconfigured",
      ],
      stage,
      instruction,
      input,
      schema,
    });
  }

  async get(
    requestFingerprint: string,
  ): Promise<{ value: unknown; responseFingerprint: string } | undefined> {
    const row = await this.db.one<{
      response_json: string;
      response_fingerprint: string;
    }>(
      `SELECT response_json,response_fingerprint
       FROM staged_model_checkpoints
       WHERE scope_fingerprint=? AND request_fingerprint=?`,
      [this.scopeFingerprint, requestFingerprint],
    );
    if (!row) return undefined;
    const value = JSON.parse(row.response_json);
    if (stableHash(value) !== row.response_fingerprint)
      throw new Error("STAGED_MODEL_CHECKPOINT_CORRUPT");
    return { value, responseFingerprint: row.response_fingerprint };
  }

  async saveValidated(
    requestFingerprint: string,
    stage: string,
    model: ReasoningModel,
    value: unknown,
  ): Promise<void> {
    const responseFingerprint = stableHash(value);
    await this.db.execute(
      `INSERT INTO staged_model_checkpoints(
        scope_fingerprint,request_fingerprint,stage,model_id,model_version,
        model_configuration_fingerprint,response_json,response_fingerprint,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(scope_fingerprint,request_fingerprint) DO NOTHING`,
      [
        this.scopeFingerprint,
        requestFingerprint,
        stage,
        model.id,
        model.version,
        model.configurationFingerprint ?? "unconfigured",
        JSON.stringify(value),
        responseFingerprint,
        Date.now(),
      ],
    );
  }

  async discard(requestFingerprint: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM staged_model_checkpoints
       WHERE scope_fingerprint=? AND request_fingerprint=?`,
      [this.scopeFingerprint, requestFingerprint],
    );
  }
}
