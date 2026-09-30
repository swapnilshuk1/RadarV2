/**
 * Structural skin shells for the opportunity memo (/opportunity/$jobHash).
 *
 * Presentation only. The memo itself (DossierView) is passed in as children and
 * is never rewritten by a shell: a shell arranges chrome around it — rails,
 * telemetry, seals, hotkey strips — and forwards the page's own callbacks.
 *
 *   boardroom — two-column investment memorandum, roman rail, action stack
 *   signal    — terminal HUD across the top, hotkey decision strip at the base
 *   atelier   — centred advisory paper, circular verdict seal, editorial kicker
 *   radar     — RADAR's own memo, unchanged
 */

import { useEffect, type ReactNode } from "react";
import type { SkinId } from "../skin";

export type MemoVerb = "PURSUE" | "CONSIDER" | "PASS";

export interface MemoShellProps {
  role: string;
  company: string;
  location?: string;
  /** Engine verdict as shown to the user, e.g. PURSUE / CONSIDER / PASS. */
  verdict: string;
  /** Fit index 0-100 when known. */
  fit: number | null;
  evidenceCount: number;
  openQuestions: number;
  /** Short proof lines for the boardroom rail; already user-facing prose. */
  proofPoints?: string[];
  selectedVerb?: MemoVerb | string | null;
  decisionPending?: boolean;
  onDecide?: (verb: MemoVerb) => void;
  children: ReactNode;
}

const VERBS: MemoVerb[] = ["PURSUE", "CONSIDER", "PASS"];
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi"];

/* ----------------------------------------------------------- Boardroom --- */

function BoardroomMemoShell(props: MemoShellProps) {
  const { role, company, location, verdict, fit, evidenceCount, openQuestions } = props;
  const proofs = (props.proofPoints ?? []).slice(0, 4);
  return (
    <div data-layout="boardroom" className="skin-memo-boardroom">
      <div className="border-b-2 border-ink px-4 pb-2 pt-4 md:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[0.6rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
          <span>Memorandum — investment committee</span>
          <span>
            Verdict: {verdict}
            {fit !== null ? ` · Fit ${fit}%` : ""}
          </span>
        </div>
      </div>
      <div className="grid gap-8 px-4 py-6 md:grid-cols-[15rem_1fr] md:px-8">
        <aside className="space-y-6 md:sticky md:top-20 md:self-start">
          <div>
            <p className="text-[0.58rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
              Subject
            </p>
            <p className="mt-1 font-serif text-lg leading-snug">{role}</p>
            <p className="text-sm text-ink-muted">
              {company}
              {location ? ` · ${location}` : ""}
            </p>
          </div>
          {proofs.length > 0 && (
            <div>
              <p className="text-[0.58rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
                Proof points
              </p>
              <ol className="mt-2 space-y-2">
                {proofs.map((proof, index) => (
                  <li key={index} className="flex gap-2 text-sm leading-snug">
                    <span className="font-mono text-xs text-ink-muted">{ROMAN[index]}.</span>
                    <span>{proof}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="border-t border-hairline pt-3">
            <p className="text-[0.58rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
              Record
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Evidence</dt>
                <dd className="font-mono">{evidenceCount}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Open questions</dt>
                <dd className="font-mono">{openQuestions}</dd>
              </div>
            </dl>
          </div>
          {props.onDecide && (
            <div className="border-t border-hairline pt-3">
              <p className="text-[0.58rem] font-mono uppercase tracking-[0.2em] text-ink-muted">
                Resolution
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {VERBS.map((verb) => (
                  <button
                    key={verb}
                    type="button"
                    aria-pressed={props.selectedVerb === verb}
                    disabled={props.decisionPending}
                    onClick={() => props.onDecide?.(verb)}
                    className="border border-hairline px-3 py-2 text-left text-[0.68rem] font-mono uppercase tracking-[0.14em] transition-colors hover:bg-surface-raised disabled:opacity-50 aria-pressed:bg-ink aria-pressed:text-[var(--parchment)]"
                  >
                    {verb}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
        <div className="min-w-0">{props.children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Signal --- */

function SignalMemoShell(props: MemoShellProps) {
  const { verdict, fit, evidenceCount, openQuestions, onDecide, decisionPending } = props;

  useEffect(() => {
    if (!onDecide || decisionPending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (document.querySelector("[data-pursuit-cockpit], [role='dialog']")) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === "p") onDecide("PURSUE");
      else if (key === "c") onDecide("CONSIDER");
      else if (key === "x") onDecide("PASS");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDecide, decisionPending]);

  const cell = (label: string, value: string) => (
    <div className="border border-hairline px-3 py-2">
      <p className="text-[0.55rem] font-mono uppercase tracking-[0.2em] text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-sm">{value}</p>
    </div>
  );

  return (
    <div data-layout="signal" className="skin-memo-signal pb-16">
      <div className="grid grid-cols-2 gap-2 px-4 py-4 md:grid-cols-4 md:px-8">
        {cell("verdict", `[${verdict}]`)}
        {cell("fit", fit !== null ? `${fit}%` : "—")}
        {cell("evidence", String(evidenceCount))}
        {cell("open qs", String(openQuestions))}
      </div>
      <div className="px-4 pb-6 md:px-8">
        <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-muted">
          ▼ memo · {props.role} @ {props.company}
        </div>
        <div className="border border-hairline p-3 md:p-5">{props.children}</div>
      </div>
      {onDecide && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-background/95 px-4 py-2 backdrop-blur md:px-8">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[0.62rem] uppercase tracking-[0.16em]">
            <span className="text-ink-muted">decide</span>
            {VERBS.map((verb) => (
              <button
                key={verb}
                type="button"
                aria-pressed={props.selectedVerb === verb}
                disabled={decisionPending}
                onClick={() => onDecide(verb)}
                className="border border-hairline px-2 py-1 transition-colors hover:bg-surface-raised disabled:opacity-50 aria-pressed:bg-ink aria-pressed:text-[var(--parchment)]"
              >
                [{verb === "PASS" ? "X" : verb[0]}] {verb}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Atelier --- */

function AtelierMemoShell(props: MemoShellProps) {
  const { role, company, verdict, fit, evidenceCount, openQuestions, onDecide } = props;
  return (
    <div data-layout="atelier" className="skin-memo-atelier">
      <div className="mx-auto max-w-4xl px-5 py-10 md:px-10">
        <div className="relative">
          <div className="absolute right-0 top-0 hidden h-24 w-24 flex-col items-center justify-center rounded-full border border-accent/50 bg-accent/10 text-center md:flex">
            <span className="text-[0.52rem] uppercase tracking-[0.18em] text-ink-muted">
              Verdict
            </span>
            <span className="font-serif text-base leading-tight">{verdict}</span>
            {fit !== null && <span className="text-[0.6rem] text-ink-muted">{fit}% fit</span>}
          </div>
          <p className="font-serif text-sm italic text-ink-muted">
            A private note on one opportunity.
          </p>
          <h1 className="mt-3 max-w-2xl font-serif text-3xl leading-tight md:text-4xl">{role}</h1>
          <p className="mt-2 text-sm text-ink-muted">{company}</p>
          <p className="mt-6 max-w-2xl text-sm text-ink-muted">
            {evidenceCount} pieces of evidence considered · {openQuestions} question
            {openQuestions === 1 ? "" : "s"} still open.
          </p>
        </div>

        <div className="mt-8 rounded-3xl bg-surface-raised/60 p-4 md:p-8">{props.children}</div>

        {onDecide && (
          <div className="mt-8 text-center">
            <p className="font-serif text-sm italic text-ink-muted">Your decision</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {VERBS.map((verb) => (
                <button
                  key={verb}
                  type="button"
                  aria-pressed={props.selectedVerb === verb}
                  disabled={props.decisionPending}
                  onClick={() => onDecide(verb)}
                  className="rounded-full border border-hairline px-5 py-2 text-sm transition-colors hover:bg-accent/10 disabled:opacity-50 aria-pressed:bg-[var(--skin-accent)] aria-pressed:text-[var(--skin-accent-fg)]"
                >
                  {verb.charAt(0) + verb.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Radar --- */

function RadarMemoShell(props: MemoShellProps) {
  return <div data-layout="radar">{props.children}</div>;
}

export const MEMO_SHELLS: Record<SkinId, (props: MemoShellProps) => ReactNode> = {
  radar: RadarMemoShell,
  iphone: RadarMemoShell,
  boardroom: BoardroomMemoShell,
  signal: SignalMemoShell,
  atelier: AtelierMemoShell,
};
