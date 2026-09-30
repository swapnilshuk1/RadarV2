import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "@/data/database";
import type { ReasoningModel } from "@/dossier/contracts";
import type { ModelCallMetadata } from "@/lib/model/model-invocation";

function hash(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
            )
          : item,
      ),
    )
    .digest("hex");
}

/**
 * Durable semantic request cache for one exact staged-evaluation scope.
 * It stores raw structured responses and revalidates them at every caller.
 * Provider failures are never persisted because model.generate never returns them.
 */
export function durableStagedModel(
  db: DatabaseAdapter,
  scopeFingerprint: string,
  model: ReasoningModel,
): ReasoningModel {
  const responses = new Map<unknown, { key: string; fingerprint: string }>();

  return {
    id: model.id,
    version: model.version,
    schemaFormat: model.schemaFormat,
    configurationFingerprint: model.configurationFingerprint,
    async discardResponse(response) {
      const entry = responses.get(response);
      if (entry) {
        await db.execute(
          `DELETE FROM staged_model_checkpoints
           WHERE scope_fingerprint=? AND request_fingerprint=? AND response_fingerprint=?`,
          [scopeFingerprint, entry.key, entry.fingerprint],
        );
        responses.delete(response);
      }
      await model.discardResponse?.(response);
    },
    async generate(
      instruction: string,
      input: unknown,
      schema?: Record<string, unknown>,
      metadata?: ModelCallMetadata,
    ) {
      const stage = metadata?.stage ?? "unspecified";
      const key = hash({
        model: [
          model.id,
          model.version,
          model.configurationFingerprint ?? "unconfigured",
        ],
        stage,
        instruction,
        input,
        schema: schema ?? null,
        maxOutputTokens: metadata?.maxOutputTokens ?? null,
      });
      const read = () =>
        db.one<{ response_json: string; response_fingerprint: string }>(
          `SELECT response_json,response_fingerprint
           FROM staged_model_checkpoints
           WHERE scope_fingerprint=? AND request_fingerprint=?`,
          [scopeFingerprint, key],
        );
      const parse = (row: { response_json: string; response_fingerprint: string }) => {
        const value = JSON.parse(row.response_json);
        if (hash(value) !== row.response_fingerprint)
          throw new Error("STAGED_MODEL_CHECKPOINT_CORRUPT");
        if (responses.size >= 128) responses.delete(responses.keys().next().value);
        responses.set(value, { key, fingerprint: row.response_fingerprint });
        return value;
      };

      const existing = await read();
      if (existing) return parse(existing);

      const response = await model.generate(instruction, input, schema, metadata);
      const fingerprint = hash(response);
      await db.execute(
        `INSERT INTO staged_model_checkpoints(
          scope_fingerprint,request_fingerprint,stage,model_id,model_version,
          model_configuration_fingerprint,response_json,response_fingerprint,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(scope_fingerprint,request_fingerprint) DO NOTHING`,
        [
          scopeFingerprint,
          key,
          stage,
          model.id,
          model.version,
          model.configurationFingerprint ?? "unconfigured",
          JSON.stringify(response),
          fingerprint,
          Date.now(),
        ],
      );
      const saved = await read();
      if (!saved) throw new Error("STAGED_MODEL_CHECKPOINT_NOT_PERSISTED");
      return parse(saved);
    },
  };
}

export function stagedCheckpointScope(value: unknown): string {
  return hash(value);
}
