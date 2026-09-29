/**
 * Profile-side vault: the candidate's own positioning lenses plus the evidence
 * ledger they are built from.
 *
 * Archetypes are defined by the candidate, never by the system. Uploaded CVs are
 * the fact base; archetypes are the strategic lenses applied over that base.
 */

import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { deleteArchetypeFn, refreshLedgerFn, saveArchetypeFn } from "../server";
import type { CandidateArchetype, CandidateClaim } from "../types";

interface Props {
  scope: { tenantId: string; personId: string };
  archetypes: CandidateArchetype[];
  claims: CandidateClaim[];
  coverage: { total: number; sourceBacked: number; documents: number };
  documents: Array<{ id: string; filename: string; createdAt: string; claimCount: number }>;
  ledgerStale: boolean;
}

interface DraftState {
  anchorDocumentId: string;
  pinnedClaimIds: string[];
  id?: string;
  name: string;
  positioningStatement: string;
  emphasize: string;
  deEmphasize: string;
  targetRoles: string;
  tone: string;
  isDefault: boolean;
}

const emptyDraft: DraftState = {
  anchorDocumentId: "",
  pinnedClaimIds: [],
  name: "",
  positioningStatement: "",
  emphasize: "",
  deEmphasize: "",
  targetRoles: "",
  tone: "",
  isDefault: false,
};

const toList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

export function ArchetypeVault({
  scope,
  archetypes: initial,
  claims: initialClaims,
  coverage: initialCoverage,
  documents: initialDocuments,
  ledgerStale: initialStale,
}: Props) {
  const [archetypes, setArchetypes] = useState(initial);
  const [claims, setClaims] = useState(initialClaims);
  const [coverage, setCoverage] = useState(initialCoverage);
  const [documents, setDocuments] = useState(initialDocuments);
  const [stale, setStale] = useState(initialStale);
  const [pinFilter, setPinFilter] = useState("");
  const refresh = useServerFn(refreshLedgerFn);
  const refreshLedger = async () => {
    setBusy(true);
    try {
      const result = await refresh({ data: scope });
      setClaims(result.claims);
      setCoverage(result.coverage);
      setDocuments(result.documents);
      setStale(false);
    } finally {
      setBusy(false);
    }
  };
  const docName = (id: string) => documents.find((d) => d.id === id)?.filename ?? "Unavailable CV";
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLedger, setShowLedger] = useState(false);

  const save = useServerFn(saveArchetypeFn);
  const remove = useServerFn(deleteArchetypeFn);

  const submit = async () => {
    if (!draft || draft.name.trim().length < 2) return;
    setBusy(true);
    try {
      const result = await save({
        data: {
          ...scope,
          archetype: {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(),
            positioningStatement: draft.positioningStatement.trim() || undefined,
            emphasize: toList(draft.emphasize),
            deEmphasize: toList(draft.deEmphasize),
            targetRoles: toList(draft.targetRoles),
            tone: draft.tone.trim() || undefined,
            pinnedClaimIds: draft.pinnedClaimIds.slice(0, 40),
            anchorDocumentIds: draft.anchorDocumentId ? [draft.anchorDocumentId] : [],
            isDefault: draft.isDefault,
          },
        },
      });
      setArchetypes(result.archetypes);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  const del = async (archetypeId: string) => {
    setBusy(true);
    try {
      const result = await remove({ data: { ...scope, archetypeId } });
      setArchetypes(result.archetypes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-mono text-muted-foreground">Positioning archetypes</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each archetype is a lens on the same career, not a separate CV. RADAR picks the lens that
            fits an opportunity, then builds every document from your verified evidence.
          </p>
        </div>
        <button
          type="button"
          className="pursuit-chip pursuit-chip-primary"
          onClick={() => setDraft({ ...emptyDraft })}
        >
          New archetype
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {archetypes.map((archetype) => (
          <div key={archetype.id} className="memo-card">
            <div className="flex items-start justify-between gap-2">
              <p className="font-display text-lg leading-tight">{archetype.name}</p>
              {archetype.isDefault && (
                <span className="memo-badge border border-primary/40 text-primary">Default</span>
              )}
            </div>
            {archetype.positioningStatement && (
              <p className="mt-2 text-sm text-muted-foreground">{archetype.positioningStatement}</p>
            )}
            {archetype.emphasize.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Emphasis: {archetype.emphasize.join(" · ")}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Base CV:{" "}
              {archetype.anchorDocumentIds[0] ? docName(archetype.anchorDocumentIds[0]) : "Assembled from all evidence"}
              {archetype.pinnedClaimIds.length > 0 && ` · ${archetype.pinnedClaimIds.length} pinned`}
            </p>
            {archetype.targetRoles.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Targets: {archetype.targetRoles.join(" · ")}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="pursuit-chip"
                onClick={() =>
                  setDraft({
                    id: archetype.id,
                    name: archetype.name,
                    positioningStatement: archetype.positioningStatement ?? "",
                    emphasize: archetype.emphasize.join(", "),
                    deEmphasize: archetype.deEmphasize.join(", "),
                    targetRoles: archetype.targetRoles.join(", "),
                    tone: archetype.tone ?? "",
                    isDefault: archetype.isDefault,
                    anchorDocumentId: archetype.anchorDocumentIds[0] ?? "",
                    pinnedClaimIds: archetype.pinnedClaimIds,
                  })
                }
              >
                Edit
              </button>
              <button type="button" disabled={busy} className="pursuit-chip" onClick={() => del(archetype.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="memo-card space-y-3">
          <p className="label-mono text-muted-foreground">
            {draft.id ? "Edit archetype" : "New archetype"}
          </p>
          <input
            className="pursuit-input"
            placeholder="Name — e.g. Automotive Focused"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <textarea
            className="pursuit-input"
            rows={3}
            placeholder="Positioning statement — how you want to be understood through this lens"
            value={draft.positioningStatement}
            onChange={(event) => setDraft({ ...draft, positioningStatement: event.target.value })}
          />
          <input
            className="pursuit-input"
            placeholder="Emphasise, comma separated — automotive, dealer, launch"
            value={draft.emphasize}
            onChange={(event) => setDraft({ ...draft, emphasize: event.target.value })}
          />
          <input
            className="pursuit-input"
            placeholder="De-emphasise, comma separated"
            value={draft.deEmphasize}
            onChange={(event) => setDraft({ ...draft, deEmphasize: event.target.value })}
          />
          <input
            className="pursuit-input"
            placeholder="Target roles, comma separated"
            value={draft.targetRoles}
            onChange={(event) => setDraft({ ...draft, targetRoles: event.target.value })}
          />
          <input
            className="pursuit-input"
            placeholder="Tone — e.g. authoritative, category-fluent"
            value={draft.tone}
            onChange={(event) => setDraft({ ...draft, tone: event.target.value })}
          />
          <div className="space-y-1">
            <p className="label-mono text-muted-foreground">Base CV</p>
            <select
              className="pursuit-input"
              value={draft.anchorDocumentId}
              onChange={(event) => setDraft({ ...draft, anchorDocumentId: event.target.value })}
            >
              <option value="">No base CV — assemble from all verified evidence</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.filename} · {doc.claimCount} claims
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              With a base CV, tailored resumes keep its roles and bullet wording. RADAR only reorders,
              hides less relevant lines and adds the evidence you pin below.
            </p>
          </div>
          <div className="space-y-1">
            <p className="label-mono text-muted-foreground">
              Pinned evidence · {draft.pinnedClaimIds.length} selected
            </p>
            <input
              className="pursuit-input"
              placeholder="Filter claims"
              value={pinFilter}
              onChange={(event) => setPinFilter(event.target.value)}
            />
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded border border-border p-2">
              {claims
                .filter((claim) => claim.claimType !== "EDUCATION" && claim.claimType !== "LOCATION")
                .filter((claim) =>
                  `${claim.statement} ${claim.employer ?? ""}`.toLowerCase().includes(pinFilter.toLowerCase()),
                )
                .map((claim) => {
                  const on = draft.pinnedClaimIds.includes(claim.id);
                  return (
                    <li key={claim.id}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={on}
                          onChange={() =>
                            setDraft({
                              ...draft,
                              pinnedClaimIds: on
                                ? draft.pinnedClaimIds.filter((id) => id !== claim.id)
                                : [...draft.pinnedClaimIds, claim.id],
                            })
                          }
                        />
                        <span>
                          {claim.statement}
                          {claim.employer && (
                            <span className="label-mono ml-2 text-muted-foreground">{claim.employer}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
            />
            Use as my default lens
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="pursuit-chip pursuit-chip-primary" onClick={submit}>
              Save
            </button>
            <button type="button" className="pursuit-chip" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="memo-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="label-mono text-muted-foreground">Evidence ledger</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {coverage.sourceBacked} verified claims drawn from {coverage.documents} uploaded
              document{coverage.documents === 1 ? "" : "s"}. Nothing outside this ledger can appear in
              a tailored document.
            </p>
          </div>
          <div className="flex gap-2">
            {stale && (
              <button type="button" disabled={busy} className="pursuit-chip pursuit-chip-primary" onClick={refreshLedger}>
                Update from latest CV
              </button>
            )}
            <button type="button" className="pursuit-chip" onClick={() => setShowLedger(!showLedger)}>
              {showLedger ? "Hide" : "View claims"}
            </button>
          </div>
        </div>
        {showLedger && (
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {claims.map((claim) => (
              <li key={claim.id} className="border-l-2 border-border pl-3">
                <p className="text-sm">{claim.statement}</p>
                <p className="label-mono mt-1 text-muted-foreground">
                  {[claim.employer, claim.roleTitle, claim.claimType.toLowerCase()]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
            {claims.length === 0 && (
              <li className="text-sm text-muted-foreground">
                No claims yet — upload a CV above and RADAR will index it.
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
