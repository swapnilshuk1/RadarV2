import { useEffect, useMemo, useState } from "react";
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
  | { kind: "publish"; revisionId: string }
  | { kind: "revert"; revisionId: string };
const button =
  "border border-border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export function TaxonomyControls({ data }: { data: Snapshot }) {
  const operator = data.role === "operator";
  const [selected, setSelected] = useState<{ dimension: string; concept: string } | null>(null);
  const [phrases, setPhrases] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const effective = data.draft ?? data.active;
  const concepts = useMemo(
    () =>
      Object.entries(effective.definition.lexicon.dimensions).flatMap(([dimension, entries]) =>
        Object.entries(entries).map(([concept, values]) => ({ dimension, concept, values })),
      ),
    [effective.definition],
  );
  useEffect(() => {
    if (!selected && concepts.length)
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
  }, [selected?.dimension, selected?.concept]);
  const perform = async (mutation: TaxonomyAction, actionReason = reason) => {
    setBusy(true);
    setError(null);
    try {
      await changeTaxonomyFn({
        data: { ...mutation, reason: actionReason, expectedState: data.state } as TaxonomyMutation,
      });
      window.location.reload();
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
              <button
                className={`${button} mt-4`}
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
            )}
          </div>
        )}
      </div>
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
              <button className={button} disabled={busy} onClick={() => setPublishOpen(true)}>
                Publish safe edit
              </button>
            </>
          )}
        </div>
      )}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Structural topology changes—new or retired concepts, ring changes, re-parenting, and
        evaluation taxonomy—remain unavailable until their impact can be measured against a corpus.
        This control intentionally does not make those changes appear safe.
      </p>
      {error && !publishOpen && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <dialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        className="max-w-xl border border-border bg-card p-6 text-foreground backdrop:bg-black/30"
      >
        <h3 className="font-serif text-2xl">Publish safe taxonomy edit</h3>
        <p className="mt-3 text-sm">
          The change applies when a future search plan is activated. Existing plans and running
          scrapes keep their pinned queries.
        </p>
        <label className="mt-4 block text-sm">
          Publication reason
          <input
            autoFocus
            aria-label="Taxonomy publication reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 w-full border border-border bg-background p-2"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <button
            className={button}
            disabled={busy || reason.trim().length < 3 || !data.draft}
            onClick={() => void perform({ kind: "publish", revisionId: data.draft!.id })}
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
