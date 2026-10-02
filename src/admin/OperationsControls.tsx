import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { changeOperationsFn, changeSearchConnectionFn, getOperationsFn } from "./operations-server";
import type { Throughput, OperationsMutation } from "./operations-contracts";
import type { SearchConnectionMutation } from "./search-connection-contracts";

type Data = Awaited<ReturnType<typeof getOperationsFn>>;
const button = "border border-border px-3 py-2 text-sm disabled:opacity-40";
const field = "border border-border bg-background p-2";
function Records({ rows }: { rows: Record<string, string | number | null>[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No records.</p>;
  const keys = Object.keys(rows[0]!);
  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} className="border-b p-2">
                {k.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k} className="max-w-xs break-words border-b p-2">
                  {String(r[k] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function OperationsControls({ data, overview = false }: { data: Data; overview?: boolean }) {
  const router = useRouter();
  const ops = data.operations,
    connection = data.connection;
  const [key, setKey] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [incidentId, setIncidentId] = useState(""),
    [previewId, setPreviewId] = useState("");
  const [settings, setSettings] = useState<Throughput | undefined>(
    ops.installed ? ops.configuration.settings : undefined,
  );
  const [webhook, setWebhook] = useState(""),
    [signingSecret, setSigningSecret] = useState(""),
    [severity, setSeverity] = useState<"Critical" | "High" | "Warning">("High");
  useEffect(() => {
    if (overview) return;
    const timer = setInterval(() => {
      if (!busy) void router.invalidate();
    }, 10000);
    return () => clearInterval(timer);
  }, [router, overview, busy]);
  if (!ops.installed || !connection.installed)
    return <p>Operations & Recovery migrations are not installed.</p>;
  const writable = ops.role === "operator";
  const enabled = writable && !busy && reason.trim().length >= 3;
  const attention = ops.incidents.filter((i) => i.state !== "resolved");
  if (overview)
    return (
      <section className="mb-8 border border-border p-5">
        <h2 className="font-serif text-2xl">Needs attention</h2>
        {!attention.length && <p className="mt-3 text-sm">No open provider incidents.</p>}
        {attention.map((i) => (
          <a
            key={String(i.id)}
            href={`/admin?view=Connections#incident-${i.id}`}
            className="mt-3 block text-sm"
          >
            {i.severity}: {i.provider} / {i.failure_class} — {i.affected_jobs} affected jobs
          </a>
        ))}
        {ops.attention.map((a, i) => (
          <a key={i} href={`/admin?view=Connections#${a.target}`} className="mt-3 block text-sm">
            {a.severity}: {a.message}
          </a>
        ))}
        {ops.deliveries
          .filter((d) => d.status === "failed")
          .map((d) => (
            <a
              key={String(d.id)}
              href="/admin?view=Connections#notifications"
              className="mt-3 block text-sm"
            >
              Warning: webhook delivery failed — {d.attempts} attempts
            </a>
          ))}
        <a href="/admin?view=Connections#runtime" className="mt-4 block text-sm underline">
          Inspect worker and queue health
        </a>
      </section>
    );
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await task();
      await router.invalidate();
      setMessage("Operation recorded.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "OPERATION_FAILED");
    } finally {
      setBusy(false);
    }
  };
  const change = (input: Omit<OperationsMutation, "reason">) =>
    run(() => changeOperationsFn({ data: { ...input, reason } as OperationsMutation }));
  const search = (input: Omit<SearchConnectionMutation, "expectedRevision" | "reason">) =>
    run(() =>
      changeSearchConnectionFn({
        data: {
          ...input,
          expectedRevision: connection.revision,
          reason,
        } as SearchConnectionMutation,
      }),
    );
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Reason{" "}
          <input
            aria-label="Operational change reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={field}
            placeholder="Reason for this change"
            maxLength={500}
          />
        </label>
        <button className={button} onClick={() => void router.invalidate()}>
          Refresh operations
        </button>
        <span role="status">{message}</span>
      </div>
      <section className="space-y-4 border border-border p-5">
        <h2 className="font-serif text-2xl">Tavily connection</h2>
        <p>
          Generation {connection.generation} ·{" "}
          {connection.activeId
            ? `Active version ${connection.activeId}`
            : connection.hostConfigured
              ? "Host credential active"
              : "No credential configured"}
        </p>
        <p>
          Workers loaded: {connection.uptake.loaded}/{connection.uptake.required}
          {connection.uptake.missing.length
            ? ` · Missing: ${connection.uptake.missing.join(", ")}`
            : ""}
        </p>
        {connection.cooldown && (
          <p>
            Health:{" "}
            {connection.cooldown.requires_action
              ? "Operator action required"
              : connection.cooldown.blocked_until > Date.now()
                ? "Cooldown"
                : "Dispatch enabled"}{" "}
            · {connection.cooldown.failure_class}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <input
            type="password"
            autoComplete="new-password"
            aria-label="Replacement Tavily key"
            className={field}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Replacement Tavily key"
          />
          <button
            className={button}
            disabled={!enabled || !key}
            onClick={() => {
              const secret = key;
              setKey("");
              void search({ kind: "candidate", key: secret } as Omit<
                SearchConnectionMutation,
                "expectedRevision" | "reason"
              >);
            }}
          >
            Save candidate
          </button>
        </div>
        {connection.candidateId && (
          <div className="flex flex-wrap items-center gap-3">
            <span>Candidate: {connection.candidateId}</span>
            <button
              className={button}
              disabled={!enabled}
              onClick={() =>
                void search({ kind: "test", credentialId: connection.candidateId! } as Omit<
                  SearchConnectionMutation,
                  "expectedRevision" | "reason"
                >)
              }
            >
              Validate on worker
            </button>
            <button
              className={button}
              disabled={!enabled}
              onClick={() =>
                void search({ kind: "activate", credentialId: connection.candidateId! } as Omit<
                  SearchConnectionMutation,
                  "expectedRevision" | "reason"
                >)
              }
            >
              Activate validated candidate
            </button>
          </div>
        )}
        {connection.previousId && (
          <div className="flex flex-wrap gap-3">
            <button
              className={button}
              disabled={!enabled}
              onClick={() =>
                void search({ kind: "test", credentialId: connection.previousId! } as Omit<
                  SearchConnectionMutation,
                  "expectedRevision" | "reason"
                >)
              }
            >
              Validate previous version
            </button>
            <button
              className={button}
              disabled={!enabled}
              onClick={() => void search({ kind: "rollback" })}
            >
              Rollback to previous version
            </button>
          </div>
        )}
        {connection.activeId && (
          <button
            className={button}
            disabled={!enabled}
            onClick={() =>
              void search({ kind: "test", credentialId: connection.activeId! } as Omit<
                SearchConnectionMutation,
                "expectedRevision" | "reason"
              >)
            }
          >
            Probe active connection
          </button>
        )}
        <Records rows={connection.checks} />
        <details>
          <summary>Credential lifecycle</summary>
          <Records rows={connection.credentials} />
        </details>
      </section>
      <section className="space-y-4">
        <h2 className="font-serif text-2xl">Incidents & recovery</h2>
        <p className="text-sm">
          Acknowledgement and snooze do not resume work. Recovery previews expire after five
          minutes; execution rechecks current state.
        </p>
        {ops.incidents.map((i) => (
          <article
            id={`incident-${i.id}`}
            key={String(i.id)}
            className="space-y-3 border border-border p-5"
          >
            <h3 className="text-lg">
              {i.severity}: {i.provider} / {i.failure_class}
            </h3>
            <p>
              {i.state} · {i.occurrences} observations · {i.affected_jobs} affected jobs · first
              seen {new Date(Number(i.first_seen)).toISOString()}
            </p>
            {i.state !== "resolved" && (
              <div className="flex flex-wrap gap-3">
                <button
                  className={button}
                  disabled={!enabled}
                  onClick={() =>
                    void change({ kind: "acknowledge", incidentId: String(i.id) } as Omit<
                      OperationsMutation,
                      "reason"
                    >)
                  }
                >
                  Acknowledge
                </button>
                <button
                  className={button}
                  disabled={!enabled}
                  onClick={() =>
                    void change({ kind: "snooze", incidentId: String(i.id), minutes: 60 } as Omit<
                      OperationsMutation,
                      "reason"
                    >)
                  }
                >
                  Snooze 1 hour
                </button>
                <button
                  className={button}
                  disabled={!enabled || i.connection_id !== "tavily:platform"}
                  onClick={() => {
                    setIncidentId(String(i.id));
                    setSelected([]);
                    setPreviewId("");
                  }}
                >
                  Select recovery cohort
                </button>
              </div>
            )}
            <p className="text-xs">
              Incident {i.id}
              {i.recurrence_of ? ` · recurrence of ${i.recurrence_of}` : ""}
            </p>
            {incidentId === i.id && (
              <div className="space-y-3">
                {ops.linkedJobs
                  .filter((j) => j.incident_id === i.id)
                  .map((j) => (
                    <label key={String(j.job_id)} className="block text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(String(j.job_id))}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, String(j.job_id)]
                              : s.filter((id) => id !== j.job_id),
                          )
                        }
                      />{" "}
                      {j.pipeline} · {j.tenant_id} · {j.job_id} ·{" "}
                      {j.accounted_reason ?? "pending accounting"}
                    </label>
                  ))}
                <p>
                  {selected.length} selected · maximum {ops.configuration.settings.cohortLimit}
                </p>
                <button
                  className={button}
                  disabled={
                    !enabled ||
                    !selected.length ||
                    selected.length > ops.configuration.settings.cohortLimit
                  }
                  onClick={() =>
                    void run(async () => {
                      const result = await changeOperationsFn({
                        data: { kind: "preview", incidentId, jobIds: selected, reason },
                      });
                      if ("id" in result) setPreviewId(String(result.id));
                    })
                  }
                >
                  Preview selected work
                </button>
                {previewId && (
                  <>
                    <p>Preview {previewId}</p>
                    <Records rows={ops.actionJobs.filter((j) => j.action_id === previewId)} />
                    <button
                      className={button}
                      disabled={!enabled}
                      onClick={() =>
                        void change({ kind: "execute", actionId: previewId } as Omit<
                          OperationsMutation,
                          "reason"
                        >)
                      }
                    >
                      Resume {selected.length} selected jobs
                    </button>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
        <details>
          <summary>Recovery outcomes</summary>
          <Records rows={ops.actions} />
          <Records rows={ops.actionJobs} />
        </details>
      </section>
      <section id="runtime" className="space-y-4">
        <h2 className="font-serif text-2xl">Runtime & deployment health</h2>
        <Records
          rows={ops.queues.map((q) => ({
            pipeline: q.pipeline,
            waiting: q.waiting ?? 0,
            active: q.active ?? 0,
            terminal: q.terminal ?? 0,
            oldest: q.oldest ?? null,
          }))}
        />
        <Records rows={ops.workers} />
        <Records rows={ops.receipts} />
        <p>
          Release: {ops.deployment.releaseSha} · Database: {ops.deployment.databaseFingerprint}
        </p>
        <p>
          Session secret:{" "}
          {ops.deployment.sessionSecretConfigured ? "configured" : "missing or invalid"} · OAuth:{" "}
          {ops.deployment.oauthConfigured ? "configured" : "missing"} · Callback:{" "}
          {ops.deployment.callbackValid ? "matches deployment" : "unverified or mismatched"} ·
          Vault: {ops.deployment.vaultAvailable ? "available" : "unavailable"}
        </p>
        <p>
          Bedrock:{" "}
          {ops.deployment.bedrock.credentialConfigured
            ? "host credential configured"
            : "host credential missing"}{" "}
          · {ops.deployment.bedrock.version} · rotation is deployment-managed.
        </p>
        <p>
          Google ADC: {ops.deployment.adc.status} · Project:{" "}
          {ops.deployment.adc.project ?? "unconfigured"}
        </p>
        <p>Storage topology: {ops.deployment.storageStatus}</p>
        <div className="flex gap-3">
          <button
            className={button}
            disabled={!enabled}
            onClick={() =>
              void change({ kind: "host_probe", provider: "bedrock" } as Omit<
                OperationsMutation,
                "reason"
              >)
            }
          >
            Test Bedrock on evaluation host
          </button>
          <button
            className={button}
            disabled={!enabled}
            onClick={() =>
              void change({ kind: "host_probe", provider: "google" } as Omit<
                OperationsMutation,
                "reason"
              >)
            }
          >
            Test ADC on review host
          </button>
        </div>
        <Records rows={ops.hostChecks} />
        {settings && (
          <>
            <p>
              Configured operational revision: {ops.configuration.revision}. Job limits apply per
              worker process; provider limits apply across participating processes.
            </p>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  "evaluation",
                  "dossier",
                  "factual_review",
                  "pursuit",
                  "providerConcurrency",
                  "cohortLimit",
                ] as const
              ).map((k) => (
                <label key={k}>
                  {k.replaceAll("_", " ")}{" "}
                  <input
                    type="number"
                    className={`${field} w-20`}
                    value={settings[k]}
                    min={1}
                    max={k === "cohortLimit" ? 100 : k === "providerConcurrency" ? 16 : 8}
                    onChange={(e) => setSettings((s) => ({ ...s!, [k]: Number(e.target.value) }))}
                  />
                </label>
              ))}
              <label>
                Profile{" "}
                <select
                  className={field}
                  value={settings.profile}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s!,
                      profile: e.target.value as Throughput["profile"],
                    }))
                  }
                >
                  {["Normal", "Conservative", "Recovery"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className={button}
              disabled={!enabled}
              onClick={() =>
                void change({
                  kind: "throughput",
                  settings,
                  revision: ops.configuration.revision,
                } as Omit<OperationsMutation, "reason">)
              }
            >
              Apply throughput
            </button>
          </>
        )}
      </section>
      <section id="notifications" className="space-y-4">
        <h2 className="font-serif text-2xl">Notifications</h2>
        <p>
          Signed HTTPS webhook · asynchronous delivery · five-minute receiver replay window.
          Recovery notices use the same destination.
        </p>
        <p>Current destination: {ops.webhook?.url ?? "not configured"}</p>
        <div className="flex flex-wrap gap-3">
          <input
            aria-label="Webhook destination"
            className={field}
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://alerts.example.com/radar"
          />
          <input
            type="password"
            autoComplete="new-password"
            aria-label="Webhook signing secret"
            className={field}
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
            placeholder="Signing secret (32+ characters)"
          />
          <select
            aria-label="Minimum alert severity"
            className={field}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
          >
            {["Critical", "High", "Warning"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className={button}
            disabled={!enabled || !webhook || signingSecret.length < 32}
            onClick={() => {
              const secret = signingSecret;
              setSigningSecret("");
              void change({
                kind: "webhook",
                url: webhook,
                secret,
                severity,
                recovery: true,
              } as Omit<OperationsMutation, "reason">);
            }}
          >
            Save destination
          </button>
        </div>
        <Records rows={ops.deliveries} />
      </section>
    </div>
  );
}
