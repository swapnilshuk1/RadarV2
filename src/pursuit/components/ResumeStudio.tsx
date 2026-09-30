/**
 * Resume Studio.
 *
 * The hallucination barrier lives here in UI form: bullet text is editable, but
 * every bullet keeps its provenance, and an edit that changes a locked metric is
 * flagged rather than silently accepted. Exports always come from the saved state.
 */

import { useMemo, useState } from "react";
import type { CandidateClaim, LearningSignal, PursuitArtifact, ResumeContent } from "../types";
import type { ArtifactApprovalBlocker } from "../approval";
import { CopyButton, EditableText, ProvenanceBadge, SectionLabel } from "./shared";

interface Props {
  artifact: PursuitArtifact | undefined;
  claims: CandidateClaim[];
  busy: boolean;
  approvalBlockers: ArtifactApprovalBlocker[];
  onSave: (
    artifactId: string,
    content: { kind: "RESUME"; resume: ResumeContent },
    signals: LearningSignal[],
    approve?: boolean,
  ) => void;
  onExport: (artifactId: string, format: "PDF" | "DOCX" | "TXT") => void;
}

/** Numbers and percentages the candidate must not quietly change. */
const extractMetrics = (text: string): string[] =>
  (text.match(/\d[\d,.]*\s*(%|x|percent|crore|lakh|million|bn|billion|k\b)?/gi) ?? []).map((m) =>
    m.trim().toLowerCase(),
  );

const metricsDiverged = (original: string, edited: string): boolean => {
  const before = extractMetrics(original);
  const after = new Set(extractMetrics(edited));
  return before.some((metric) => !after.has(metric));
};

export function ResumeStudio({ artifact, claims, busy, approvalBlockers, onSave, onExport }: Props) {
  const [swapTarget, setSwapTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ role: number | "anchors"; index: number } | null>(
    null,
  );

  const resume = artifact?.content.kind === "RESUME" ? artifact.content.resume : null;
  const approved = artifact?.status === "APPROVED";
  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);

  if (!artifact || !resume) {
    return (
      <div className="memo-card">
        <p className="text-sm text-muted-foreground">
          Derive the pursuit strategy to build a tailored resume.
        </p>
      </div>
    );
  }

  const commit = (next: ResumeContent, signals: LearningSignal[] = []) => {
    onSave(artifact.id, { kind: "RESUME", resume: next }, signals);
  };

  /** Records whether an edited bullet still matches its verified source. */
  const editBullet = (roleIndex: number | "anchors", bulletIndex: number, text: string) => {
    const next: ResumeContent = structuredClone(resume);
    const bullet =
      roleIndex === "anchors"
        ? next.impactAnchors[bulletIndex]
        : next.roles[roleIndex]?.bullets[bulletIndex];
    if (!bullet) return;
    const source = bullet.claimId ? claimById.get(bullet.claimId) : undefined;
    const original = source?.statement ?? bullet.text;
    bullet.text = text;
    bullet.edited = source ? text.trim() !== source.statement.trim() : true;
    bullet.metricDrift = source?.metricLocked ? metricsDiverged(original, text) : false;
    commit(next, [
      {
        signalType: "PHRASE_REWRITTEN",
        subject: bullet.claimId ?? null,
        originalValue: original,
        newValue: text,
      },
    ]);
  };

  const removeBullet = (roleIndex: number | "anchors", bulletIndex: number) => {
    const next: ResumeContent = structuredClone(resume);
    const removed =
      roleIndex === "anchors"
        ? next.impactAnchors.splice(bulletIndex, 1)[0]
        : next.roles[roleIndex]?.bullets.splice(bulletIndex, 1)[0];
    commit(next, [
      {
        signalType: "BULLET_REJECTED",
        subject: removed?.claimId ?? null,
        originalValue: removed?.text ?? null,
        newValue: null,
      },
    ]);
  };

  const moveBullet = (roleIndex: number, bulletIndex: number, direction: -1 | 1) => {
    const next: ResumeContent = structuredClone(resume);
    const bullets = next.roles[roleIndex]?.bullets;
    if (!bullets) return;
    const target = bulletIndex + direction;
    if (target < 0 || target >= bullets.length) return;
    const [moved] = bullets.splice(bulletIndex, 1);
    bullets.splice(target, 0, moved);
    commit(next, [
      {
        signalType: direction === -1 ? "BULLET_PROMOTED" : "BULLET_DEMOTED",
        subject: moved.claimId ?? null,
        originalValue: moved.text,
        newValue: null,
      },
    ]);
  };

  const swapAnchor = (anchorIndex: number, claimId: string) => {
    const claim = claimById.get(claimId);
    if (!claim) return;
    const next: ResumeContent = structuredClone(resume);
    const previous = next.impactAnchors[anchorIndex];
    next.impactAnchors[anchorIndex] = {
      claimId: claim.id,
      text: claim.statement,
      edited: false,
      provenance: claim.provenance,
    };
    setSwapTarget(null);
    commit(next, [
      {
        signalType: "PROOF_SWAPPED",
        subject: claim.id,
        originalValue: previous?.claimId ?? null,
        newValue: claim.id,
      },
    ]);
  };

  const usedClaimIds = new Set(
    [...resume.impactAnchors, ...resume.roles.flatMap((role) => role.bullets)]
      .map((bullet) => bullet.claimId)
      .filter(Boolean) as string[],
  );

  type Sel = { role: number | "anchors"; index: number } | null;
  const selectedBullet =
    selected === null
      ? null
      : selected.role === "anchors"
        ? resume.impactAnchors[selected.index]
        : resume.roles[selected.role]?.bullets[selected.index];
  const selectedSource = selectedBullet?.claimId
    ? claimById.get(selectedBullet.claimId)
    : undefined;
  const select = (next: Sel) => {
    setSelected(next);
    setSwapTarget(null);
  };

  const bulletRow = (role: number | "anchors", index: number, text: string, drift?: boolean) => {
    const active = selected?.role === role && selected.index === index;
    return (
      <li
        key={`${role}-${index}`}
        onClick={() => select({ role, index })}
        className={`cursor-pointer rounded px-1 ${active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-surface-raised"}`}
      >
        <EditableText multiline value={text} onCommit={(value) => editBullet(role, index, value)} />
        {drift && <p className="text-xs text-amber-500">A verified number changed — check it.</p>}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Tailored resume — v{artifact.version}</SectionLabel>
          <span className="memo-badge border border-border text-muted-foreground">
            {artifact.status.replace(/_/g, " ").toLowerCase()}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !approved}
            onClick={() => onExport(artifact.id, "PDF")}
            className="pursuit-chip"
          >
            Export PDF
          </button>
          <button
            type="button"
            disabled={busy || !approved}
            onClick={() => onExport(artifact.id, "DOCX")}
            className="pursuit-chip"
          >
            Export Word
          </button>
          <CopyButton text={artifact.renderedText ?? ""} label="Copy text" disabled={!approved} />
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(artifact.id, { kind: "RESUME", resume }, [], true)}
            className="pursuit-chip pursuit-chip-primary"
          >
            Mark approved
          </button>
        </div>
      </div>

      {approvalBlockers.length > 0 && (
        <div className="memo-callout border-l-red-500" role="alert" data-testid="resume-approval-blockers">
          <p className="font-semibold">Correct these before approving:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {approvalBlockers.map((blocker, index) => (
              <li key={`${blocker.code}-${index}`}>
                {blocker.location && <strong>{blocker.location}: </strong>}{blocker.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left: the document itself, in resume typography. Click any text to edit. */}
        <article className="memo-card space-y-4" data-testid="resume-document">
          <header>
            <EditableText
              value={resume.fullName}
              onCommit={(value) => commit({ ...resume, fullName: value })}
            />
            <EditableText
              value={resume.contactLine}
              placeholder="email · phone · city · LinkedIn"
              onCommit={(value) => commit({ ...resume, contactLine: value })}
            />
            <div className="mt-1 font-display text-lg">
              <EditableText
                value={resume.headline}
                onCommit={(value) => commit({ ...resume, headline: value })}
              />
            </div>
          </header>
          <section>
            <SectionLabel>Summary</SectionLabel>
            <EditableText
              multiline
              value={resume.executiveSummary}
              onCommit={(value) =>
                commit({ ...resume, executiveSummary: value }, [
                  {
                    signalType: "SUMMARY_REWRITTEN",
                    subject: null,
                    originalValue: resume.executiveSummary,
                    newValue: value,
                  },
                ])
              }
            />
          </section>
          <section>
            <SectionLabel>Selected impact</SectionLabel>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {resume.impactAnchors.map((anchor, index) =>
                bulletRow("anchors", index, anchor.text, anchor.metricDrift),
              )}
            </ul>
          </section>
          {resume.roles.map((role, roleIndex) => (
            <section key={`${role.employer}-${roleIndex}`}>
              <p className="font-medium">
                {role.employer}
                {role.roleTitle ? (
                  <span className="text-muted-foreground"> · {role.roleTitle}</span>
                ) : null}
                {role.period && (
                  <span className="label-mono ml-2 text-muted-foreground">{role.period}</span>
                )}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {role.bullets.map((bullet, bulletIndex) =>
                  bulletRow(roleIndex, bulletIndex, bullet.text, bullet.metricDrift),
                )}
              </ul>
            </section>
          ))}
          {resume.capabilities.length > 0 && (
            <section>
              <SectionLabel>Capabilities</SectionLabel>
              <p className="mt-1 text-sm text-muted-foreground">
                {resume.capabilities.join(" · ")}
              </p>
            </section>
          )}
        </article>

        {/* Right: evidence inspector for the selected line. */}
        <aside
          className="memo-card h-fit space-y-3 lg:sticky lg:top-24"
          data-testid="evidence-inspector"
        >
          <SectionLabel>Evidence inspector</SectionLabel>
          {!selectedBullet ? (
            <p className="text-sm text-muted-foreground">
              Select a line in the resume to see where it comes from.
            </p>
          ) : (
            <>
              <ProvenanceBadge
                provenance={selectedBullet.provenance}
                edited={selectedBullet.edited}
              />
              <div>
                <span className="label-mono text-muted-foreground">Source</span>
                <p className="text-sm">
                  {selectedSource
                    ? `${selectedSource.statement}${selectedSource.employer ? ` — ${selectedSource.employer}` : ""}`
                    : "No linked source claim"}
                </p>
              </div>
              {selectedBullet.metricDrift && (
                <p className="text-xs text-amber-500">
                  A verified number differs from the source. Confirm it before sending.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {selected!.role === "anchors" ? (
                  <button
                    type="button"
                    className="pursuit-chip"
                    onClick={() =>
                      setSwapTarget(swapTarget === selected!.index ? null : selected!.index)
                    }
                  >
                    Replace
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="pursuit-chip"
                      onClick={() => moveBullet(selected!.role as number, selected!.index, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="pursuit-chip"
                      onClick={() => moveBullet(selected!.role as number, selected!.index, 1)}
                    >
                      Move down
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="pursuit-chip"
                  onClick={() => {
                    removeBullet(selected!.role, selected!.index);
                    select(null);
                  }}
                >
                  Remove
                </button>
              </div>
              {swapTarget !== null && selected!.role === "anchors" && (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-border p-2">
                  {claims
                    .filter((claim) => !usedClaimIds.has(claim.id))
                    .slice(0, 40)
                    .map((claim) => (
                      <button
                        key={claim.id}
                        type="button"
                        onClick={() => swapAnchor(swapTarget, claim.id)}
                        className="block w-full text-left text-xs text-muted-foreground hover:text-foreground"
                      >
                        {claim.employer ? `${claim.employer} — ` : ""}
                        {claim.statement}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
