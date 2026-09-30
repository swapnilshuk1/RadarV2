/**
 * The Pursuit Cockpit.
 *
 * One persistent workspace per pursued opportunity, not a wizard: the candidate
 * moves between strategy, resume, outreach and interview prep in any order, and
 * every surface reads from the same thesis so the argument stays consistent.
 */

import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { InterviewBriefPanel } from "./InterviewBriefPanel";
import { OutreachKit } from "./OutreachKit";
import { ResumeStudio } from "./ResumeStudio";
import { downloadBase64 } from "./shared";
import { StrategyPanel } from "./StrategyPanel";
import {
  derivePursuitFn,
  exportArtifactFn,
  markOutreachSentFn,
  preflightArtifactApprovalFn,
  getCockpitFn,
  getPursuitPreparationStatusFn,
  saveArtifactFn,
  updatePursuitStateFn,
} from "../server";
import type { ArtifactContent, CockpitView, LearningSignal, PursuitStatus } from "../types";
import { isTerminalPursuitStatus, preparationServiceUnavailable, PURSUIT_WORKER_UNAVAILABLE_MESSAGE, pursuitStatusLabels } from "../types";
import type { ArtifactApprovalBlocker } from "../approval";

type Surface = "STRATEGY" | "RESUME" | "OUTREACH" | "INTERVIEW";

const SURFACES: Array<{ key: Surface; label: string }> = [
  { key: "STRATEGY", label: "Strategy" },
  { key: "RESUME", label: "Resume" },
  { key: "OUTREACH", label: "Outreach" },
  { key: "INTERVIEW", label: "Interview" },
];

interface Props {
  scope: { tenantId: string; personId: string };
  jobHash: string;
  initialView: CockpitView;
  onClose: () => void;
}

export function PursuitCockpit({ scope, jobHash, initialView, onClose }: Props) {
  const [view, setView] = useState(initialView);
  const [surface, setSurface] = useState<Surface>("STRATEGY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const resolveMenuRef = useRef<HTMLDivElement | null>(null);
  const [workerAvailable, setWorkerAvailable] = useState<boolean | null>(initialView.workerAvailable ?? null);
  const [approvalBlockersByArtifact, setApprovalBlockersByArtifact] = useState<Record<string, ArtifactApprovalBlocker[]>>({});

  const derive = useServerFn(derivePursuitFn);
  const saveArtifact = useServerFn(saveArtifactFn);
  const preflightApproval = useServerFn(preflightArtifactApprovalFn);
  const updateState = useServerFn(updatePursuitStateFn);
  const exportArtifact = useServerFn(exportArtifactFn);
  const markOutreachSent = useServerFn(markOutreachSentFn);
  const fetchCockpit = useServerFn(getCockpitFn);
  const fetchStatus = useServerFn(getPursuitPreparationStatusFn);

  // Preparation runs in the durable worker. Polling reads the narrow status row
  // (one row, not the whole package), pauses while the tab is hidden, and backs
  // off as the wait grows — a long derivation must not cost a linear read bill.
  const preparing =
    view.pursuit.preparationState === "QUEUED" || view.pursuit.preparationState === "DERIVING";
  const workerUnavailable = preparationServiceUnavailable(view.pursuit.preparationState, workerAvailable);
  const resolved = isTerminalPursuitStatus(view.pursuit.status);

  useEffect(() => {
    if (!resolveOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!resolveMenuRef.current?.contains(event.target as Node)) setResolveOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResolveOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [resolveOpen]);

  useEffect(() => {
    if (!preparing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ticks = 0;

    const delay = () => Math.min(4000 * Math.pow(1.5, Math.floor(ticks / 3)), 30000);

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        timer = setTimeout(tick, 5000); // paused: no server read while hidden
        return;
      }
      ticks += 1;
      try {
        const status = await fetchStatus({ data: { ...scope, jobHash } });
        if (cancelled) return;
        if (status) setWorkerAvailable(status.workerAvailable);
        const settled =
          status && status.preparationState !== "QUEUED" && status.preparationState !== "DERIVING";
        if (settled) {
          // One full read, only once preparation has actually settled.
          const full = await fetchCockpit({ data: { ...scope, jobHash } });
          if (!cancelled) {
            setView(full);
            setWorkerAvailable(full.workerAvailable ?? null);
          }
          return;
        }
      } catch {
        /* transient: keep waiting */
      }
      if (!cancelled) timer = setTimeout(tick, delay());
    };

    timer = setTimeout(tick, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        clearTimeout(timer);
        timer = setTimeout(tick, 250);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [preparing, fetchStatus, fetchCockpit, scope, jobHash]);

  const run = useCallback(async (action: () => Promise<CockpitView>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setView(next);
      setWorkerAvailable(next.workerAvailable ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDerive = (preferredArchetypeId?: string | null) =>
    run(() =>
      derive({ data: { ...scope, jobHash, preferredArchetypeId: preferredArchetypeId ?? null } }),
    );

  const handleSave = (
    artifactId: string,
    content: ArtifactContent,
    signals: LearningSignal[],
    approve = false,
  ) => {
    setApprovalBlockersByArtifact((current) => ({ ...current, [artifactId]: [] }));
    if (!approve) return run(() => saveArtifact({ data: { ...scope, jobHash, artifactId, content, signals, approve } }));
    return run(async () => {
      const result = await preflightApproval({ data: { ...scope, jobHash, artifactId, content } });
      if (!result.approvable) {
        setApprovalBlockersByArtifact((current) => ({ ...current, [artifactId]: result.blockers }));
        return view;
      }
      return saveArtifact({ data: { ...scope, jobHash, artifactId, content, signals, approve } });
    });
  };

  const handleExport = async (artifactId: string, format: "PDF" | "DOCX" | "TXT") => {
    setBusy(true);
    setError(null);
    try {
      const file = await exportArtifact({ data: { ...scope, jobHash, artifactId, format } });
      downloadBase64(file.filename, file.mimeType, file.base64);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const resume = view.artifacts.find((artifact) => artifact.artifactType === "RESUME");
  const interview = view.artifacts.find((artifact) => artifact.artifactType === "INTERVIEW_BRIEF");
  const hasStrategy = Boolean(view.thesis);
  // Package readiness is earned by the artifacts, not implied by generation.
  const readiness = (() => {
    const has = (t: string) => view.artifacts.some((a) => a.artifactType === t);
    const interviewReady =
      interview?.content.kind === "INTERVIEW_BRIEF" &&
      interview.content.brief.proofStories.length > 0 &&
      interview.content.brief.proofStories.every((s) => s.status === "READY");
    const checks = [hasStrategy, has("RESUME"), has("EXEC_NOTE"), interviewReady];
    return { done: checks.filter(Boolean).length, total: checks.length };
  })();

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/98 backdrop-blur">
      <div className="glass-header sticky top-0 z-10 border-b border-border">
        <div className="memo-container flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="label-mono text-muted-foreground">Pursuit cockpit</p>
            <p className="font-display text-xl leading-tight">
              {view.pursuit.roleTitle ?? "Role"}
              {view.pursuit.company ? ` · ${view.pursuit.company}` : ""}
            </p>
            <p className="label-mono mt-1 text-muted-foreground">
              Pursuit stage: {pursuitStatusLabels[view.pursuit.status]}{" "}
              · Package readiness {readiness.done}/{readiness.total} ·{" "}
              {view.ledgerCoverage.sourceBacked} verified claims from{" "}
              {view.ledgerCoverage.documents} document
              {view.ledgerCoverage.documents === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!resolved && (
              <button
                type="button"
                disabled={busy || preparing}
                onClick={() => handleDerive(view.pursuit.activeArchetypeId)}
                className="pursuit-chip pursuit-chip-primary"
              >
                {busy
                  ? "Working…"
                  : preparing
                    ? workerUnavailable
                      ? "Service unavailable"
                      : view.pursuit.preparationState === "DERIVING"
                      ? "Preparing package…"
                      : "Queued…"
                    : hasStrategy
                      ? "Regenerate strategy"
                      : "Derive strategy"}
              </button>
            )}
            {resolved ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateState({ data: { ...scope, jobHash, status: "READY" } }))}
                className="pursuit-chip pursuit-chip-primary"
              >
                Reopen pursuit
              </button>
            ) : (
              <div ref={resolveMenuRef} className="relative">
                <button
                  type="button"
                  disabled={busy || preparing}
                  aria-expanded={resolveOpen}
                  aria-haspopup="menu"
                  onClick={() => setResolveOpen((open) => !open)}
                  className="pursuit-chip"
                  title={preparing ? "Finish preparation before resolving this pursuit." : undefined}
                >
                  Resolve pursuit <span aria-hidden="true">{resolveOpen ? "▴" : "▾"}</span>
                </button>
                {resolveOpen && (
                  <div
                    role="menu"
                    aria-label="Resolve pursuit"
                    className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-background p-2 shadow-2xl"
                  >
                    <div className="px-2.5 pb-2 pt-1">
                      <p className="text-sm font-medium text-ink">Resolve pursuit</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        Move this pursuit out of your active working set. Nothing is deleted.
                      </p>
                    </div>
                    {([
                      ["CLOSED_WON", "Won", "You accepted or completed this opportunity."],
                      ["CLOSED_LOST", "Lost", "The opportunity ended without an accepted outcome."],
                      ["WITHDRAWN", "Withdrawn", "You chose to stop pursuing this opportunity."],
                    ] as const).map(([status, label, description]) => (
                      <button
                        key={status}
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => {
                          setResolveOpen(false);
                          void run(() =>
                            updateState({
                              data: { ...scope, jobHash, status, nextAction: null, nextActionDue: null },
                            }),
                          );
                        }}
                        className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent-ink/30"
                      >
                        <span className="block text-sm font-medium text-ink">{label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button type="button" onClick={onClose} className="pursuit-chip">
              Close
            </button>
          </div>
        </div>
        <div className="memo-container flex gap-1 overflow-x-auto pb-2">
          {SURFACES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSurface(item.key)}
              className={`pursuit-tab ${surface === item.key ? "pursuit-tab-active" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="memo-container py-6">
        {resolved && (
          <div className="memo-callout mb-5" role="status">
            <p className="text-sm font-medium">{pursuitStatusLabels[view.pursuit.status]}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This pursuit is resolved. Its strategy, artifacts and activity history remain available.
            </p>
          </div>
        )}
        {view.ledgerCoverage.total === 0 && (
          <div className="memo-callout mb-5">
            <p className="text-sm">
              No verified career evidence is available yet. Upload your CV versions on the profile
              page — every tailored document is built only from evidence we can trace back to them.
            </p>
          </div>
        )}
        {workerUnavailable && (
          <div className="memo-callout mb-5 border-l-amber-500" role="status" data-testid="pursuit-worker-unavailable">
            <p className="text-sm">
              {PURSUIT_WORKER_UNAVAILABLE_MESSAGE}
            </p>
          </div>
        )}
        {preparing && !workerUnavailable && (
          <div className="memo-callout mb-5">
            <p className="text-sm">
              {view.pursuit.preparationState === "DERIVING"
                ? "Your strategy, resume, outreach and interview brief are being prepared. This page updates on its own."
                : "Preparation is queued. You can close this and come back — nothing is lost."}
            </p>
          </div>
        )}
        {view.pursuit.preparationState === "FAILED" && view.pursuit.preparationError && (
          <div className="memo-callout mb-5 border-l-red-500">
            <p className="text-sm">Strategy derivation failed: {view.pursuit.preparationError}</p>
          </div>
        )}
        {error && (
          <div className="memo-callout mb-5 border-l-red-500">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {surface === "STRATEGY" && (
          <StrategyPanel
            view={view}
            busy={busy}
            onArchetypeChange={(archetypeId) => handleDerive(archetypeId)}
            onStatusChange={(status: PursuitStatus) =>
              run(() => updateState({ data: { ...scope, jobHash, status } }))
            }
            onNextAction={(nextAction, due) =>
              run(() =>
                updateState({
                  data: { ...scope, jobHash, nextAction, nextActionDue: due || null },
                }),
              )
            }
          />
        )}

        {surface === "RESUME" && (
          <ResumeStudio
            artifact={resume}
            claims={view.claims}
            busy={busy}
            approvalBlockers={resume ? approvalBlockersByArtifact[resume.id] ?? [] : []}
            onSave={(artifactId, content, signals, approve) =>
              handleSave(artifactId, content, signals, approve)
            }
            onExport={handleExport}
          />
        )}

        {surface === "OUTREACH" && (
          <OutreachKit
            artifacts={view.artifacts}
            busy={busy}
            approvalBlockersByArtifact={approvalBlockersByArtifact}
            onSave={(artifactId, content, signals, approve) =>
              handleSave(artifactId, content, signals, approve)
            }
            onExport={handleExport}
            onLogSent={(artifactId) =>
              run(() => markOutreachSent({ data: { ...scope, jobHash, artifactId } }))
            }
          />
        )}

        {surface === "INTERVIEW" && (
          <InterviewBriefPanel
            artifact={interview}
            busy={busy}
            approvalBlockers={interview ? approvalBlockersByArtifact[interview.id] ?? [] : []}
            onSave={(artifactId, content, signals, approve) =>
              handleSave(artifactId, content, signals, approve)
            }
            onExport={handleExport}
          />
        )}

        {view.activities.length > 0 && (
          <div className="memo-card mt-6">
            <p className="label-mono text-muted-foreground">Activity</p>
            <ul className="mt-2 space-y-1">
              {view.activities.slice(0, 8).map((activity) => (
                <li key={activity.id} className="text-xs text-muted-foreground">
                  {activity.occurredAt.slice(0, 16).replace("T", " ")} — {activity.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
