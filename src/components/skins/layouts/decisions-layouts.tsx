/**
 * Structural skin layouts for the pipeline page (/decisions).
 *
 * Presentation only. Every layout receives the same already-computed rows and
 * the same callbacks; none of them filters, sorts, decides, or fetches. The
 * page owns all data and behaviour — a layout just arranges it.
 *
 *   boardroom — financial ledger table, hairline rules, square corners
 *   signal    — dense flight-deck grid, fit meters, keyboard navigation
 *   atelier   — spacious editorial stack, quoted thesis, soft pills
 *   radar     — RADAR's own memo cards (unchanged default)
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { pursuitStatusLabels } from "@/pursuit/types";
import { DecisionBadge } from "@/components/radar/DecisionBadge";
import type { DecisionVerb } from "@/opportunity/contracts";

export interface DecisionsRow {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  scrapedFrom?: string;
  score: string;
  thesis: string;
  fit: number | null;
  verb: DecisionVerb | null;
  pursuitSummary?: {
    status: keyof typeof pursuitStatusLabels;
    preparationState: string;
    nextAction?: string | null;
    nextActionDue?: string | null;
  };
  applicationAction: { label: string; url: string } | null;
}

export interface DecisionsLayoutProps {
  rows: DecisionsRow[];
  scope: { tenantId?: string; personId?: string };
  displayedCount: number;
  totalCount: number;
  pursuitPending: boolean;
  onUndo: (jobHash: string) => void;
  onLaunchPursuit: (jobHash: string) => void;
}

function PursuitSummary({ row }: { row: DecisionsRow }) {
  if (row.verb !== "PURSUE") return null;
  const summary = row.pursuitSummary;
  return (
    <div className="mt-2 text-xs text-ink-muted" data-testid={`pursuit-summary-${row.jobHash}`}>
      {summary ? (
        <>
          <p>{pursuitStatusLabels[summary.status]}</p>
          {summary.preparationState !== "READY" && (
            <p>Preparation: {summary.preparationState.toLowerCase()}</p>
          )}
          {summary.nextAction && <p>Next: {summary.nextAction}</p>}
          {summary.nextActionDue && <p>Due: {summary.nextActionDue}</p>}
        </>
      ) : (
        <p role="status">
          Pursuit workspace unavailable. Open the opportunity to review this decision.
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Boardroom --- */

export function BoardroomLedgerLayout({
  rows,
  scope,
  displayedCount,
  totalCount,
  pursuitPending,
  onUndo,
  onLaunchPursuit,
}: DecisionsLayoutProps) {
  return (
    <div data-testid="opportunities-list" data-layout="boardroom">
      <div className="flex items-baseline justify-between border-b-2 border-ink pb-2 text-[0.62rem] font-mono uppercase tracking-[0.18em] text-ink-muted">
        <span>Schedule I — Mandates under consideration</span>
        <span>
          {displayedCount} of {totalCount}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] table-fixed border-collapse text-left align-top">
          <thead>
            <tr className="text-[0.58rem] font-mono uppercase tracking-[0.18em] text-ink-muted">
              <th className="w-8 border-b border-hairline py-2 pr-2 font-normal">#</th>
              <th className="w-24 border-b border-hairline py-2 pr-3 font-normal">Verdict</th>
              <th className="w-44 border-b border-hairline py-2 pr-3 font-normal">Company</th>
              <th className="border-b border-hairline py-2 pr-3 font-normal">Role</th>
              <th className="hidden border-b border-hairline py-2 pr-3 font-normal md:table-cell">
                Thesis
              </th>
              <th className="w-32 border-b border-hairline py-2 text-right font-normal">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.jobHash}
                className="align-top transition-colors hover:bg-surface-raised"
                data-testid={`opportunity-card-${row.jobHash}`}
              >
                <td className="border-b border-hairline py-4 pr-2 font-mono text-[0.7rem] text-ink-muted">
                  {String(index + 1).padStart(2, "0")}
                </td>
                <td className="border-b border-hairline py-4 pr-3">
                  {row.verb ? (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink">
                      {row.verb}
                    </span>
                  ) : (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink-muted">
                      —
                    </span>
                  )}
                  <span className="mt-1 block font-mono text-[0.58rem] text-ink-muted">
                    {row.score}
                  </span>
                </td>
                <td className="border-b border-hairline py-4 pr-3">
                  <span className="block text-sm font-semibold text-ink">{row.company}</span>
                  <span className="block text-[0.68rem] text-ink-muted">{row.location}</span>
                  <PursuitSummary row={row} />
                </td>
                <td className="border-b border-hairline py-4 pr-3">
                  <Link
                    to="/opportunity/$jobHash"
                    params={{ jobHash: row.jobHash }}
                    search={scope}
                    className="font-serif text-[1.05rem] leading-snug text-ink hover:underline"
                    data-testid={`opportunity-role-link-${row.jobHash}`}
                  >
                    {row.role}
                  </Link>
                  {row.scrapedFrom && (
                    <span className="mt-1 block font-mono text-[0.56rem] uppercase tracking-[0.16em] text-ink-muted">
                      {row.scrapedFrom}
                    </span>
                  )}
                </td>
                <td className="hidden border-b border-hairline py-4 pr-3 md:table-cell">
                  <p className="max-w-[26rem] text-[0.78rem] leading-relaxed text-ink-muted">
                    {row.thesis}
                  </p>
                </td>
                <td className="border-b border-hairline py-4 text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    <Link
                      to="/opportunity/$jobHash"
                      params={{ jobHash: row.jobHash }}
                      search={scope}
                      className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-ink underline decoration-hairline-strong underline-offset-4 hover:text-accent-ink"
                      data-testid={`open-opportunity-btn-${row.jobHash}`}
                    >
                      Open memo
                    </Link>
                    {row.verb === "PURSUE" && row.pursuitSummary && (
                      <>
                        <button
                          type="button"
                          disabled={pursuitPending}
                          onClick={() => onLaunchPursuit(row.jobHash)}
                          className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-decision-pursue underline decoration-hairline-strong underline-offset-4 disabled:opacity-50"
                          data-testid={`pursuit-cockpit-btn-${row.jobHash}`}
                        >
                          {pursuitPending ? "Opening…" : "Cockpit"}
                        </button>
                        <Link
                          to="/pursuit/$jobHash"
                          params={{ jobHash: row.jobHash }}
                          className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-ink-muted hover:text-ink"
                          data-testid={`pursuit-page-link-${row.jobHash}`}
                        >
                          As page
                        </Link>
                      </>
                    )}
                    {row.verb === "PURSUE" && row.applicationAction && (
                      <a
                        href={row.applicationAction.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-decision-pursue hover:underline"
                      >
                        {row.applicationAction.label} ↗
                      </a>
                    )}
                    {row.verb && (
                      <button
                        type="button"
                        onClick={() => onUndo(row.jobHash)}
                        className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-ink-muted hover:text-ink"
                        data-testid={`undo-btn-${row.jobHash}`}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Signal --- */

function FitMeter({ fit }: { fit: number | null }) {
  if (fit === null)
    return <span className="font-mono text-[0.6rem] text-ink-muted">□□□□□ n/a</span>;
  const filled = Math.max(0, Math.min(5, Math.round(fit / 20)));
  return (
    <span className="font-mono text-[0.6rem] text-accent-ink">
      {"■".repeat(filled)}
      <span className="text-ink-muted">{"□".repeat(5 - filled)}</span>
      <span className="ml-1.5 text-ink-muted">{fit}%</span>
    </span>
  );
}

export function SignalGridLayout({
  rows,
  scope,
  displayedCount,
  totalCount,
  pursuitPending,
  onUndo,
  onLaunchPursuit,
}: DecisionsLayoutProps) {
  const [cursor, setCursor] = useState(0);
  const navigateRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable=true]")) return;
      if (!rows.length) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "j") {
        event.preventDefault();
        setCursor((value) => Math.min(rows.length - 1, value + 1));
      } else if (key === "k") {
        event.preventDefault();
        setCursor((value) => Math.max(0, value - 1));
      } else if (key === "o") {
        navigateRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows.length]);

  useEffect(() => {
    if (cursor > rows.length - 1) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  return (
    <div data-testid="opportunities-list" data-layout="signal">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-hairline bg-surface-raised px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-ink-muted">
        <span>
          PIPELINE {String(displayedCount).padStart(2, "0")}/{String(totalCount).padStart(2, "0")}
        </span>
        <span className="text-accent-ink">J/K move · O open · sorted by recency</span>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row, index) => {
          const active = index === cursor;
          return (
            <div
              key={row.jobHash}
              onMouseEnter={() => setCursor(index)}
              className={`border bg-surface-raised p-2.5 transition-colors ${
                active ? "border-accent-ink" : "border-hairline"
              }`}
              data-testid={`opportunity-card-${row.jobHash}`}
            >
              <div className="flex items-center justify-between font-mono text-[0.58rem] uppercase tracking-[0.14em]">
                <span className={row.verb ? "text-accent-ink" : "text-ink-muted"}>
                  [{row.verb || "UNREVIEWED"}] #{String(index + 1).padStart(2, "0")}
                </span>
                {row.scrapedFrom && <span className="text-ink-muted">{row.scrapedFrom}</span>}
              </div>

              <Link
                ref={active ? navigateRef : undefined}
                to="/opportunity/$jobHash"
                params={{ jobHash: row.jobHash }}
                search={scope}
                className="mt-2 block font-mono text-[0.82rem] font-semibold leading-tight text-ink hover:text-accent-ink"
                data-testid={`opportunity-role-link-${row.jobHash}`}
              >
                {row.role}
              </Link>

              <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-muted">
                {row.company} · {row.location}
              </p>
              <PursuitSummary row={row} />

              <div className="mt-2 border-t border-hairline pt-1.5">
                <FitMeter fit={row.fit} />
              </div>

              <p className="mt-1.5 line-clamp-3 text-[0.68rem] leading-snug text-ink-muted">
                {row.thesis}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hairline pt-1.5 font-mono text-[0.58rem] uppercase tracking-[0.14em]">
                <Link
                  to="/opportunity/$jobHash"
                  params={{ jobHash: row.jobHash }}
                  search={scope}
                  className="text-ink hover:text-accent-ink"
                  data-testid={`open-opportunity-btn-${row.jobHash}`}
                >
                  [OPEN]
                </Link>
                {row.verb === "PURSUE" && row.pursuitSummary && (
                  <>
                    <button
                      type="button"
                      disabled={pursuitPending}
                      onClick={() => onLaunchPursuit(row.jobHash)}
                      className="text-decision-pursue disabled:opacity-50"
                      data-testid={`pursuit-cockpit-btn-${row.jobHash}`}
                    >
                      [COCKPIT]
                    </button>
                    <Link
                      to="/pursuit/$jobHash"
                      params={{ jobHash: row.jobHash }}
                      className="text-ink-muted hover:text-ink"
                      data-testid={`pursuit-page-link-${row.jobHash}`}
                    >
                      [PAGE]
                    </Link>
                  </>
                )}
                {row.verb === "PURSUE" && row.applicationAction && (
                  <a
                    href={row.applicationAction.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-decision-pursue hover:underline"
                  >
                    [APPLY]
                  </a>
                )}
                {row.verb && (
                  <button
                    type="button"
                    onClick={() => onUndo(row.jobHash)}
                    className="ml-auto text-ink-muted hover:text-ink"
                    data-testid={`undo-btn-${row.jobHash}`}
                  >
                    [UNDO]
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Atelier --- */

export function AtelierStackLayout({
  rows,
  scope,
  displayedCount,
  totalCount,
  pursuitPending,
  onUndo,
  onLaunchPursuit,
}: DecisionsLayoutProps) {
  const pursueCount = rows.filter((row) => row.verb === "PURSUE").length;

  return (
    <div className="mx-auto max-w-[860px]" data-testid="opportunities-list" data-layout="atelier">
      <p className="text-center font-serif text-[1.05rem] italic text-ink-muted">
        {pursueCount > 0
          ? `This week, ${pursueCount === 1 ? "one deserves" : `${pursueCount} deserve`} you.`
          : "Nothing yet demands your attention."}
      </p>
      <p className="mt-1 text-center font-mono text-[0.58rem] uppercase tracking-[0.2em] text-ink-muted">
        {displayedCount} of {totalCount} in view
      </p>

      <div className="mt-10 space-y-10">
        {rows.map((row) => (
          <article
            key={row.jobHash}
            className="relative rounded-3xl border border-hairline bg-surface-raised px-8 py-9 sm:px-12"
            data-testid={`opportunity-card-${row.jobHash}`}
          >
            <div className="absolute right-6 top-6 flex h-16 w-16 items-center justify-center rounded-full border border-accent-ink/40 text-center font-mono text-[0.5rem] uppercase leading-tight tracking-[0.12em] text-accent-ink">
              {row.verb || "UN\u00ADREVIEWED"}
            </div>

            <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-ink-muted">
              {row.company} · {row.location}
            </p>
            <PursuitSummary row={row} />

            <h3 className="mt-3 max-w-[32rem] font-serif text-[2rem] font-normal leading-[1.08] tracking-tight text-ink">
              <Link
                to="/opportunity/$jobHash"
                params={{ jobHash: row.jobHash }}
                search={scope}
                className="hover:text-accent-ink"
                data-testid={`opportunity-role-link-${row.jobHash}`}
              >
                {row.role}
              </Link>
            </h3>

            <blockquote className="mt-5 border-l-2 border-accent-ink/30 pl-5 font-serif text-[1.08rem] italic leading-relaxed text-ink-muted">
              “{row.thesis}”
            </blockquote>

            <p className="mt-5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-ink-muted">
              {row.score}
              {row.scrapedFrom ? ` · ${row.scrapedFrom}` : ""}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/opportunity/$jobHash"
                params={{ jobHash: row.jobHash }}
                search={scope}
                className="rounded-full border border-ink/20 bg-background px-5 py-2 text-xs font-medium tracking-wide text-ink transition-colors hover:border-accent-ink hover:text-accent-ink"
                data-testid={`open-opportunity-btn-${row.jobHash}`}
              >
                Read the memo
              </Link>
              {row.verb === "PURSUE" && row.pursuitSummary && (
                <>
                  <button
                    type="button"
                    disabled={pursuitPending}
                    onClick={() => onLaunchPursuit(row.jobHash)}
                    className="rounded-full border border-decision-pursue px-5 py-2 text-xs font-medium tracking-wide text-decision-pursue transition-colors hover:bg-decision-pursue hover:text-white disabled:opacity-50"
                    data-testid={`pursuit-cockpit-btn-${row.jobHash}`}
                  >
                    {pursuitPending ? "Opening…" : "Open the cockpit"}
                  </button>
                  <Link
                    to="/pursuit/$jobHash"
                    params={{ jobHash: row.jobHash }}
                    className="text-xs tracking-wide text-ink-muted underline underline-offset-4 hover:text-ink"
                    data-testid={`pursuit-page-link-${row.jobHash}`}
                  >
                    Open as page
                  </Link>
                </>
              )}
              {row.verb === "PURSUE" && row.applicationAction && (
                <a
                  href={row.applicationAction.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs tracking-wide text-decision-pursue underline underline-offset-4"
                >
                  {row.applicationAction.label} ↗
                </a>
              )}
              {row.verb && (
                <button
                  type="button"
                  onClick={() => onUndo(row.jobHash)}
                  className="ml-auto text-xs tracking-wide text-ink-muted underline underline-offset-4 hover:text-ink"
                  data-testid={`undo-btn-${row.jobHash}`}
                >
                  Undo
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- RADAR --- */

export function RadarCardsLayout({
  rows,
  scope,
  displayedCount,
  totalCount,
  pursuitPending,
  onUndo,
  onLaunchPursuit,
}: DecisionsLayoutProps) {
  return (
    <div className="space-y-5" data-testid="opportunities-list" data-layout="radar">
      <div className="flex items-center justify-between border-b border-hairline pb-2 font-mono text-xs uppercase tracking-wider text-ink-muted">
        <span>
          Displaying {displayedCount} of {totalCount} mandates
        </span>
        <span>Sorted by Pipeline Recency</span>
      </div>

      {rows.map((row) => (
        <div
          key={row.jobHash}
          className="memo-card border border-border bg-surface-raised p-6 rounded-md transition-all hover:border-border-strong"
          data-testid={`opportunity-card-${row.jobHash}`}
        >
          {/* Top Row: Primary Designation Identity + Decision Controls */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {/* PRIMARY IDENTITY HEADER: Designation / Role Title */}
              <h3 className="font-serif text-[1.65rem] leading-[1.1] text-ink tracking-tight font-normal">
                <Link
                  to="/opportunity/$jobHash"
                  params={{ jobHash: row.jobHash }}
                  search={scope}
                  className="hover:underline hover:text-accent-ink transition-colors"
                  data-testid={`opportunity-role-link-${row.jobHash}`}
                >
                  {row.role}
                </Link>
              </h3>

              {/* SECONDARY IDENTITY: Organisation + Location + Source */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span className="font-semibold text-ink">{row.company}</span>
                <span className="text-hairline-strong">·</span>
                <span>{row.location}</span>
                {row.scrapedFrom && (
                  <>
                    <span className="text-hairline-strong">·</span>
                    <span className="text-ink-muted/80">{row.scrapedFrom}</span>
                  </>
                )}
                <span className="text-hairline-strong">·</span>
                <span className="font-mono uppercase tracking-[0.14em] text-[0.62rem] text-accent-ink/90 bg-accent-ink/5 px-2 py-0.5 rounded-sm">
                  {row.score}
                </span>
              </div>
            </div>

            {/* Right-aligned Decision Badge & Controls */}
            <div className="flex items-center gap-3 shrink-0">
              {row.verb ? (
                <DecisionBadge verb={row.verb} size="sm" />
              ) : (
                <span className="text-[0.62rem] font-mono uppercase tracking-[0.14em] text-ink-muted bg-surface/80 border border-hairline px-2.5 py-1 rounded-sm">
                  UNREVIEWED
                </span>
              )}

              {/* OPEN OPPORTUNITY Button */}
              <Link
                to="/opportunity/$jobHash"
                params={{ jobHash: row.jobHash }}
                search={scope}
                className="rounded-sm border border-border px-3 py-1 label-mono text-xs text-ink hover:bg-background hover:text-accent-ink transition-colors"
                data-testid={`open-opportunity-btn-${row.jobHash}`}
              >
                Open
              </Link>

              {/* UNDO Button */}
              {row.verb && (
                <button
                  type="button"
                  onClick={() => onUndo(row.jobHash)}
                  className="rounded-sm border border-hairline px-3 py-1 label-mono text-xs text-ink-muted hover:bg-background hover:text-ink transition-colors"
                  data-testid={`undo-btn-${row.jobHash}`}
                >
                  Undo
                </button>
              )}
            </div>
          </div>

          {row.verb === "PURSUE" && (
            <div
              className="border-t border-hairline mt-5 pt-3"
              data-testid={`pursuit-summary-${row.jobHash}`}
            >
              {row.pursuitSummary ? (
                <>
                  <p className="text-sm text-ink">
                    {pursuitStatusLabels[row.pursuitSummary.status]}
                  </p>
                  {row.pursuitSummary.preparationState !== "READY" && (
                    <p className="text-xs text-ink-muted">
                      Preparation: {row.pursuitSummary.preparationState.toLowerCase()}
                    </p>
                  )}
                  {row.pursuitSummary.nextAction && (
                    <p className="mt-1 text-sm text-ink-muted">
                      Next: {row.pursuitSummary.nextAction}
                    </p>
                  )}
                  {row.pursuitSummary.nextActionDue && (
                    <p className="text-xs text-ink-muted">
                      Due: {row.pursuitSummary.nextActionDue}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      type="button"
                      disabled={pursuitPending}
                      onClick={() => onLaunchPursuit(row.jobHash)}
                      className="rounded-sm border border-decision-pursue px-3 py-1 label-mono text-xs text-decision-pursue hover:bg-decision-pursue hover:text-white transition-colors disabled:opacity-50"
                      data-testid={`pursuit-cockpit-btn-${row.jobHash}`}
                    >
                      {pursuitPending ? "Opening…" : "Open pursuit"}
                    </button>
                    <Link
                      to="/pursuit/$jobHash"
                      params={{ jobHash: row.jobHash }}
                      className="label-mono text-xs text-accent-ink hover:underline"
                      data-testid={`pursuit-page-link-${row.jobHash}`}
                    >
                      Open as page
                    </Link>
                  </div>
                </>
              ) : (
                <p role="status" className="text-sm text-decision-consider">
                  Pursuit workspace unavailable. Open the opportunity to review this decision.
                </p>
              )}
            </div>
          )}

          {row.verb === "PURSUE" && row.applicationAction && (
            <div className="flex items-center gap-4 border-t border-hairline mt-5 pt-3">
              <a
                href={row.applicationAction.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs uppercase tracking-[0.14em] font-mono text-decision-pursue hover:underline"
              >
                {row.applicationAction.label} ↗
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ selector --- */

export const DECISIONS_LAYOUTS = {
  radar: RadarCardsLayout,
  iphone: RadarCardsLayout,
  boardroom: BoardroomLedgerLayout,
  signal: SignalGridLayout,
  atelier: AtelierStackLayout,
} as const;
