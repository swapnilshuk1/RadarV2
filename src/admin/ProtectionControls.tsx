import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { changeProtectionFn } from "./protection-server";
import {
  pipelines,
  quotaDimensions,
  type QuotaDimension,
  type ProtectedPipeline,
} from "./protection-contracts";
import type { AdminSnapshot } from "./service";
const labels: Record<string, string> = {
  reasoning_monthly: "Reasoning tokens / UTC month",
  writing_monthly: "Writing tokens / UTC month",
  evaluations_daily: "Evaluations / UTC day",
  memos_daily: "Memos / UTC day",
  pursuits_monthly: "Pursuit packages / UTC month",
  scrapes_daily: "Scrape runs / UTC day",
  concurrent_jobs: "Concurrent jobs",
  job_input_tokens: "Per-job input admission budget",
  job_output_tokens: "Per-job output budget",
};
export function ProtectionControls({
  data,
  mode,
}: {
  data: AdminSnapshot;
  mode: "quotas" | "operations";
}) {
  const router = useRouter();
  const row = data.sections
    .find((s) => s.title === "Quotas")
    ?.rows?.find((r) => r.tenant_id === data.tenantId);
  const keys = [...quotaDimensions, "job_input_tokens", "job_output_tokens"] as const;
  const [edit, setEdit] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [jobKey, setJobKey] = useState(""),
    [alertId, setAlertId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [pipeline, setPipeline] = useState<ProtectedPipeline | "*">("*");
  const [dimension, setDimension] = useState<QuotaDimension>("reasoning_monthly"),
    [limit, setLimit] = useState(""),
    [days, setDays] = useState("7");
  if (data.role !== "operator")
    return (
      <p className="mb-5 text-sm text-muted-foreground">
        Viewer access. Only platform operators can change protection.
      </p>
    );
  const submit = async (action: Parameters<typeof changeProtectionFn>[0]["data"]) => {
    setBusy(true);
    setError("");
    try {
      await changeProtectionFn({ data: action });
      setEdit(false);
      setReason("");
      await router.invalidate();
    } catch {
      setError("Change was not saved. Check values, the reason and platform access.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mb-7 border-y border-border py-4">
      <h2 className="font-serif text-2xl">
        {mode === "quotas" ? "Quota protection" : "Claim controls"}
      </h2>
      <p className="my-3 text-sm leading-6 text-muted-foreground">
        Scope: {data.tenantId ?? "all tenants"}. Pauses stop new claims; running work finishes.
        Quota deferral preserves the job and its evidence.
      </p>
      {mode === "quotas" ? (
        <>
          <button
            disabled={!data.tenantId || busy}
            className="border border-border px-3 py-2 text-sm disabled:opacity-40"
            onClick={() => {
              setValues(
                Object.fromEntries(
                  keys.map((k) => [
                    k,
                    String(
                      row?.[k] ??
                        (k === "job_input_tokens"
                          ? 500000
                          : k === "job_output_tokens"
                            ? 100000
                            : ""),
                    ),
                  ]),
                ),
              );
              setEdit(!edit);
            }}
          >
            {edit ? "Close editor" : "Configure quotas"}
          </button>
          {!data.tenantId && (
            <p className="mt-2 text-xs text-muted-foreground">
              Select a tenant above to edit its limits.
            </p>
          )}
          {edit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const quota = Object.fromEntries(
                  keys.map((k) => [k, values[k] === "" ? null : Number(values[k])]),
                );
                void submit({ kind: "quota", tenant: data.tenantId!, quota, reason });
              }}
              className="mt-5"
            >
              <p className="mb-4 text-xs leading-6 text-muted-foreground">
                Blank period limits mean unlimited; zero blocks claims. Job budgets must be
                positive. A claim reserves its remaining job budget, then reconciles reported usage.
                Input admission uses a conservative UTF-8 byte estimate; provider output limits are
                enforced before dispatch. Existing job budgets only increase when you explicitly
                raise these values.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {keys.map((k) => (
                  <label key={k} className="text-xs">
                    {labels[k]}
                    <input
                      type="number"
                      min={k.startsWith("job_") ? 1 : 0}
                      max={1000000000}
                      step="1"
                      required={k.startsWith("job_")}
                      value={values[k] ?? ""}
                      onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                      className="mt-1 block w-full border border-border bg-background p-2 font-mono"
                    />
                  </label>
                ))}
              </div>
              <label className="mt-4 block text-xs">
                Reason
                <input
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 block w-full border border-border bg-background p-2"
                />
              </label>
              <button
                disabled={busy}
                className="mt-3 border border-primary px-3 py-2 text-sm text-primary"
              >
                Save quotas
              </button>
            </form>
          )}
          {data.tenantId && !edit && (
            <form
              className="mt-5 flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit({
                  kind: "override",
                  tenant: data.tenantId!,
                  dimension,
                  limit: Number(limit),
                  expires: Date.now() + Number(days) * 86400000,
                  reason,
                });
              }}
            >
              <label className="text-xs">
                Temporary limit
                <select
                  aria-label="Override dimension"
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value as QuotaDimension)}
                  className="mt-1 block border border-border bg-background p-2"
                >
                  {quotaDimensions.map((k) => (
                    <option key={k} value={k}>
                      {labels[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Limit
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="mt-1 block w-28 border border-border bg-background p-2"
                />
              </label>
              <label className="text-xs">
                Expires in days
                <input
                  required
                  type="number"
                  min="1"
                  max="30"
                  step="1"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="mt-1 block w-24 border border-border bg-background p-2"
                />
              </label>
              <label className="text-xs">
                Reason
                <input
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 block border border-border bg-background p-2"
                />
              </label>
              <button
                disabled={busy || !row}
                className="border border-border px-3 py-2 text-sm disabled:opacity-40"
              >
                Apply temporary limit
              </button>
            </form>
          )}
        </>
      ) : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
          <label className="text-xs">
            Pipeline
            <select
              aria-label="Controlled pipeline"
              value={pipeline}
              onChange={(e) => setPipeline(e.target.value as ProtectedPipeline | "*")}
              className="mt-1 block border border-border bg-background p-2"
            >
              <option value="*">All protected pipelines</option>
              {pipelines.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Reason
            <input
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 block border border-border bg-background p-2"
            />
          </label>
          {[true, false].map((paused) => (
            <button
              key={String(paused)}
              disabled={busy || !reason.trim()}
              onClick={() =>
                void submit({ kind: "pause", tenant: data.tenantId, pipeline, paused, reason })
              }
              className="border border-border px-3 py-2 text-sm disabled:opacity-40"
            >
              {paused ? "Pause claims" : "Resume claims"}
            </button>
          ))}
        </form>
      )}
      {mode === "operations" && (
        <div className="mt-5 flex flex-wrap gap-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const [tenant, pipeline, jobId] = JSON.parse(jobKey) as [
                string,
                ProtectedPipeline,
                string,
              ];
              void submit({ kind: "resume_job", tenant, pipeline, jobId, reason });
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="text-xs">
              Held job
              <select
                required
                aria-label="Held job"
                value={jobKey}
                onChange={(e) => setJobKey(e.target.value)}
                className="mt-1 block max-w-md border border-border bg-background p-2"
              >
                <option value="">Select a held job</option>
                {data.sections
                  .find((s) => s.title === "Deferrals")
                  ?.rows?.map((r) => (
                    <option
                      key={JSON.stringify([r.tenant_id, r.pipeline, r.job_id])}
                      value={JSON.stringify([r.tenant_id, r.pipeline, r.job_id])}
                    >
                      {String(r.pipeline)} � {String(r.job_id)} � {String(r.reason)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs">
              Reason
              <input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 block border border-border bg-background p-2"
              />
            </label>
            <button disabled={busy || !jobKey} className="border border-border px-3 py-2 text-sm">
              Resume held job
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit({ kind: "acknowledge", alertId, reason });
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="text-xs">
              Alert
              <select
                required
                aria-label="Alert"
                value={alertId}
                onChange={(e) => setAlertId(e.target.value)}
                className="mt-1 block max-w-md border border-border bg-background p-2"
              >
                <option value="">Select an alert</option>
                {data.sections
                  .find((s) => s.title === "Alerts")
                  ?.rows?.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.kind)} � {String(r.target)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs">
              Reason
              <input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 block border border-border bg-background p-2"
              />
            </label>
            <button disabled={busy || !alertId} className="border border-border px-3 py-2 text-sm">
              Acknowledge alert
            </button>
          </form>
          <p className="text-xs text-muted-foreground">
            Resuming rechecks every limit and preserves spend. Acknowledging an alert does not
            resume work.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
