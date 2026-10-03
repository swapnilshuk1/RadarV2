import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { changeTaxonomyFn } from "./taxonomy-server";
import {
  baselineIntelligenceTaxonomy,
  type IntelligenceNode,
} from "../lib/ontology/intelligence-taxonomy";
import type { TaxonomyMutation } from "./taxonomy-contracts";
type Snapshot = Awaited<ReturnType<typeof import("./taxonomy-store").readTaxonomySnapshot>>;
const button = "border border-border px-3 py-2 text-sm disabled:opacity-40";
export function IntelligenceTaxonomyControls({
  data,
  onDirty,
}: {
  data: Snapshot;
  onDirty: (value: boolean) => void;
}) {
  const router = useRouter(),
    definition =
      (data.draft ?? data.active).definition.intelligence ?? baselineIntelligenceTaxonomy,
    operator = data.role === "operator";
  const [selected, setSelected] = useState(
      definition.nodes.find((n) => n.kind === "capability")?.id ?? definition.nodes[0].id,
    ),
    [search, setSearch] = useState(""),
    [retired, setRetired] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const node = definition.nodes.find((n) => n.id === selected) ?? definition.nodes[0];
  const [name, setName] = useState(node.name),
    [description, setDescription] = useState(node.description),
    [aliases, setAliases] = useState(node.aliases.join("\n")),
    [parent, setParent] = useState(node.parentId ?? ""),
    [classification, setClassification] = useState(node.classification);
  const [newId, setNewId] = useState(""),
    [newName, setNewName] = useState(""),
    [newKind, setNewKind] = useState<IntelligenceNode["kind"]>("capability"),
    [newParent, setNewParent] = useState("");
  useEffect(() => {
    if (!node) return;
    setName(node.name);
    setDescription(node.description);
    setAliases(node.aliases.join("\n"));
    setParent(node.parentId ?? "");
    setClassification(node.classification);
  }, [node]);
  useEffect(
    () =>
      onDirty(
        name !== node.name ||
          description !== node.description ||
          aliases !== node.aliases.join("\n") ||
          parent !== (node.parentId ?? "") ||
          classification !== node.classification,
      ),
    [onDirty, name, description, aliases, parent, classification, node],
  );
  const parents = (kind: string) =>
    definition.nodes.filter(
      (n) => !n.retired && n.kind === (kind === "capability" ? "discipline" : "domain"),
    );
  const perform = async (input: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await changeTaxonomyFn({
        data: { ...input, reason, expectedState: data.state } as TaxonomyMutation,
      });
      setReason("");
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Taxonomy mutation failed");
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || !operator || reason.trim().length < 3 || node.retired;
  const values = definition.nodes.filter(
    (n) =>
      (retired || !n.retired) &&
      [n.id, n.name, ...n.aliases].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section aria-label="Intelligence taxonomy" className="mb-8 border-y-2 border-foreground py-5">
      <h2 className="font-serif text-2xl">Intelligence taxonomy</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
        Domains contain disciplines; disciplines contain capabilities. Names and aliases help RADAR
        interpret search intent and evidenced mandates. Classifications are advisory: CORE, ADJACENT
        or CONTEXT never exclude an opportunity or supply candidate evidence. Published revisions
        affect newly activated plans; existing evaluations keep their snapshot.
      </p>
      <div className="my-4 flex flex-wrap gap-4">
        <input
          aria-label="Search intelligence taxonomy"
          placeholder="Find a concept or alias"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-border bg-background p-2"
        />
        <label>
          <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} />{" "}
          Show retired identities
        </label>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border text-left">
                <th>Concept / identity</th>
                <th>Parent</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {values.map((n) => (
                <tr key={n.id} className="border-b border-border">
                  <td className="py-2">
                    <button className="text-left underline" onClick={() => setSelected(n.id)}>
                      {n.name}
                    </button>
                    <p className="font-mono text-xs text-muted-foreground">
                      {n.kind} · {n.id}
                      {n.retired ? " · Retired" : ""}
                    </p>
                  </td>
                  <td>{definition.nodes.find((p) => p.id === n.parentId)?.name ?? "Root"}</td>
                  <td>{n.classification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border border-border p-4">
          <h3 className="font-serif text-xl">{node.name}</h3>
          <p className="mt-1 font-mono text-xs">Stable identity: {node.id}</p>
          <label className="mt-3 block text-sm">
            Name
            <input
              aria-label="Intelligence concept name"
              disabled={!operator || node.retired}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border border-border bg-background p-2"
            />
          </label>
          <label className="mt-3 block text-sm">
            Description (display only)
            <textarea
              aria-label="Intelligence description"
              disabled={!operator || node.retired}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full border border-border bg-background p-2"
            />
          </label>
          <label className="mt-3 block text-sm">
            Aliases (one per line)
            <textarea
              aria-label="Intelligence aliases"
              disabled={!operator || node.retired}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              className="mt-1 min-h-32 w-full border border-border bg-background p-2"
            />
          </label>
          {operator && (
            <>
              <label className="mt-3 block text-sm">
                Action reason
                <input
                  aria-label="Intelligence action reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full border border-border bg-background p-2"
                />
              </label>
              <button
                className={`${button} mt-3`}
                disabled={disabled}
                onClick={() =>
                  void perform({
                    kind: "intelligence_edit",
                    nodeId: node.id,
                    name,
                    description,
                    aliases: aliases
                      .split("\n")
                      .map((a) => a.trim())
                      .filter(Boolean),
                  })
                }
              >
                Save intelligence draft
              </button>
              {node.kind !== "domain" && (
                <>
                  <label className="mt-3 block text-sm">
                    Parent
                    <select
                      aria-label="Intelligence parent"
                      value={parent}
                      onChange={(e) => setParent(e.target.value)}
                      className="mt-1 w-full border border-border bg-background p-2"
                    >
                      {parents(node.kind).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={`${button} mt-2`}
                    disabled={disabled || parent === node.parentId}
                    onClick={() =>
                      void perform({ kind: "intelligence_move", nodeId: node.id, parentId: parent })
                    }
                  >
                    Draft parent change
                  </button>
                </>
              )}
              <label className="mt-3 block text-sm">
                Classification
                <select
                  aria-label="Intelligence classification"
                  value={classification}
                  onChange={(e) => setClassification(e.target.value as typeof classification)}
                  className="mt-1 w-full border border-border bg-background p-2"
                >
                  {["CORE", "ADJACENT", "CONTEXT"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={disabled || classification === node.classification}
                  onClick={() =>
                    void perform({ kind: "intelligence_classify", nodeId: node.id, classification })
                  }
                >
                  Draft classification
                </button>
                <button
                  className={button}
                  disabled={disabled}
                  onClick={() => void perform({ kind: "intelligence_retire", nodeId: node.id })}
                >
                  Retire intelligence concept
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Retiring a parent also retires its descendants in the new revision. Historical
                identity and prior evaluations remain available.
              </p>
            </>
          )}
        </div>
      </div>
      {operator && (
        <details className="mt-5 border border-border p-4">
          <summary>Add intelligence concept</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              Stable identity
              <input
                aria-label="New intelligence identity"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                className="mt-1 w-full border border-border bg-background p-2"
              />
            </label>
            <label>
              Name
              <input
                aria-label="New intelligence name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full border border-border bg-background p-2"
              />
            </label>
            <label>
              Kind
              <select
                aria-label="New intelligence kind"
                value={newKind}
                onChange={(e) => {
                  setNewKind(e.target.value as typeof newKind);
                  setNewParent("");
                }}
                className="mt-1 w-full border border-border bg-background p-2"
              >
                {["domain", "discipline", "capability"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            {newKind !== "domain" && (
              <label>
                Parent
                <select
                  aria-label="New intelligence parent"
                  value={newParent}
                  onChange={(e) => setNewParent(e.target.value)}
                  className="mt-1 w-full border border-border bg-background p-2"
                >
                  <option value="">Select parent</option>
                  {parents(newKind).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            className={`${button} mt-3`}
            disabled={
              busy ||
              reason.trim().length < 3 ||
              !newId.trim() ||
              !newName.trim() ||
              (newKind !== "domain" && !newParent)
            }
            onClick={() =>
              void perform({
                kind: "intelligence_add",
                nodeId: newId,
                name: newName,
                nodeKind: newKind,
                parentId: newKind === "domain" ? null : newParent,
                description: "",
                aliases: [],
                classification: "CORE",
              })
            }
          >
            Add to intelligence draft
          </button>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}
      <p className="mt-4 text-sm">
        Review and publish the shared revision below. Changes affecting interpretation require a
        bounded admission-and-verdict shadow. Shadow output never enters the shortlist.
      </p>
    </section>
  );
}
