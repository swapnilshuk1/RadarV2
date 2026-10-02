import { createHash, randomUUID } from "node:crypto";
import canonicalLexicon from "../../config/ontologies/lexicon.json";
import canonicalTaxonomy from "../../config/ontologies/taxonomy.json";
import type { DatabaseAdapter } from "../data/database/adapter";
import { appendAdminAudit, requirePlatformRole } from "./service";
import {
  searchTaxonomySchema,
  taxonomyMutationSchema,
  type SearchTaxonomy,
  type TaxonomyMutation,
} from "./taxonomy-contracts";

// Discovery aliases are deliberately not passed to the attention gate. They
// only expand portal query phrasing for an explicitly activated search plan.
const baseline = searchTaxonomySchema.parse({
  taxonomy: canonicalTaxonomy,
  lexicon: canonicalLexicon,
});
export const BASELINE_TAXONOMY_REVISION = "search-taxonomy-baseline-v1";

export type TaxonomyRevision = {
  id: string;
  parent_id: string | null;
  definition_json: string;
  fingerprint: string;
  created_at: number;
  created_by: string;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
export const taxonomyFingerprint = (definition: SearchTaxonomy) =>
  createHash("sha256")
    .update(stableJson(searchTaxonomySchema.parse(definition)))
    .digest("hex");
export const taxonomyState = (activeId: string, draftId?: string | null) =>
  createHash("sha256")
    .update(JSON.stringify([activeId, draftId ?? null]))
    .digest("hex");

async function installed(db: DatabaseAdapter) {
  return Boolean(
    await db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='taxonomy_revisions'"),
  );
}

async function ensureBaseline(db: DatabaseAdapter) {
  if (!(await installed(db))) return false;
  await db.execute(
    "INSERT OR IGNORE INTO taxonomy_revisions(id,parent_id,definition_json,fingerprint,created_at,created_by) VALUES(?,?,?,?,?,?)",
    [
      BASELINE_TAXONOMY_REVISION,
      null,
      JSON.stringify(baseline),
      taxonomyFingerprint(baseline),
      0,
      "migration",
    ],
  );
  await db.execute("INSERT OR IGNORE INTO taxonomy_active_pointer(id,revision_id) VALUES(1,?)", [
    BASELINE_TAXONOMY_REVISION,
  ]);
  return true;
}

function parsed(row: TaxonomyRevision) {
  return { ...row, definition: searchTaxonomySchema.parse(JSON.parse(row.definition_json)) };
}

export async function activeSearchTaxonomy(db: DatabaseAdapter) {
  if (!(await installed(db)))
    return {
      id: BASELINE_TAXONOMY_REVISION,
      definition: baseline,
      fingerprint: taxonomyFingerprint(baseline),
    };
  const pointer = await db.one<{ revision_id: string }>(
    "SELECT revision_id FROM taxonomy_active_pointer WHERE id=1",
  );
  if (!pointer)
    return {
      id: BASELINE_TAXONOMY_REVISION,
      definition: baseline,
      fingerprint: taxonomyFingerprint(baseline),
    };
  const row = await db.one<TaxonomyRevision>("SELECT * FROM taxonomy_revisions WHERE id=?", [
    pointer?.revision_id,
  ]);
  if (!row) throw new Error("TAXONOMY_ACTIVE_REVISION_MISSING");
  return parsed(row);
}

function validateDefinition(definition: SearchTaxonomy) {
  const parsedDefinition = searchTaxonomySchema.parse(definition);
  const phrasesByConcept = new Map<string, string>();
  for (const [dimension, concepts] of Object.entries(parsedDefinition.lexicon.dimensions)) {
    for (const [concept, phrases] of Object.entries(concepts)) {
      for (const phrase of phrases) {
        const key = phrase.toLowerCase().replace(/\s+/g, " ");
        const owner = phrasesByConcept.get(key);
        if (owner && owner !== `${dimension}:${concept}`)
          throw new Error(`TAXONOMY_DUPLICATE_ALIAS: '${phrase}' is already assigned to ${owner}`);
        phrasesByConcept.set(key, `${dimension}:${concept}`);
      }
    }
  }
  return parsedDefinition;
}

function isSafeNewAlias(phrase: string) {
  const words = phrase.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const functional = words.filter(
    (word) =>
      ![
        "chief",
        "vp",
        "svp",
        "evp",
        "vice",
        "president",
        "director",
        "head",
        "lead",
        "officer",
        "senior",
        "global",
        "executive",
      ].includes(word),
  );
  return phrase.length >= 3 && functional.length > 0;
}

async function revision(db: DatabaseAdapter, id: string) {
  const row = await db.one<TaxonomyRevision>("SELECT * FROM taxonomy_revisions WHERE id=?", [id]);
  if (!row) throw new Error("TAXONOMY_REVISION_NOT_FOUND");
  return parsed(row);
}

async function createDraft(
  db: DatabaseAdapter,
  activeId: string,
  definition: SearchTaxonomy,
  actor: string,
) {
  const parsedDefinition = validateDefinition(definition);
  const id = randomUUID();
  await db.execute(
    "INSERT INTO taxonomy_revisions(id,parent_id,definition_json,fingerprint,created_at,created_by) VALUES(?,?,?,?,?,?)",
    [
      id,
      activeId,
      JSON.stringify(parsedDefinition),
      taxonomyFingerprint(parsedDefinition),
      Date.now(),
      actor,
    ],
  );
  await db.execute(
    "INSERT INTO taxonomy_drafts(id,revision_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET revision_id=excluded.revision_id",
    [id],
  );
  return id;
}

export async function readTaxonomySnapshot(db: DatabaseAdapter, actor: string) {
  const role = await requirePlatformRole(db, actor);
  const active = await activeSearchTaxonomy(db);
  if (!(await installed(db)))
    return {
      role,
      active,
      draft: null,
      history: [],
      state: taxonomyState(active.id),
      installed: false,
    };
  const draftPointer = await db.one<{ revision_id: string }>(
    "SELECT revision_id FROM taxonomy_drafts WHERE id=1",
  );
  const history = await db.many<TaxonomyRevision>(
    "SELECT * FROM taxonomy_revisions ORDER BY created_at DESC LIMIT 30",
  );
  return {
    role,
    active,
    draft: draftPointer ? await revision(db, draftPointer.revision_id) : null,
    history: history.map(parsed),
    state: taxonomyState(active.id, draftPointer?.revision_id),
    installed: true,
  };
}

export async function mutateTaxonomy(db: DatabaseAdapter, actor: string, input: TaxonomyMutation) {
  const data = taxonomyMutationSchema.parse(input);
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    if (!(await ensureBaseline(tx))) throw new Error("TAXONOMY_UNAVAILABLE");
    const active = await activeSearchTaxonomy(tx);
    const draftPointer = await tx.one<{ revision_id: string }>(
      "SELECT revision_id FROM taxonomy_drafts WHERE id=1",
    );
    if (data.expectedState !== taxonomyState(active.id, draftPointer?.revision_id))
      throw new Error("ADMIN_STATE_CHANGED; refresh before retrying");
    let id: string;
    if (data.kind === "draft_concept") {
      const current = draftPointer ? await revision(tx, draftPointer.revision_id) : active;
      const dimension = current.definition.lexicon.dimensions[data.dimension];
      if (!dimension?.[data.concept]) throw new Error("TAXONOMY_CONCEPT_NOT_FOUND");
      const existing = new Set(
        dimension[data.concept].map((phrase) => phrase.toLowerCase().replace(/\s+/g, " ")),
      );
      for (const phrase of data.phrases) {
        const normalized = phrase.toLowerCase().replace(/\s+/g, " ");
        if (!existing.has(normalized) && !isSafeNewAlias(phrase))
          throw new Error("TAXONOMY_ALIAS_NEEDS_FUNCTIONAL_SIGNAL");
      }
      const definition = structuredClone(current.definition);
      definition.lexicon.dimensions[data.dimension][data.concept] = [
        ...new Set(data.phrases.map((phrase) => phrase.trim())),
      ];
      definition.taxonomy.descriptions[data.concept] = data.description;
      id = await createDraft(tx, active.id, definition, actor);
    } else if (data.kind === "revert") {
      const target = await revision(tx, data.revisionId);
      id = await createDraft(tx, active.id, target.definition, actor);
    } else {
      const target = await revision(tx, data.revisionId);
      if (draftPointer?.revision_id !== target.id || target.parent_id !== active.id)
        throw new Error("TAXONOMY_DRAFT_CHANGED");
      id = target.id;
      if (data.kind === "discard") await tx.execute("DELETE FROM taxonomy_drafts WHERE id=1");
      else {
        await tx.execute(
          "INSERT INTO taxonomy_active_pointer(id,revision_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET revision_id=excluded.revision_id",
          [target.id],
        );
        await tx.execute("DELETE FROM taxonomy_drafts WHERE id=1");
      }
    }
    await appendAdminAudit(tx, {
      actor,
      action: `taxonomy.${data.kind}`,
      target: id,
      reason: data.reason,
      detail: { before: { revisionId: active.id }, after: { revisionId: id } },
    });
    return { id };
  });
}
