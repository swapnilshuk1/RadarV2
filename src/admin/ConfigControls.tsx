import { useState, useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { changeConfigFn } from "./config-server";
import type { readConfigSnapshot } from "./config-store";
import { engineConfigSchema, type EngineConfig, type ConfigMutation } from "./config-contracts";
type Snapshot = Awaited<ReturnType<typeof readConfigSnapshot>>;
export function ConfigControls({ data, tenantId }: { data: Snapshot; tenantId?: string }) {
  const router = useRouter();
  const [publishOpen, setPublishOpen] = useState(false),
    [publishReason, setPublishReason] = useState("");
  const publishDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (publishOpen) publishDialog.current?.showModal();
    else publishDialog.current?.close();
  }, [publishOpen]);
  const [editing, setEditing] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EngineConfig | null>(null),
    [tokenCap, setTokenCap] = useState(500000);
  if (!data)
    return <p>Configuration unavailable. Apply migration 075 to the worker and web database.</p>;
  const shown = data.draft ?? data.active,
    values = form ?? shown.config,
    operator = data.role === "operator";
  const passed = data.benches.find(
    (b) =>
      b.status === "passed" &&
      b.revision_id === data.draft?.id &&
      b.active_revision_id === data.active.id,
  );
  const perform = async (
    input: Omit<ConfigMutation, "reason" | "tenantId">,
    actionReason = reason,
  ) => {
    setBusy(true);
    setError("");
    try {
      await changeConfigFn({
        data: {
          ...input,
          reason: actionReason,
          tenantId,
          expectedState: data.state,
        } as ConfigMutation,
      });
      setPublishOpen(false);
      setEditing(false);
      setForm(null);
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Configuration action failed");
    } finally {
      setBusy(false);
    }
  };
  const button = "border border-border px-3 py-1.5 text-sm disabled:opacity-40";
  return (
    <section className="mb-8 border-y border-border py-5" aria-label="Engine configuration">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Engine configuration</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {tenantId ? `Tenant override: ${tenantId}` : "Platform defaults"} · Active{" "}
            <span className="font-mono">{data.active.id}</span>
          </p>
        </div>
        {operator && !editing && (
          <button
            className={button}
            onClick={() => {
              setForm(structuredClone(shown.config));
              setEditing(true);
            }}
          >
            Edit configuration
          </button>
        )}
      </div>
      {data.draft && (
        <p className="mt-3 text-sm font-medium">
          Showing unpublished draft <span className="font-mono">{data.draft.id}</span> · awaiting
          bench and publication
        </p>
      )}
      {editing && (
        <p role="status" className="mt-3 text-sm">
          Editing unsaved changes. Save a draft before testing or publishing.
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Fixed gate order. Search intent and source integrity retain their existing rules. Queued and
        running jobs keep their revision. Lane assignments apply to new work after publishing.
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {(["reasoning", "writing"] as const).map((lane) => (
          <fieldset key={lane} className="border-t border-border pt-3">
            <legend className="font-serif text-xl capitalize">{lane} lane</legend>
            <p className="my-2 text-xs text-muted-foreground">
              {lane === "reasoning"
                ? "Evidence and intelligence evaluation"
                : "Memo, factual review and model-assisted pursuit"}
            </p>
            <label className="block text-sm">
              Model
              <select
                aria-label={`${lane} model`}
                disabled={!editing || busy}
                value={values[lane].model}
                onChange={(e) =>
                  setForm({
                    ...values,
                    [lane]:
                      e.target.value === "legacy"
                        ? {
                            model: "legacy",
                            concurrency: lane === "reasoning" ? 4 : 2,
                            timeoutMs: 120000,
                            maxOutputTokens: 16384,
                          }
                        : { ...values[lane], model: e.target.value },
                  } as EngineConfig)
                }
                className="ml-3 border border-border bg-background px-2 py-1"
              >
                <option value="legacy">Existing host assignments</option>
                <option value="zai.glm-5">Bedrock Mantle · zai.glm-5</option>
                <option value="deepseek.v3.2">Bedrock Mantle · deepseek.v3.2</option>
              </select>
            </label>
            {values[lane].model === "legacy" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Host settings remain authoritative. Select an explicit model to configure lane
                limits.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {(
                  [
                    ["concurrency", "Concurrent lane calls / process", 1, 8],
                    ["timeoutMs", "Request timeout (ms)", 30000, 180000],
                    ["maxOutputTokens", "Output ceiling / call", 4096, 16384],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <label className="flex items-center justify-between gap-2 text-sm" key={key}>
                    {label}
                    <input
                      aria-label={`${lane} ${label}`}
                      type="number"
                      min={min}
                      max={max}
                      disabled={!editing || busy}
                      value={values[lane][key]}
                      onChange={(e) =>
                        setForm({
                          ...values,
                          [lane]: { ...values[lane], [key]: Number(e.target.value) },
                        })
                      }
                      className="w-28 border border-border bg-background px-2 py-1 font-mono text-right"
                    />
                  </label>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Explicit models use the worker’s BEDROCK_MANTLE_API_KEY reference in us-east-1. No
              browser credential entry or vendor fallback.
            </p>
          </fieldset>
        ))}
      </div>
      <fieldset className="mt-5 border-t border-border pt-3">
        <legend className="font-serif text-xl">Pursuit package</legend>
        <div className="mt-2 flex flex-wrap gap-5">
          {(["pursuitInputTokens", "pursuitOutputTokens"] as const).map((key) => (
            <label key={key} className="text-sm">
              {key === "pursuitInputTokens" ? "Input token budget" : "Output token budget"}{" "}
              <input
                aria-label={key}
                type="number"
                disabled={!editing || busy}
                value={values[key]}
                onChange={(e) => setForm({ ...values, [key]: Number(e.target.value) })}
                className="w-28 border border-border bg-background px-2 py-1 font-mono text-right"
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Tenant quotas remain a separate hard boundary. This package budget does not raise a quota.
        </p>
      </fieldset>
      {operator && (
        <div className="mt-5 border-t border-border pt-4">
          <label className="block text-sm">
            Reason for this action
            <input
              aria-label="Configuration action reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="Explain the change or test"
              className="mt-2 block w-full border border-border bg-background p-2"
            />
          </label>
          {editing && (
            <div className="mt-3 flex gap-3">
              <button
                className={button}
                disabled={busy || reason.trim().length < 3}
                onClick={() => {
                  try {
                    engineConfigSchema.parse(values);
                    void perform({ kind: "draft", config: values } as ConfigMutation);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Invalid configuration");
                  }
                }}
              >
                Save draft
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setForm(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {data.draft && (
            <div
              className="mt-4 flex flex-wrap items-center gap-3 bg-muted/30 p-3"
              aria-label="Configuration draft bar"
            >
              <span className="text-sm">
                Draft <span className="font-mono">{data.draft.id}</span>
              </span>
              <label className="text-xs">
                Bench token admission cap{" "}
                <input
                  aria-label="Bench token cap"
                  type="number"
                  min={50000}
                  max={1000000}
                  value={tokenCap}
                  onChange={(e) => setTokenCap(Number(e.target.value))}
                  className="w-28 border border-border bg-background p-1 font-mono"
                />
              </label>
              <button
                className={button}
                disabled={busy || editing || reason.trim().length < 3}
                onClick={() =>
                  void perform({
                    kind: "bench",
                    revisionId: data.draft!.id,
                    tokenCap,
                  } as ConfigMutation)
                }
              >
                Run shadow bench
              </button>
              <button
                className={button}
                disabled={busy || editing || !passed}
                onClick={() => {
                  setPublishReason("");
                  setPublishOpen(true);
                }}
              >
                Publish tested draft
              </button>
              <button
                className={button}
                disabled={busy || editing || reason.trim().length < 3}
                onClick={() =>
                  void perform({ kind: "discard", revisionId: data.draft!.id } as ConfigMutation)
                }
              >
                Discard draft
              </button>
            </div>
          )}
        </div>
      )}
      {error && !publishOpen && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <dialog
        ref={publishDialog}
        aria-labelledby="config-publish-title"
        onCancel={() => setPublishOpen(false)}
        onClose={() => setPublishOpen(false)}
        className="max-w-2xl border border-border bg-card p-6 text-foreground backdrop:bg-black/30"
      >
        <h2 id="config-publish-title" className="font-serif text-2xl">
          Publish tested configuration
        </h2>
        <p className="mt-3 text-sm">Scope: {tenantId ?? "Platform defaults"}</p>
        <p className="mt-2 text-sm font-mono">
          {data.active.id} → {data.draft?.id}
        </p>
        <table aria-label="Configuration field changes" className="mt-3 w-full text-left text-sm">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Active</th>
              <th>Draft</th>
            </tr>
          </thead>
          <tbody>
            {data.draft &&
              configChanges(data.active.config, data.draft.config).map((c) => (
                <tr key={c.field} className="border-t border-border">
                  <td className="py-2">{c.field}</td>
                  <td className="font-mono">{String(c.before)}</td>
                  <td className="font-mono">{String(c.after)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {passed && (
          <p className="mt-3 text-xs">
            Bench {String(passed.id)}: {benchSummary(String(passed.result_json))}
          </p>
        )}
        <p className="mt-3 text-sm">
          New work will use these settings. Queued jobs retain their pinned revision and existing
          memos remain available.
        </p>
        <label className="mt-4 block text-sm">
          Publication reason
          <input
            autoFocus
            aria-label="Publication reason"
            value={publishReason}
            maxLength={1000}
            onChange={(e) => setPublishReason(e.target.value)}
            className="mt-2 block w-full border border-border bg-background p-2"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <button
            className={button}
            disabled={busy || !passed || !data.draft || publishReason.trim().length < 3}
            onClick={() =>
              void perform(
                {
                  kind: "publish",
                  revisionId: data.draft!.id,
                  benchId: String(passed!.id),
                } as ConfigMutation,
                publishReason,
              )
            }
          >
            Publish revision
          </button>
          <button className={button} disabled={busy} onClick={() => setPublishOpen(false)}>
            Cancel publication
          </button>
        </div>
      </dialog>
      <div className="mt-6">
        <h3 className="font-serif text-xl">Shadow benches</h3>
        <p className="my-2 text-xs text-muted-foreground">
          Three synthetic fixtures exercise direct fit, adjacent fit and an explicit license
          contradiction through the real evaluator and reviewed memo path. A bench worker on the
          target host processes queued tests. Fixture success is a publish prerequisite, not proof
          of corpus-wide impact.
        </p>
        {data.benches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bench runs.</p>
        ) : (
          data.benches.map((b) => (
            <details key={String(b.id)} className="border-b border-border py-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-mono">{String(b.id).slice(0, 8)}</span> · {b.status} ·{" "}
                {b.tokens_reserved} / {b.token_cap} admission units reserved
                {b.error ? ` · ${b.error}` : ""}
              </summary>
              {operator && ["queued", "running"].includes(String(b.status)) && (
                <button
                  className={`${button} mt-2`}
                  disabled={busy || editing || reason.trim().length < 3}
                  onClick={() =>
                    void perform({ kind: "cancel_bench", benchId: String(b.id) } as ConfigMutation)
                  }
                >
                  Cancel bench
                </button>
              )}
              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">
                {b.result_json
                  ? JSON.stringify(JSON.parse(String(b.result_json)), null, 2)
                  : "No accepted result. Queued tests need worker:admin-bench on the target host."}
              </pre>
            </details>
          ))
        )}
      </div>
      <details className="mt-5">
        <summary className="cursor-pointer font-serif text-xl">Revision history</summary>
        {data.history.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-xs"
          >
            <span className="font-mono">{r.id}</span>
            <span>{r.created_by}</span>
            {operator && r.id !== data.active.id && (
              <button
                className={button}
                disabled={busy || editing || reason.trim().length < 3}
                onClick={() => void perform({ kind: "revert", revisionId: r.id } as ConfigMutation)}
              >
                Restore as a new draft
              </button>
            )}
          </div>
        ))}
      </details>
    </section>
  );
}

export function configChanges(before: EngineConfig, after: EngineConfig) {
  return [
    ...(["reasoning", "writing"] as const).flatMap((lane) =>
      (Object.keys(before[lane]) as Array<keyof EngineConfig[typeof lane]>).map((key) => ({
        field: `${lane}.${key}`,
        before: before[lane][key],
        after: after[lane][key],
      })),
    ),
    ...(["pursuitInputTokens", "pursuitOutputTokens"] as const).map((key) => ({
      field: key,
      before: before[key],
      after: after[key],
    })),
  ].filter((c) => c.before !== c.after);
}
function benchSummary(json: string) {
  const r = JSON.parse(json);
  return `${r.fixtureVersion}; ${r.cases?.length ?? 0} fixtures; ${r.verdictsChanged ?? 0} verdict changes; ${r.invalidOutputs ?? 0} invalid outputs; ${r.validationRepairs ?? 0} repairs`;
}
