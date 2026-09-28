import { useState, type ReactNode } from "react";
import type { Claim, Dossier, Passage } from "./contracts";
import "./dossier.css";

export function DossierView({
  dossier: d,
  reviewState,
  actions,
}: {
  dossier: Dossier;
  reviewState?: "pending" | "attention" | "reviewed";
  actions?: ReactNode;
}) {
  const reviewed =
    reviewState === "reviewed" || (!reviewState && Boolean(d.generation.factualReviews?.length));
  const reviewNeedsAttention = reviewState === "attention";
  const [selected, setSelected] = useState<Passage | null>(null);
  const [selectedPlaneLabel, setSelectedPlaneLabel] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<
    "resumeNarrative" | "linkedinStrategy" | "screening" | "interview"
  >("resumeNarrative");
  const preparationKeys = (
    ["resumeNarrative", "linkedinStrategy", "screening", "interview"] as const
  ).filter((key) => d.approach[key].length > 0);
  const activeWorkspace = preparationKeys.includes(workspace) ? workspace : preparationKeys[0];
  const claims = [
    ...d.evidence.roleClaims,
    ...d.evidence.candidateClaims,
    ...d.evidence.contextualClaims,
    ...d.evidence.relationalClaims,
  ];
  const passage = (p: Passage) => (
    <span>
      {p.text}{" "}
      <button
        className={`dossier-cue ${p.state.toLowerCase()}`}
        onClick={() => {
          setSelectedPlaneLabel(null);
          setSelected(p);
        }}
        aria-label={`Show evidence: ${p.text}`}
        title={
          p.state === "EXPLICIT"
            ? "Source-reported: view evidence"
            : "Grounded inference: view evidence"
        }
      >
        {p.state === "EXPLICIT" ? "E" : "I"}
      </button>
    </span>
  );
  const list = (items: Passage[]) => (
    <ul className="dossier-bullets">
      {items.map((p, i) => (
        <li key={i}>{passage(p)}</li>
      ))}
    </ul>
  );
  const valueList = (items: Passage[]) => (
    <ul className="dossier-value-grid">
      {items.map((p, i) => (
        <li key={i}>{passage(p)}</li>
      ))}
    </ul>
  );
  const chapter = (number: string, label: string, title: string, children: ReactNode) => (
    <section className="dossier-chapter">
      <aside className="dossier-rail">
        <span className="dossier-roman">{number}</span>
        <span className="label-mono">{label}</span>
      </aside>
      <div className="dossier-chapter-content">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
  const scopeResolutions = d.resolutions.filter((r) => Object.keys(fieldLabels).includes(r.field));
  const resolvedScopeResolutions = scopeResolutions.filter((r) => r.status !== "OPEN");
  const unresolvedScopeResolutions = scopeResolutions.filter((r) => r.status === "OPEN");
  const unresolvedScopeGroups = groupUnresolvedScopeFields(unresolvedScopeResolutions.map((r) => r.field));
  const selectResolution = (r: Dossier["resolutions"][number]) => {
    const planes = new Set(r.claimIds.map((id) => claims.find((c) => c.id === id)?.plane));
    const labels = [
      planes.has("JD") ? "ROLE" : "",
      planes.has("CANDIDATE") ? "CANDIDATE" : "",
      planes.has("CONTEXT") ? "CONTEXT" : "",
      planes.has("RELATIONAL") ? "RELATIONAL" : "",
    ].filter(Boolean);
    setSelectedPlaneLabel(labels.join(" + ") || "Unresolved scope");
    setSelected({
      text:
        r.status === "OPEN"
          ? "This decision-relevant detail is not established in the available source material."
          : Array.isArray(r.value)
            ? r.value.join(" / ")
            : String(r.value),
      kind: r.status === "OPEN" ? "QUESTION" : "CONCLUSION",
      state: r.status === "RESOLVED" ? "EXPLICIT" : "INFERRED",
      confidence: 0,
      sourcePlane:
        planes.has("RELATIONAL") || labels.length > 1
          ? "RELATIONAL"
          : planes.has("CONTEXT")
            ? "CONTEXT"
            : planes.has("CANDIDATE")
              ? "CANDIDATE"
              : "JD",
      evidenceRefs: r.claimIds,
      reasoning:
        r.status === "OPEN"
          ? "RADAR does not infer this detail when the available source material is silent."
          : r.consequence,
    });
  };
  const resolution = (r: Dossier["resolutions"][number]) => (
    <div key={r.field}>
      <dt>{fieldLabels[r.field] || r.field.replace(/([A-Z])/g, " $1")}</dt>
      <dd>
        {Array.isArray(r.value)
            ? r.value.join(" / ")
            : String(r.value)}{" "}
        <button
          className="dossier-cue"
          onClick={() => selectResolution(r)}
          aria-label={`Show evidence for ${r.field}`}
        >
          {r.status === "INFERRED" ? "I" : "E"}
        </button>
      </dd>
    </div>
  );
  const trace = d.canonicalDecisionTrace as
    { requirements?: Array<{ id: string; requirement: string; status: string }> } | undefined;
  const fitLabel = (ids: string[]) =>
    ids
      .map((id) => trace?.requirements?.find((r) => r.id === id))
      .filter(Boolean)
      .map((r) => r!.status.replaceAll("_", " ").toLowerCase())
      .filter((s, i, a) => a.indexOf(s) === i)
      .join(" / ");
  return (
    <article className="dossier dossier-template-b">
      <nav className="dossier-top">
        <span className="dossier-brand">RADAR</span>
        <span className="label-mono">Executive decision memo</span>
      </nav>
      <div className="dossier-body">
        <div className={`dossier-review-status ${reviewed ? "reviewed" : "pending"}`} role="status">
          <strong>
            {reviewed
              ? "Factual review completed"
              : reviewNeedsAttention
                ? "AI draft · factual review needs attention"
                : "AI draft · factual review pending"}
          </strong>
          {!reviewed && (
            <p>
              This memo may be revised after source checks. Confirm material claims before acting.
            </p>
          )}
        </div>
        <header className="dossier-hero">
          <div>
            <div className="dossier-kicker">
              <span className={`dossier-verdict verdict-${d.verdict.verdict.toLowerCase()}`}>
                {d.verdict.verdict}
              </span>
              <span className="label-mono">
                {d.verdict.screeningViability.toLowerCase()} screening viability
              </span>
            </div>
            <h1>
              {d.opportunity.title}
              <em>at {d.opportunity.company}</em>
            </h1>
            <p className="dossier-identity">
              Prepared for {d.candidate.name} &middot;{" "}
              {new Date(d.generatedAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
            {actions && <div className="dossier-hero-actions">{actions}</div>}
          </div>
          <aside className="dossier-overview">
            <span className="label-mono">The call</span>
            <div className="dossier-thesis">{passage(d.executiveThesis)}</div>
            <a href="#memo-approach" className="dossier-action-link">
              Recommended next steps &rarr;
            </a>
          </aside>
        </header>
        <p className="dossier-legend">
          E: Source-reported &nbsp; I: Grounded inference. Select a cue for evidence. Candidate
          achievements are CV-reported.
        </p>
        {chapter(
          "I",
          "Opportunity value",
          "Why this deserves your attention",
          valueList(d.opportunityValue),
        )}
        {chapter(
          "II",
          "Mandate & authority",
          "What you would own",
          <>
            <div className="dossier-mandate-grid">
              <section>
                <h3>Priorities and milestones</h3>
                {list(d.mandate.priorities)}
              </section>
              <section>
                <h3>Outcomes that matter</h3>
                {list(d.mandate.outcomes)}
              </section>
            </div>
            <details className="dossier-scope-reference">
              <summary>
                Scope, authority and economics
                {unresolvedScopeGroups.length > 0 && ` · ${unresolvedScopeGroups.length} areas to settle`}
              </summary>
              {resolvedScopeResolutions.length > 0 && (
                <dl className="dossier-scope">
                  {resolvedScopeResolutions.map(resolution)}
                </dl>
              )}
              {unresolvedScopeResolutions.length > 0 && (
                <section className="dossier-unresolved-scope" aria-label="Scope details to clarify">
                  <span className="label-mono">Before you advance</span>
                  <p>
                    These decision-relevant details are not established in the available evidence.
                    RADAR is deliberately not filling them with assumptions.
                  </p>
                  <ul>
                    {unresolvedScopeGroups.map((group) => (
                      <li key={group.label}>
                        <strong>{group.label}:</strong> {group.guidance}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </details>
          </>,
        )}
        {chapter(
          "III",
          "Evidence & fit",
          "Why you are credible",
          <div className="dossier-fit">
            {d.candidateFit.map((row, i) => (
              <div className="dossier-fit-row" key={i}>
                <div>
                  <span className="label-mono">{fitLabel(row.requirementIds)}</span>
                  <h3>{row.label}</h3>
                </div>
                <p>{passage(row.assessment)}</p>
              </div>
            ))}
          </div>,
        )}
        {chapter(
          "IV",
          "Decision conditions",
          "What must be resolved",
          <div className="dossier-conditions">
            {d.decisionConditions.map((row, i) => (
              <div className="dossier-condition" key={i}>
                <p className="dossier-condition-question"><span className="label-mono">Decision hinge</span>{passage(row.question)}</p>
                <p><span className="label-mono">Why it matters</span>{passage(row.consequence)}</p>
              </div>
            ))}
          </div>,
        )}
        <div id="memo-approach">
          {chapter(
            "V",
            "Next action",
          "How to approach it",
          <>
              <div className="dossier-approach-grid">
                <section>
                  <h3>Recommended move</h3>
                  {list(d.approach.nextSteps)}
                </section>
                <section>
                  <h3>Suggested opening</h3>
                  <blockquote className="dossier-opening">{passage(d.approach.opening)}</blockquote>
                </section>
              </div>
              {activeWorkspace && (
                <details className="dossier-preparation">
                  <summary>Prepare for the conversation</summary>
                  <div className="dossier-tabs" role="tablist" aria-label="Positioning workspace">
                    {preparationKeys.map((key) => (
                      <button
                        key={key}
                        role="tab"
                        aria-selected={activeWorkspace === key}
                        aria-controls="positioning-content"
                        id={`tab-${key}`}
                        onClick={() => setWorkspace(key)}
                      >
                        {workspaceLabels[key]}
                      </button>
                    ))}
                  </div>
                  <div
                    className="dossier-workspace"
                    role="tabpanel"
                    id="positioning-content"
                    aria-labelledby={`tab-${activeWorkspace}`}
                  >
                    {list(d.approach[activeWorkspace])}
                  </div>
                </details>
              )}
            </>,
          )}
        </div>
        {chapter(
          "VI",
          "Reference",
          "Evidence behind the recommendation",
          <>
            {d.candidateConflicts.length > 0 && (
              <div className="dossier-conflicts">
                <h3>Source differences to resolve</h3>
                {d.candidateConflicts.map((c) => (
                  <p key={c.topic}>
                    <strong>{c.topic}</strong>: {c.question}
                  </p>
                ))}
              </div>
            )}
            <details className="dossier-appendix">
              <summary>Company context, candidate evidence and source records</summary>
              <h3>Company context: established and unresolved</h3>
              <dl className="dossier-scope">
                {d.resolutions
                  .filter((r) => !Object.keys(fieldLabels).includes(r.field))
                  .map(resolution)}
              </dl>
              <h3>Full requirement assessment</h3>
              {d.verdict.requirements.map((r, i) => (
                <div className="dossier-ledger-row" key={i}>
                  <strong>{r.requirement}</strong>
                  <span>
                    {r.decisionRole.replaceAll("_", " ").toLowerCase()} &middot;{" "}
                    {r.status.replaceAll("_", " ").toLowerCase()}
                  </span>
                  <p>{r.reasoning}</p>
                </div>
              ))}
              <h3>Evidence inventory</h3>
              {claims.map((c) => (
                <details key={c.id} className="dossier-ledger-row">
                  <summary>{c.text}</summary>
                  <ClaimEvidence claim={c} claims={claims} sources={d.evidence.lineage} />
                </details>
              ))}
              <h3>Context acquisition</h3>
              {d.acquisition.map((a, i) => (
                <p key={i}>
                  {a.field}: {a.detail}
                </p>
              ))}
            </details>
          </>,
        )}
        <footer className="dossier-footer">
          <span className="dossier-brand">RADAR</span>
          <span className="label-mono">A considered decision. An evidence-led next step.</span>
        </footer>
      </div>
      {selected && (
        <div
          className="dossier-modal-backdrop"
          onClick={() => {
            setSelected(null);
            setSelectedPlaneLabel(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-title"
            className="dossier-evidence-dialog"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
            }}
          >
            <button
              autoFocus
              className="dossier-close"
              onClick={() => {
                setSelected(null);
                setSelectedPlaneLabel(null);
              }}
            >
              Close evidence ×
            </button>
            <h2 id="evidence-title">Behind the conclusion</h2>
            <p>{selected.text}</p>
            <p className="label-mono">
              {selected.kind === "QUESTION" ? "Open question" : selected.state} ·{" "}
              {selectedPlaneLabel || selected.sourcePlane}
            </p>
            {selected.reasoning && (
              <p>
                <strong>Reasoning</strong> — {selected.reasoning}
              </p>
            )}
            {selected.validationQuestion && (
              <p>
                <strong>Validate</strong> — {selected.validationQuestion}
              </p>
            )}
            {selected.evidenceRefs.map((id) => {
              const claim = claims.find((c) => c.id === id);
              return (
                claim && (
                  <ClaimEvidence
                    key={id}
                    claim={claim}
                    claims={claims}
                    sources={d.evidence.lineage}
                  />
                )
              );
            })}
          </section>
        </div>
      )}
    </article>
  );
}

function ClaimEvidence({
  claim,
  claims,
  sources,
  visited = new Set<string>(),
}: {
  claim: Claim;
  claims: Claim[];
  sources: Dossier["evidence"]["lineage"];
  visited?: Set<string>;
}) {
  if (visited.has(claim.id)) return null;
  const next = new Set(visited).add(claim.id);
  return (
    <div className="dossier-source">
      <h3>{claim.text}</h3>
      <p className="dossier-muted">
        {claim.state} · {Math.round(claim.confidence * 100)}% analyst confidence
      </p>
      {claim.reasoning && <p>{claim.reasoning}</p>}
      {claim.citations.map((ref, i) => {
        const source = sources.find((s) => s.id === ref.sourceId)!;
        return (
          <div key={i}>
            <blockquote>{ref.quote}</blockquote>
            <p className="dossier-source-name">
              {source.title} · {source.attribution.replaceAll("_", " ").toLowerCase()}
            </p>
            {source.locator.startsWith("https://") ? (
              <a href={source.locator} target="_blank" rel="noreferrer">
                Open source ↗
              </a>
            ) : (
              <p className="dossier-source-path">{source.locator}</p>
            )}
          </div>
        );
      })}
      {claim.derivedFrom.map((id) => {
        const parent = claims.find((c) => c.id === id);
        return (
          parent && (
            <ClaimEvidence
              key={id}
              claim={parent}
              claims={claims}
              sources={sources}
              visited={next}
            />
          )
        );
      })}
    </div>
  );
}
const workspaceLabels = {
  resumeNarrative: "Resume narrative",
  linkedinStrategy: "LinkedIn strategy",
  screening: "Screening call",
  interview: "Interview strategy",
};
const fieldLabels: Record<string, string> = {
  reportingLine: "Reporting line",
  executiveDistance: "Executive distance",
  leadershipMode: "Leadership topology",
  teamScale: "Team scale",
  functionState: "Function state",
  geography: "Geography",
  commercialScope: "Commercial accountability",
  compensation: "Economics",
};

function groupUnresolvedScopeFields(fields: string[]): Array<{ label: string; guidance: string }> {
  const groups = [
    {
      fields: ["reportingLine", "executiveDistance"],
      label: "Authority and reporting",
      guidance: "Confirm the executive sponsor, reporting line, and real decision latitude before advancing.",
    },
    {
      fields: ["leadershipMode", "teamScale", "functionState"],
      label: "Leadership scope",
      guidance: "Do not assume people leadership. Establish whether this is a direct, matrix, or individual-contributor mandate—and whether the function is being built, scaled, or inherited.",
    },
    {
      fields: ["geography", "commercialScope"],
      label: "Remit and commercial ownership",
      guidance: "Clarify the geographic remit plus P&L, budget, and revenue ownership before judging the scope of the move.",
    },
    {
      fields: ["compensation"],
      label: "Compensation",
      guidance: "The economics are not disclosed. Confirm the structure, upside, and trade-offs before committing.",
    },
  ];
  const known = new Set(groups.flatMap((group) => group.fields));
  const matched = groups
    .filter((group) => group.fields.some((field) => fields.includes(field)))
    .map(({ label, guidance }) => ({ label, guidance }));
  const remaining = fields.filter((field) => !known.has(field));
  if (remaining.length) {
    matched.push({
      label: "Other material detail",
      guidance: "The available source material does not establish this detail. Confirm it before advancing.",
    });
  }
  return matched;
}
