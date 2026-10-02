import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { changeTaxonomyFn } from "./taxonomy-server";
import type { TaxonomyMutation } from "./taxonomy-contracts";

type Snapshot = Awaited<ReturnType<typeof import("./taxonomy-store").readTaxonomySnapshot>>;
type TaxonomyAction =
  | {
      kind: "draft_concept";
      dimension: string;
      concept: string;
      description: string;
      phrases: string[];
    }
  | { kind: "discard"; revisionId: string }
  | { kind: "publish"; revisionId: string; confirmation?: "PUBLISH" }
  | { kind: "revert"; revisionId: string }
  | { kind: "shadow"; revisionId: string }
  | {
      kind: "add_concept";
      dimension: string;
      concept: string;
      description: string;
      phrases: string[];
      ring: "primary" | "adjacent" | "excluded";
    }
  | { kind: "retire_concept"; dimension: string; concept: string };
const button =
  "border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export function TaxonomyControls({ data }: { data: Snapshot }) {
  const router = useRouter();
  const publishDialog = useRef<HTMLDialogElement>(null);
  const [publishReason, setPublishReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const operator = data.role === "operator";
  const [selected, setSelected] = useState<{ dimension: string; concept: string } | null>(null);
  const [phrases, setPhrases] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  useEffect(() => {
    if (publishOpen) publishDialog.current?.showModal();
    else publishDialog.current?.close();
  }, [publishOpen]);
  const [newConcept, setNewConcept] = useState("");
  const [newDimension, setNewDimension] = useState("");
  const [newRing, setNewRing] = useState<"primary" | "adjacent" | "excluded">("adjacent");
  const [newDescription, setNewDescription] = useState("");
  const [newPhrases, setNewPhrases] = useState("");
  const effective = data.draft ?? data.active;
  const concepts = useMemo(
    () =>
      Object.entries(effective.definition.lexicon.dimensions).flatMap(([dimension, entries]) =>
        Object.entries(entries).map(([concept, values]) => ({ dimension, concept, values })),
      ),
    [effective.definition],
  );
  useEffect(() => {
    if (
      (!selected ||
        !concepts.some(
          (entry) => entry.dimension === selected.dimension && entry.concept === selected.concept,
        )) &&
      concepts.length
    )
      setSelected({ dimension: concepts[0].dimension, concept: concepts[0].concept });
  }, [concepts, selected]);
  const current = selected
    ? effective.definition.lexicon.dimensions[selected.dimension]?.[selected.concept]
    : undefined;
  useEffect(() => {
    if (!selected || !current) return;
    setPhrases(current.join("\n"));
    setDescription(
      effective.definition.taxonomy.descriptions[selected.concept] ??
        "This discovery concept has no taxonomy description.",
    );
  }, [current, effective.definition.taxonomy.descriptions, selected]);
  const perform = async (mutation: TaxonomyAction, actionReason = reason) => {
    setBusy(true);
    setError(null);
    try {
      await changeTaxonomyFn({
        data: { ...mutation, reason: actionReason, expectedState: data.state } as TaxonomyMutation,
      });
      if (mutation.kind !== "shadow") setPublishOpen(false);
      setReason("");
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Taxonomy update failed");
    } finally {
      setBusy(false);
    }
  };
  const submittedPhrases = Array.from(
    new Set(
      phrases
        .split("\n")
        .map((phrase) => phrase.trim())
        .filter(Boolean),
    ),
  );
  const newSubmittedPhrases = Array.from(
    new Set(
      newPhrases
        .split("\n")
        .map((phrase) => phrase.trim())
        .filter(Boolean),
    ),
  );
  const unsaved = Boolean(
    current &&
    (phrases !== current.join("\n") ||
      description !==
        (effective.definition.taxonomy.descriptions[selected!.concept] ??
          "This discovery concept has no taxonomy description.")),
  );
  const revisionChanges = concepts
    .filter(
      (entry) =>
        JSON.stringify(
          data.active.definition.lexicon.dimensions[entry.dimension]?.[entry.concept],
        ) !== JSON.stringify(entry.values) ||
        data.active.definition.taxonomy.descriptions[entry.concept] !==
          effective.definition.taxonomy.descriptions[entry.concept],
    )
    .map((entry) => `${entry.dimension}: ${entry.concept} - added or edited`);
  for (const [dimension, entries] of Object.entries(data.active.definition.lexicon.dimensions))
    for (const concept of Object.keys(entries))
      if (!effective.definition.lexicon.dimensions[dimension]?.[concept])
        revisionChanges.push(`${dimension}: ${concept} - retired`);
  const structuralDraft = data.draft?.requires_shadow === 1;
  const shadow = data.draft
    ? data.shadows.find(
        (run) =>
          run.revision_id === data.draft?.id &&
          run.active_revision_id === data.active.id &&
          run.status === "passed",
      )
    : undefined;
  return (
    <section className="mb-8 border-y-2 border-foreground py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">Discovery taxonomy</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Descriptions and portal-query aliases are versioned here. They shape only newly
            activated search plans; they never change the attention gate, eligibility, or an
            existing plan’s queries.
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">active {data.active.id}</span>
      </div>
      {!data.installed && (
        <p role="status" className="mt-4 text-sm text-destructive">
          Taxonomy migration is not installed.
        </p>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-border text-left font-mono text-[.65rem] uppercase text-muted-foreground">
                <th className="px-2 py-2">Dimension</th>
                <th className="px-2 py-2">Concept</th>
                <th className="px-2 py-2 text-right">Aliases</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((entry) => (
                <tr key={`${entry.dimension}:${entry.concept}`} className="border-b border-border">
                  <td className="px-2 py-2 text-muted-foreground">{entry.dimension}</td>
                  <td className="px-2 py-2">
                    <button
                      className="text-left underline underline-offset-2"
                      onClick={() =>
                        setSelected({ dimension: entry.dimension, concept: entry.concept })
                      }
                    >
                      {entry.concept}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {entry.values.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected && current && (
          <div className="border border-border p-4">
            <p className="font-mono text-xs text-muted-foreground">{selected.dimension}</p>
            <h3 className="mt-1 font-serif text-xl">{selected.concept}</h3>
            <label className="mt-4 block text-sm">
              Description
              <textarea
                aria-label="Taxonomy description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!operator}
                maxLength={1000}
                className="mt-2 min-h-24 w-full border border-border bg-background p-2"
              />
            </label>
            <label className="mt-4 block text-sm">
              Portal-query aliases <span className="text-muted-foreground">(one per line)</span>
              <textarea
                aria-label="Taxonomy aliases"
                value={phrases}
                onChange={(event) => setPhrases(event.target.value)}
                disabled={!operator}
                className="mt-2 min-h-40 w-full border border-border bg-background p-2 font-mono text-xs"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              New aliases need a functional signal. Generic seniority words cannot be added.
              Duplicate aliases are rejected across the taxonomy.
            </p>
            {operator && (
              <label className="mt-4 block text-sm">
                Reason
                <input
                  aria-label="Taxonomy action reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  className="mt-2 w-full border border-border bg-background p-2"
                />
              </label>
            )}
            {operator && (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className={button}
                  disabled={busy || reason.trim().length < 3 || !submittedPhrases.length}
                  onClick={() =>
                    void perform({
                      kind: "draft_concept",
                      dimension: selected.dimension,
                      concept: selected.concept,
                      description,
                      phrases: submittedPhrases,
                    })
                  }
                >
                  Save draft
                </button>
                <button
                  className={button}
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    void perform({
                      kind: "retire_concept",
                      dimension: selected.dimension,
                      concept: selected.concept,
                    })
                  }
                >
                  Retire concept
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {unsaved && data.draft && (
        <p role="status" className="mt-3 text-sm">
          Save or undo your editor changes before reviewing the saved draft.
        </p>
      )}
      {data.draft && (
        <div
          className="mt-5 flex flex-wrap items-center gap-3 border border-border bg-muted/30 p-3"
          aria-label="Taxonomy draft bar"
        >
          <span className="text-sm">
            Draft <span className="font-mono">{data.draft.id}</span>
          </span>
          {operator && (
            <>
              <button
                className={button}
                disabled={busy || reason.trim().length < 3}
                onClick={() => void perform({ kind: "discard", revisionId: data.draft!.id })}
              >
                Discard
              </button>
              <button
                className={button}
                disabled={busy || unsaved}
                onClick={() => {
                  setPublishReason("");
                  setConfirmation("");
                  setPublishOpen(true);
                }}
              >
                {structuralDraft ? "Review and publish structural draft" : "Publish safe edit"}
              </button>
            </>
          )}
        </div>
      )}
      {operator && (
        <details className="mt-5 border border-border p-4">
          <summary className="cursor-pointer font-serif text-lg">Add discovery concept</summary>
          <p className="mt-2 text-sm text-muted-foreground">
            This is a structural change. It requires a query-impact shadow before publication.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Dimension
              <select
                value={newDimension}
                onChange={(event) => setNewDimension(event.target.value)}
                className="mt-1 block w-full border border-border bg-background p-2"
              >
                <option value="">Select dimension</option>
                {Object.keys(effective.definition.lexicon.dimensions).map((dimension) => (
                  <option key={dimension}>{dimension}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Ring (descriptive metadata; no filtering effect)
              <select
                value={newRing}
                onChange={(event) => setNewRing(event.target.value as typeof newRing)}
                className="mt-1 block w-full border border-border bg-background p-2"
              >
                <option value="primary">Primary</option>
                <option value="adjacent">Adjacent</option>
                <option value="excluded">Excluded</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block text-sm">
            Concept
            <input
              value={newConcept}
              onChange={(event) => setNewConcept(event.target.value)}
              maxLength={160}
              className="mt-1 block w-full border border-border bg-background p-2"
            />
          </label>
          <label className="mt-3 block text-sm">
            Description
            <textarea
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              maxLength={1000}
              className="mt-1 min-h-20 w-full border border-border bg-background p-2"
            />
          </label>
          <label className="mt-3 block text-sm">
            Portal-query aliases <span className="text-muted-foreground">(one per line)</span>
            <textarea
              value={newPhrases}
              onChange={(event) => setNewPhrases(event.target.value)}
              className="mt-1 min-h-24 w-full border border-border bg-background p-2 font-mono text-xs"
            />
          </label>
          <button
            className={`${button} mt-3`}
            disabled={
              busy ||
              reason.trim().length < 3 ||
              !newDimension ||
              !newConcept.trim() ||
              !newDescription.trim() ||
              !newSubmittedPhrases.length
            }
            onClick={() =>
              void perform({
                kind: "add_concept",
                dimension: newDimension,
                concept: newConcept.trim(),
                description: newDescription,
                phrases: newSubmittedPhrases,
                ring: newRing,
              })
            }
          >
            Save structural draft
          </button>
        </details>
      )}
      {error && !publishOpen && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <dialog
        ref={publishDialog}
        aria-labelledby="taxonomy-publish-title"
        onCancel={() => setPublishOpen(false)}
        onClose={() => setPublishOpen(false)}
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto border border-border bg-card p-6 text-foreground backdrop:bg-black/30"
      >
        <h3 id="taxonomy-publish-title" className="font-serif text-2xl">
          Publish taxonomy revision
        </h3>
        <p className="mt-3 text-sm">
          The change applies when a future search plan is activated. Existing plans and running
          scrapes keep their pinned queries.
        </p>
        <ul className="mt-3 text-sm">
          {revisionChanges.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
        {structuralDraft && (
          <div className="mt-3 border border-border p-3 text-sm">
            {shadow ? (
              <>
                Discovery shadow passed (admissions and verdicts are not tested):{" "}
                {String(JSON.parse(String(shadow.result_json)).plansChanged)} plan query sets
                change. Added {String(JSON.parse(String(shadow.result_json)).queriesAdded)}; removed{" "}
                {String(JSON.parse(String(shadow.result_json)).queriesRemoved)}.
                <details className="mt-2">
                  <summary>Query changes by plan</summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(JSON.parse(String(shadow.result_json)).changes, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <button
                className={button}
                disabled={busy || !data.draft || publishReason.trim().length < 3}
                onClick={() =>
                  void perform({ kind: "shadow", revisionId: data.draft!.id }, publishReason)
                }
              >
                Run query-impact shadow
              </button>
            )}
          </div>
        )}
        <label className="mt-4 block text-sm">
          Publication reason
          <input
            autoFocus
            aria-label="Taxonomy publication reason"
            value={publishReason}
            onChange={(event) => setPublishReason(event.target.value)}
            className="mt-2 w-full border border-border bg-background p-2"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {structuralDraft && (
          <label className="mt-4 block text-sm">
            Type PUBLISH to confirm the structural change
            <input
              aria-label="Structural publication confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-2 w-full border border-border bg-background p-2"
            />
          </label>
        )}
        <div className="mt-5 flex gap-3">
          <button
            className={button}
            disabled={
              busy ||
              publishReason.trim().length < 3 ||
              !data.draft ||
              (structuralDraft && (!shadow || confirmation !== "PUBLISH"))
            }
            onClick={() =>
              void perform(
                {
                  kind: "publish",
                  revisionId: data.draft!.id,
                  confirmation: structuralDraft ? "PUBLISH" : undefined,
                },
                publishReason,
              )
            }
          >
            Publish revision
          </button>
          <button className={button} disabled={busy} onClick={() => setPublishOpen(false)}>
            Cancel
          </button>
        </div>
      </dialog>
      <details className="mt-5">
        <summary className="cursor-pointer font-serif text-lg">Revision history</summary>
        {data.history.map((revision) => (
          <div
            key={revision.id}
            className="flex flex-wrap justify-between gap-3 border-b border-border py-2 text-xs"
          >
            <span className="font-mono">{revision.id}</span>
            <span>{revision.created_by}</span>
            {operator && revision.id !== data.active.id && (
              <button
                className={button}
                disabled={busy || reason.trim().length < 3}
                onClick={() => void perform({ kind: "revert", revisionId: revision.id })}
              >
                Restore as draft
              </button>
            )}
          </div>
        ))}
      </details>
    </section>
  );
}
