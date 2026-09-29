/**
 * Strategy surface: the Pursuit Thesis, which every other artifact derives from.
 * It answers one question before anything is written — why should this
 * organisation talk to this candidate rather than another credible executive?
 */

import type { CockpitView, PursuitStatus } from "../types";
import { pursuitStatusLabels, pursuitStatuses } from "../types";
import { SectionLabel } from "./shared";

interface Props {
  view: CockpitView;
  busy: boolean;
  onArchetypeChange: (archetypeId: string) => void;
  onStatusChange: (status: PursuitStatus) => void;
  onNextAction: (nextAction: string, due: string) => void;
}

const severityTone: Record<string, string> = {
  MATERIAL: "border-red-500/40 bg-red-500/10 text-red-400",
  MODERATE: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  MINOR: "border-border bg-surface-raised text-muted-foreground",
};

const lensLabel = { STRONG_DIRECT: "Strong direct support", SUPPORTING: "Supporting", LOW: "Low relevance" } as const;
const lensTone = {
  STRONG_DIRECT: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  SUPPORTING: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  LOW: "border-border bg-surface-raised text-muted-foreground",
} as const;
const relLabel = { DIRECT: "Direct", ANALOGOUS: "Analogous", ADJACENT: "Adjacent", UNSUPPORTED: "Not established" } as const;
const relTone = {
  DIRECT: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  ANALOGOUS: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  ADJACENT: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  UNSUPPORTED: "border-red-500/40 bg-red-500/10 text-red-400",
} as const;

const stanceTone: Record<string, string> = {
  PRIMARY: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  SECONDARY: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  AVOID: "border-red-500/30 bg-red-500/5 text-red-400/80",
};

export function StrategyPanel({
  view,
  busy,
  onArchetypeChange,
  onStatusChange,
  onNextAction,
}: Props) {
  const { thesis, pursuit, archetypes } = view;

  if (!thesis) {
    return (
      <div className="memo-card">
        <SectionLabel>No strategy yet</SectionLabel>
        <p className="mt-2 text-sm text-muted-foreground">
          Derive the pursuit thesis to generate your positioning, tailored resume, outreach
          messages and interview brief.
        </p>
      </div>
    );
  }

  const activeArchetype = archetypes.find((a) => a.id === thesis.archetypeId);
  const semantic = thesis.semantic ?? null;

  return (
    <div className="space-y-5">
      <div className="memo-opinion-box">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Pursuit strategy · v{thesis.version}</SectionLabel>
          <span className="memo-badge border border-border text-muted-foreground">
            Evidence-grounded
          </span>
        </div>
        <p className="mt-3 font-display text-xl leading-snug">{thesis.winTheme}</p>
        <p className="mt-3 text-sm text-muted-foreground">{thesis.targetMandate}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="memo-card">
          <SectionLabel>Recommended positioning</SectionLabel>
          <p className="mt-2 text-sm leading-relaxed">{thesis.recommendedPositioning}</p>
          {thesis.targetAudience.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Audience: {thesis.targetAudience.join(" · ")}
            </p>
          )}
        </div>

        <div className="memo-card">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Positioning lens</SectionLabel>
            <select
              value={thesis.archetypeId ?? ""}
              disabled={busy}
              onChange={(event) => onArchetypeChange(event.target.value)}
              className="pursuit-input max-w-[58%]"
            >
              {archetypes.map((archetype) => (
                <option key={archetype.id} value={archetype.id}>
                  {archetype.name}
                </option>
              ))}
            </select>
          </div>
          {activeArchetype?.positioningStatement && (
            <p className="mt-2 text-sm leading-relaxed">{activeArchetype.positioningStatement}</p>
          )}
          {thesis.archetypeMatchReasoning && (
            <p className="mt-2 text-xs text-muted-foreground">{thesis.archetypeMatchReasoning}</p>
          )}
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="label-mono pb-1 font-normal">Lens</th>
                <th className="label-mono pb-1 font-normal">Evidence relationship</th>
              </tr>
            </thead>
            <tbody>
              {thesis.archetypeScores.map((lens) => (
                <tr key={lens.archetypeId} className="border-t border-border">
                  <td className="py-1.5 pr-2">
                    {lens.archetypeName}
                    {lens.role === "PRIMARY" && <span className="ml-1 text-primary">· anchor</span>}
                  </td>
                  <td className="py-1.5">
                    <span className={`memo-badge border ${lensTone[lens.relationship ?? "LOW"]}`}>
                      {lensLabel[lens.relationship ?? "LOW"]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {semantic && (
        <div className="memo-card">
          <SectionLabel>What the mandate needs — and what the record shows</SectionLabel>
          <p className="mt-2 text-sm">
            <span className="font-medium">Primary:</span> {semantic.positioning.label}
          </p>
          {semantic.positioning.supporting.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Supporting: {semantic.positioning.supporting.join(" · ")}
            </p>
          )}
          <table className="mt-3 w-full text-xs">
            <tbody>
              {semantic.coverage.map((row) => (
                <tr key={row.dimensionId} className="border-t border-border">
                  <td className="py-1.5 pr-2">{row.label}</td>
                  <td className="py-1.5 text-right">
                    <span className={`memo-badge border ${relTone[row.best]}`}>{relLabel[row.best]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {semantic.positioning.gaps.length > 0 && (
            <ul className="mt-3 space-y-1">
              {semantic.positioning.gaps.map((gap) => (
                <li key={gap} className="text-xs text-amber-500">Gap — {gap}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="memo-card">
        <SectionLabel>Primary proof — the evidence that carries the argument</SectionLabel>
        <ol className="mt-3 space-y-3">
          {thesis.primaryProof.map((proof, index) => (
            <li key={`${proof.claimId ?? "proof"}-${index}`} className="border-l-2 border-primary/60 pl-3">
              <p className="text-sm font-medium leading-snug">{proof.headline}</p>
              <p className="mt-1 text-xs text-muted-foreground">{proof.whyItMatters}</p>
            </li>
          ))}
        </ol>
      </div>

      {thesis.objections.length > 0 && (
        <div className="memo-card">
          <SectionLabel>Objections and counter-positioning</SectionLabel>
          <div className="mt-3 space-y-3">
            {thesis.objections.map((objection, index) => (
              <div key={index} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`memo-badge border ${severityTone[objection.severity] ?? severityTone.MINOR}`}>
                    {objection.severity.toLowerCase()}
                  </span>
                  <p className="text-sm font-medium">{objection.objection}</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{objection.counterPosition}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {thesis.routeStrategy.length > 0 && (
          <div className="memo-card">
            <SectionLabel>Recommended channel strategy</SectionLabel>
            <div className="mt-3 space-y-2">
              {thesis.routeStrategy.map((route, index) => (
                <div key={index} className="flex gap-3">
                  <span className={`memo-badge h-fit border ${stanceTone[route.stance] ?? stanceTone.SECONDARY}`}>
                    {route.stance.toLowerCase()}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{route.route}</p>
                    <p className="text-xs text-muted-foreground">{route.reasoning}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Known contacts: {semantic?.knownContacts.length ? semantic.knownContacts.join(", ") : "none recorded yet"}
            </p>
          </div>
        )}

        {thesis.narrativesToAvoid.length > 0 && (
          <div className="memo-card">
            <SectionLabel>Narratives to avoid</SectionLabel>
            <ul className="mt-3 space-y-2">
              {thesis.narrativesToAvoid.map((narrative, index) => (
                <li key={index} className="text-sm text-muted-foreground">
                  — {narrative}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="memo-card">
        <SectionLabel>Pipeline</SectionLabel>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="label-mono text-muted-foreground">Stage</span>
            <select
              value={pursuit.status}
              disabled={busy}
              onChange={(event) => onStatusChange(event.target.value as PursuitStatus)}
              className="pursuit-input mt-1"
            >
              {pursuitStatuses.map((status) => (
                <option key={status} value={status}>
                  {pursuitStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label-mono text-muted-foreground">Next action</span>
            <input
              defaultValue={pursuit.nextAction ?? ""}
              placeholder="Send the executive note"
              onBlur={(event) => onNextAction(event.target.value, pursuit.nextActionDue ?? "")}
              className="pursuit-input mt-1"
            />
          </label>
          <label className="block">
            <span className="label-mono text-muted-foreground">Due</span>
            <input
              type="date"
              defaultValue={pursuit.nextActionDue?.slice(0, 10) ?? ""}
              onBlur={(event) => onNextAction(pursuit.nextAction ?? "", event.target.value)}
              className="pursuit-input mt-1"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
