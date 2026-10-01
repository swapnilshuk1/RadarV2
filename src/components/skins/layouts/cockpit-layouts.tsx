/**
 * Structural skin shells for the Pursuit Cockpit.
 *
 * Presentation only. The cockpit owns every server call, every piece of state
 * and every panel; a shell receives the already-built panel as children plus
 * plain descriptive values, and arranges the chrome around them.
 *
 *   boardroom — memorandum workspace, roman index rail, ruled header
 *   signal    — flight-deck studio, bracketed tab strip, telemetry column
 *   atelier    — private suite, emerald hero banner, centred pill tabs
 *   radar     — RADAR's own cockpit header and tabs, unchanged
 */

import type { ReactNode } from "react";
import type { SkinId } from "../skin";

export interface CockpitSurface {
  key: string;
  label: string;
}

export interface CockpitShellProps {
  title: string;
  company: string;
  /** Human sentence about stage, readiness and evidence coverage. */
  statusLine: string;
  stageLabel: string;
  readiness: { done: number; total: number };
  coverage: { sourceBacked: number; total: number; documents: number };
  surfaces: CockpitSurface[];
  activeSurface: string;
  onSelectSurface: (key: string) => void;
  primaryAction: { label: string; disabled: boolean; onClick: () => void } | null;
  /** Lifecycle controls remain owned by the cockpit. */
  secondaryActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

function meter(done: number, total: number) {
  const blocks = Math.max(total, 1);
  return Array.from({ length: blocks }, (_, i) => (i < done ? "■" : "□")).join("");
}

/* ----------------------------------------------------------- Boardroom --- */

function BoardroomCockpitShell(props: CockpitShellProps) {
  return (
    <div
      data-pursuit-cockpit
      data-layout="boardroom"
      className="fixed inset-0 z-50 overflow-y-auto bg-background skin-cockpit-boardroom"
    >
      <div className="sticky top-0 z-10 border-b-2 border-ink bg-background px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.58rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
              Pursuit memorandum
            </p>
            <p className="font-serif text-xl leading-tight">
              {props.title}
              {props.company ? ` · ${props.company}` : ""}
            </p>
          </div>
          <div className="text-right text-[0.6rem] font-mono uppercase tracking-[0.16em] text-ink-muted">
            <p>Stage: {props.stageLabel}</p>
            <p>
              Package {props.readiness.done}/{props.readiness.total}
            </p>
            <p>
              {props.coverage.sourceBacked} verified claims · {props.coverage.documents} document
              {props.coverage.documents === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 px-4 py-6 md:grid-cols-[14rem_1fr] md:px-8">
        <aside className="md:sticky md:top-24 md:self-start">
          <p className="text-[0.58rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
            Contents
          </p>
          <ol className="mt-2 space-y-1">
            {props.surfaces.map((surface, index) => (
              <li key={surface.key}>
                <button
                  type="button"
                  onClick={() => props.onSelectSurface(surface.key)}
                  aria-pressed={props.activeSurface === surface.key}
                  className="flex w-full gap-2 border-b border-hairline px-1 py-2 text-left text-sm transition-colors hover:bg-surface-raised aria-pressed:font-semibold"
                >
                  <span className="font-mono text-xs text-ink-muted">{ROMAN[index]}.</span>
                  <span>{surface.label}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-col gap-1">
            {props.primaryAction && (
              <button
                type="button"
                disabled={props.primaryAction.disabled}
                onClick={props.primaryAction.onClick}
                className="border border-ink bg-ink px-3 py-2 text-[0.66rem] font-mono uppercase tracking-[0.14em] text-[var(--parchment)] disabled:opacity-50"
              >
                {props.primaryAction.label}
              </button>
            )}
            {props.secondaryActions}
            <button
              type="button"
              onClick={props.onClose}
              className="border border-hairline px-3 py-2 text-[0.66rem] font-mono uppercase tracking-[0.14em]"
            >
              Close
            </button>
          </div>
        </aside>
        <div className="min-w-0">{props.children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Signal --- */

function SignalCockpitShell(props: CockpitShellProps) {
  return (
    <div
      data-pursuit-cockpit
      data-layout="signal"
      className="fixed inset-0 z-50 overflow-y-auto bg-background skin-cockpit-signal"
    >
      <div className="sticky top-0 z-10 border-b border-hairline bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] md:px-6">
          <span className="text-ink-muted">pursuit //</span>
          <span>{props.title}</span>
          <span className="text-ink-muted">@ {props.company || "—"}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {props.primaryAction && (
              <button
                type="button"
                disabled={props.primaryAction.disabled}
                onClick={props.primaryAction.onClick}
                className="border border-hairline px-2 py-1 hover:bg-surface-raised disabled:opacity-50"
              >
                [{props.primaryAction.label}]
              </button>
            )}
            {props.secondaryActions}
            <button
              type="button"
              onClick={props.onClose}
              className="border border-hairline px-2 py-1 hover:bg-surface-raised"
            >
              [CLOSE]
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] md:px-6">
          {props.surfaces.map((surface, index) => (
            <button
              key={surface.key}
              type="button"
              onClick={() => props.onSelectSurface(surface.key)}
              aria-pressed={props.activeSurface === surface.key}
              className="whitespace-nowrap border border-hairline px-2 py-1 transition-colors hover:bg-surface-raised aria-pressed:bg-ink aria-pressed:text-[var(--parchment)]"
            >
              [{index + 1}:{surface.label.toUpperCase()}]
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_15rem] md:px-6">
        <div className="min-w-0 border border-hairline p-3 md:p-4">{props.children}</div>
        <aside className="space-y-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] md:sticky md:top-28 md:self-start">
          <div className="border border-hairline px-3 py-2">
            <p className="text-ink-muted">stage</p>
            <p className="mt-1 text-sm normal-case tracking-normal">{props.stageLabel}</p>
          </div>
          <div className="border border-hairline px-3 py-2">
            <p className="text-ink-muted">readiness</p>
            <p className="mt-1 text-sm">
              {meter(props.readiness.done, props.readiness.total)} {props.readiness.done}/
              {props.readiness.total}
            </p>
          </div>
          <div className="border border-hairline px-3 py-2">
            <p className="text-ink-muted">evidence</p>
            <p className="mt-1 text-sm">
              {props.coverage.sourceBacked}/{props.coverage.total} verified
            </p>
            <p className="text-ink-muted">
              {props.coverage.documents} doc{props.coverage.documents === 1 ? "" : "s"}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Atelier --- */

function AtelierCockpitShell(props: CockpitShellProps) {
  return (
    <div
      data-pursuit-cockpit
      data-layout="atelier"
      className="fixed inset-0 z-50 overflow-y-auto bg-background skin-cockpit-atelier"
    >
      <div className="mx-auto max-w-5xl px-5 py-8 md:px-10">
        <div className="rounded-3xl bg-ink px-6 py-7 text-[var(--parchment)] md:px-9">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] opacity-70">Your next move</p>
          <h1 className="mt-2 font-serif text-2xl leading-tight md:text-3xl">
            {props.title}
            {props.company ? <span className="opacity-70"> · {props.company}</span> : null}
          </h1>
          <p className="mt-3 max-w-xl text-sm opacity-80">{props.statusLine}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {props.primaryAction && (
              <button
                type="button"
                disabled={props.primaryAction.disabled}
                onClick={props.primaryAction.onClick}
                className="rounded-full bg-[var(--skin-accent)] px-5 py-2 text-sm font-medium text-[var(--skin-accent-fg)] disabled:opacity-50"
              >
                {props.primaryAction.label}
              </button>
            )}
            {props.secondaryActions}
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-full border border-surface/40 px-5 py-2 text-sm"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {props.surfaces.map((surface) => (
            <button
              key={surface.key}
              type="button"
              onClick={() => props.onSelectSurface(surface.key)}
              aria-pressed={props.activeSurface === surface.key}
              className="rounded-full border border-hairline px-5 py-2 text-sm transition-colors hover:bg-accent/10 aria-pressed:bg-[var(--skin-accent)] aria-pressed:text-ink"
            >
              {surface.label}
            </button>
          ))}
        </div>

        <div className="mt-7 rounded-3xl bg-surface-raised/60 p-4 md:p-7">{props.children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Radar --- */

function RadarCockpitShell(props: CockpitShellProps) {
  return (
    <div
      data-pursuit-cockpit
      data-layout="radar"
      className="fixed inset-0 z-50 overflow-y-auto bg-background/98 backdrop-blur"
    >
      <div className="glass-header sticky top-0 z-10 border-b border-border">
        <div className="memo-container flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="label-mono text-muted-foreground">Pursuit cockpit</p>
            <p className="font-display text-xl leading-tight">
              {props.title}
              {props.company ? ` · ${props.company}` : ""}
            </p>
            <p className="label-mono mt-1 text-muted-foreground">{props.statusLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {props.primaryAction && (
              <button
                type="button"
                disabled={props.primaryAction.disabled}
                onClick={props.primaryAction.onClick}
                className="pursuit-chip pursuit-chip-primary"
              >
                {props.primaryAction.label}
              </button>
            )}
            {props.secondaryActions}
            <button type="button" onClick={props.onClose} className="pursuit-chip">
              Close
            </button>
          </div>
        </div>
        <div className="memo-container flex gap-1 overflow-x-auto pb-2">
          {props.surfaces.map((surface) => (
            <button
              key={surface.key}
              type="button"
              onClick={() => props.onSelectSurface(surface.key)}
              className={`pursuit-tab ${props.activeSurface === surface.key ? "pursuit-tab-active" : ""}`}
            >
              {surface.label}
            </button>
          ))}
        </div>
      </div>
      <div className="memo-container py-6">{props.children}</div>
    </div>
  );
}

export const COCKPIT_SHELLS: Record<SkinId, (props: CockpitShellProps) => ReactNode> = {
  radar: RadarCockpitShell,
  iphone: RadarCockpitShell,
  boardroom: BoardroomCockpitShell,
  signal: SignalCockpitShell,
  atelier: AtelierCockpitShell,
};
