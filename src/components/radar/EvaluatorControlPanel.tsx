import { useCallback, useEffect, useMemo, useState } from "react";
import {
  controlEvaluatorFn,
  getEvaluatorTelemetryFn,
  type EvaluatorTelemetrySnapshot,
} from "../../lib/intelligence/evaluation-server";

function formatElapsed(startedAt: number | string | null | undefined, now: number): string {
  if (!startedAt) return "—";
  const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  if (!Number.isFinite(start)) return "—";
  const totalSeconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function formatUtc(value: string | number | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${date.toISOString().slice(11, 19)} UTC`;
}

function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

export function evaluatorStatusLabel(snapshot: EvaluatorTelemetrySnapshot | null): string {
  if (!snapshot) return "Loading";
  const { desiredState, localDaemonRunning } = snapshot.control;
  if (desiredState === "PAUSED")
    return snapshot.queue.processing > 0 ? "Pausing" : "Paused";
  if (desiredState === "STOPPED")
    return snapshot.queue.processing > 0 ? "Stopping" : "Stopped";
  return localDaemonRunning ? "Running" : "Ready";
}

export function evaluatorQueueSummary(snapshot: EvaluatorTelemetrySnapshot | null): string {
  if (!snapshot) return "Loading evaluator state…";
  const processing = snapshot.queue.processing;
  const pending = snapshot.queue.pending;
  const processingLabel = processing === 1 ? "1 listing is" : `${processing} listings are`;
  return `${processingLabel} being evaluated; ${pending} waiting. This resumes evaluation only; it does not scrape or enrich again.`;
}

interface EvaluatorControlPanelProps {
  embedded?: boolean;
}

export function EvaluatorControlPanel({ embedded = false }: EvaluatorControlPanelProps) {
  const [snapshot, setSnapshot] = useState<EvaluatorTelemetrySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await getEvaluatorTelemetryFn();
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluator telemetry unavailable");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const telemetryInterval = window.setInterval(() => void refresh(), 1500);
    const clockInterval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(telemetryInterval);
      window.clearInterval(clockInterval);
    };
  }, [refresh]);

  const act = useCallback(
    async (action: "start" | "pause" | "resume" | "stop") => {
      if (controlBusy) return;
      setControlBusy(true);
      try {
        const next = await controlEvaluatorFn({ data: { action } });
        setSnapshot(next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Evaluator control failed");
      } finally {
        setControlBusy(false);
      }
    },
    [controlBusy],
  );

  const statusLabel = useMemo(() => evaluatorStatusLabel(snapshot), [snapshot]);

  const controls = snapshot?.control.canControl ? (
    <div className="flex flex-wrap items-center gap-2">
      {snapshot.control.desiredState === "RUNNING" &&
      snapshot.control.localDaemonRunning ? (
        <button
          type="button"
          disabled={controlBusy}
          onClick={() => void act("pause")}
          className="rounded-full border border-border bg-background px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-foreground hover:bg-muted disabled:opacity-50"
          data-testid="evaluator-pause-button"
        >
          Pause
        </button>
      ) : (
        <button
          type="button"
          disabled={controlBusy}
          onClick={() =>
            void act(snapshot.control.desiredState === "PAUSED" ? "resume" : "start")
          }
          className="rounded-full bg-foreground px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-background hover:opacity-90 disabled:opacity-50"
          data-testid="evaluator-start-resume-button"
        >
          {snapshot.control.desiredState === "PAUSED"
            ? "Resume evaluation"
            : "Start evaluation"}
        </button>
      )}

      {snapshot.control.desiredState !== "STOPPED" && (
        <button
          type="button"
          disabled={controlBusy}
          onClick={() => void act("stop")}
          className="rounded-full border border-red-500/40 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-red-700 hover:bg-red-500/10 dark:text-red-300 disabled:opacity-50"
          data-testid="evaluator-stop-button"
        >
          Stop
        </button>
      )}
    </div>
  ) : null;

  const telemetry = snapshot ? (
    <div className="space-y-space-4">
      <dl className="grid gap-space-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Pending", snapshot.queue.pending],
          ["Processing", snapshot.queue.processing],
          ["Completed", snapshot.queue.completed],
          ["Failed", snapshot.queue.failed],
          ["Dead letter", snapshot.queue.deadLetter],
          [
            "Last completion",
            snapshot.latestCompletedAt ? formatUtc(snapshot.latestCompletedAt) : "—",
          ],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border/70 p-3">
            <dt className="label-mono text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {snapshot.activeJobs.length > 0 ? (
        <div className="space-y-space-2">
          <p className="label-mono text-muted-foreground">Active evaluation</p>
          {snapshot.activeJobs.map((job) => (
            <div
              key={job.id}
              className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-6"
            >
              <div>
                <span className="label-mono text-muted-foreground">Job</span>
                <p className="truncate text-sm font-medium" title={job.id}>
                  {job.id}
                </p>
              </div>
              <div>
                <span className="label-mono text-muted-foreground">Elapsed</span>
                <p className="text-sm font-medium">{formatElapsed(job.firstClaimedAt, now)}</p>
              </div>
              <div>
                <span className="label-mono text-muted-foreground">Current stage</span>
                <p className="text-sm font-medium">{job.currentStage ?? "Preparing input"}</p>
              </div>
              <div>
                <span className="label-mono text-muted-foreground">Call elapsed</span>
                <p className="text-sm font-medium">
                  {job.invocationStatus === "running"
                    ? formatElapsed(job.invocationStartedAt, now)
                    : "—"}
                </p>
              </div>
              <div>
                <span className="label-mono text-muted-foreground">Model</span>
                <p className="text-sm font-medium">{job.modelVersion ?? "—"}</p>
              </div>
              <div>
                <span className="label-mono text-muted-foreground">Tokens so far</span>
                <p className="text-sm font-medium">{formatTokens(job.totalTokens)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No evaluation job is currently processing.
        </p>
      )}

      <div>
        <p className="label-mono mb-2 text-muted-foreground">Recent model calls</p>
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Input</th>
                <th className="px-3 py-2">Reasoning</th>
                <th className="px-3 py-2">Output</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.recentInvocations.slice(0, 12).map((call) => (
                <tr key={call.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{call.stage}</td>
                  <td className="px-3 py-2">
                    {call.status === "running"
                      ? `running · ${formatElapsed(call.startedAt, now)}`
                      : call.status}
                  </td>
                  <td className="px-3 py-2">{formatUtc(call.startedAt)}</td>
                  <td className="px-3 py-2">
                    {call.latencyMs === null
                      ? call.status === "running"
                        ? formatElapsed(call.startedAt, now)
                        : "—"
                      : `${(call.latencyMs / 1000).toFixed(1)}s`}
                  </td>
                  <td className="px-3 py-2">{formatTokens(call.inputTokens)}</td>
                  <td className="px-3 py-2">{formatTokens(call.reasoningTokens)}</td>
                  <td className="px-3 py-2">{formatTokens(call.outputTokens)}</td>
                  <td className="px-3 py-2">{formatTokens(call.totalTokens)}</td>
                </tr>
              ))}
              {snapshot.recentInvocations.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-5 text-center text-muted-foreground">
                    No evaluation model calls have been recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  ) : null;

  if (embedded) {
    return (
      <section
        className="mt-space-3 border-t border-border pt-space-3"
        data-testid="captured-job-evaluation-control"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-mono text-sky-600 dark:text-sky-400">
                Captured-job evaluation
              </span>
              <span className="memo-badge bg-muted text-muted-foreground">
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {evaluatorQueueSummary(snapshot)}
            </p>
          </div>
          {controls}
        </div>

        {error && (
          <p role="alert" className="mt-space-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <details className="mt-space-3 rounded-lg border border-border/70 bg-background/40 p-3">
          <summary className="cursor-pointer text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
            Live evaluator telemetry
          </summary>
          <div className="mt-space-3 border-t border-border pt-space-3">
            {snapshot ? telemetry : (
              <p className="text-sm text-muted-foreground">Loading evaluator telemetry…</p>
            )}
          </div>
        </details>
      </section>
    );
  }

  return (
    <details className="memo-card mb-space-6" data-testid="evaluator-control-panel">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-space-3">
        <span>
          <span className="label-mono text-muted-foreground">Evaluator runtime</span>
          <span className="mt-1 block font-serif text-xl text-foreground">
            Live queue, model calls & controls
          </span>
        </span>
        <span
          className={`memo-badge ${
            statusLabel === "Running"
              ? "bg-signal text-signal-foreground"
              : statusLabel === "Paused" || statusLabel === "Pausing"
                ? "bg-caution text-caution-foreground"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {statusLabel}
        </span>
      </summary>

      {error && (
        <p role="alert" className="mt-space-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-space-3 space-y-space-4 border-t border-border pt-space-3">
        <div className="flex flex-wrap items-center gap-space-2">
          {controls}
          <span className="text-xs text-muted-foreground">
            Pause/stop are graceful: in-flight work may finish, but no new job is claimed.
          </span>
        </div>
        {snapshot ? telemetry : (
          <p className="text-sm text-muted-foreground">Loading evaluator telemetry…</p>
        )}
      </div>
    </details>
  );
}
