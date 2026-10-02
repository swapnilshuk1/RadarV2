import { createHash, randomUUID } from "node:crypto";
import canonicalLexicon from "../../config/ontologies/lexicon.json";
import canonicalTaxonomy from "../../config/ontologies/taxonomy.json";
import { SearchPlanner } from "../../scripts/scraper/run/search-planner";
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
  requires_shadow?: number;
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
  requiresShadow = false,
) {
  const parsedDefinition = validateDefinition(definition);
  const id = randomUUID();
  await db.execute(
    "INSERT INTO taxonomy_revisions(id,parent_id,definition_json,fingerprint,created_at,created_by,requires_shadow) VALUES(?,?,?,?,?,?,?)",
    [
      id,
      activeId,
      JSON.stringify(parsedDefinition),
      taxonomyFingerprint(parsedDefinition),
      Date.now(),
      actor,
      requiresShadow ? 1 : 0,
    ],
  );
  await db.execute(
    "INSERT INTO taxonomy_drafts(id,revision_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET revision_id=excluded.revision_id",
    [id],
  );
  return id;
}

type ShadowPlan = { id: string; criteria_json: string };
type TaxonomyShadowResult = {
  plansExamined: number;
  plansChanged: number;
  queriesAdded: number;
  queriesRemoved: number;
  changes: Array<{ planId: string; added: string[]; removed: string[] }>;
};

function queryPlan(criteria: Record<string, unknown>, definition: SearchTaxonomy): string[] {
  const parameters = (criteria.customParameters ?? {}) as Record<string, unknown>;
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const targetRoles = strings(criteria.targetRoles);
  const targetSeniority = strings(criteria.targetSeniority);
  const functions = strings(parameters.functions ?? parameters.function);
  if (!targetRoles.length && !functions.length)
    throw new Error("TAXONOMY_SHADOW_PLAN_CRITERIA_INVALID");
  return SearchPlanner.plan(
    {
      targetLevel: targetSeniority,
      functions,
      operatingModels: strings(parameters.operatingModels),
      ownership: strings(parameters.ownership),
      industries: strings(criteria.targetIndustries),
      exclusions: strings(criteria.excludedCompanies),
      targetTitles: targetRoles,
      preferredLocations: strings(criteria.targetLocations),
    },
    definition.taxonomy,
    definition.lexicon,
  ).rankedQueries.map((item) => item.query);
}

async function shadowTaxonomy(
  db: DatabaseAdapter,
  actor: string,
  active: Awaited<ReturnType<typeof activeSearchTaxonomy>>,
  draft: Awaited<ReturnType<typeof revision>>,
) {
  const plans = await db.many<ShadowPlan>(
    "SELECT id,criteria_json FROM search_plans WHERE status='active' ORDER BY id LIMIT 101",
  );
  if (plans.length > 100) throw new Error("TAXONOMY_SHADOW_SCOPE_TOO_LARGE");
  const changes: TaxonomyShadowResult["changes"] = [];
  let queriesAdded = 0;
  let queriesRemoved = 0;
  for (const plan of plans) {
    let criteria: Record<string, unknown>;
    try {
      criteria = JSON.parse(plan.criteria_json) as Record<string, unknown>;
      const params = (criteria.customParameters ?? {}) as Record<string, unknown>;
      const saved = Array.isArray(params.generatedQueries)
        ? params.generatedQueries.filter((query): query is string => typeof query === "string")
        : null;
      const before = new Set(saved?.length ? saved : queryPlan(criteria, active.definition));
      const after = new Set(queryPlan(criteria, draft.definition));
      const added = [...after].filter((query) => !before.has(query));
      const removed = [...before].filter((query) => !after.has(query));
      if (added.length || removed.length) {
        changes.push({ planId: plan.id, added, removed });
        queriesAdded += added.length;
        queriesRemoved += removed.length;
      }
    } catch (cause) {
      throw new Error(
        `TAXONOMY_SHADOW_FAILED:${plan.id}:${cause instanceof Error ? cause.message : "INVALID_PLAN"}`,
      );
    }
  }
  const result: TaxonomyShadowResult = {
    plansExamined: plans.length,
    plansChanged: changes.length,
    queriesAdded,
    queriesRemoved,
    changes,
  };
  const id = randomUUID();
  await db.execute(
    "INSERT INTO taxonomy_shadow_runs(id,revision_id,active_revision_id,status,result_json,error,created_at,created_by) VALUES(?,?,?,'passed',?,?,?,?)",
    [id, draft.id, active.id, JSON.stringify(result), null, Date.now(), actor],
  );
  return { id, result };
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
      shadows: [],
      state: taxonomyState(active.id),
      installed: false,
    };
  const draftPointer = await db.one<{ revision_id: string }>(
    "SELECT revision_id FROM taxonomy_drafts WHERE id=1",
  );
  const history = await db.many<TaxonomyRevision>(
    "SELECT * FROM taxonomy_revisions ORDER BY created_at DESC LIMIT 30",
  );
  const shadows = await db.many<Record<string, string | number | null>>(
    "SELECT id,revision_id,active_revision_id,status,result_json,error,created_at FROM taxonomy_shadow_runs ORDER BY created_at DESC LIMIT 20",
  );
  return {
    role,
    active,
    draft: draftPointer ? await revision(db, draftPointer.revision_id) : null,
    history: history.map(parsed),
    shadows,
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
    } else if (data.kind === "add_concept") {
      const current = draftPointer ? await revision(tx, draftPointer.revision_id) : active;
      const dimension = current.definition.lexicon.dimensions[data.dimension];
      if (!dimension) throw new Error("TAXONOMY_DIMENSION_NOT_FOUND");
      if (dimension[data.concept]) throw new Error("TAXONOMY_CONCEPT_EXISTS");
      for (const phrase of data.phrases)
        if (!isSafeNewAlias(phrase)) throw new Error("TAXONOMY_ALIAS_NEEDS_FUNCTIONAL_SIGNAL");
      const definition = structuredClone(current.definition);
      definition.lexicon.dimensions[data.dimension][data.concept] = [
        ...new Set(data.phrases.map((phrase) => phrase.trim())),
      ];
      definition.taxonomy.descriptions[data.concept] = data.description;
      definition.taxonomy.retired = definition.taxonomy.retired.filter(
        (concept) => concept !== data.concept,
      );
      definition.taxonomy.concentricRings[data.ring] = [
        ...new Set([...definition.taxonomy.concentricRings[data.ring], data.concept]),
      ];
      id = await createDraft(tx, active.id, definition, actor, true);
    } else if (data.kind === "retire_concept") {
      const current = draftPointer ? await revision(tx, draftPointer.revision_id) : active;
      const dimension = current.definition.lexicon.dimensions[data.dimension];
      if (!dimension?.[data.concept]) throw new Error("TAXONOMY_CONCEPT_NOT_FOUND");
      if (Object.keys(dimension).length <= 1) throw new Error("TAXONOMY_DIMENSION_CANNOT_BE_EMPTY");
      const definition = structuredClone(current.definition);
      delete definition.lexicon.dimensions[data.dimension][data.concept];
      definition.taxonomy.retired = [...new Set([...definition.taxonomy.retired, data.concept])];
      for (const ring of ["primary", "adjacent", "excluded"] as const)
        definition.taxonomy.concentricRings[ring] = definition.taxonomy.concentricRings[
          ring
        ].filter((concept) => concept !== data.concept);
      id = await createDraft(tx, active.id, definition, actor, true);
    } else if (data.kind === "revert") {
      const target = await revision(tx, data.revisionId);
      id = await createDraft(
        tx,
        active.id,
        target.definition,
        actor,
        Boolean(target.requires_shadow),
      );
    } else {
      const target = await revision(tx, data.revisionId);
      if (draftPointer?.revision_id !== target.id || target.parent_id !== active.id)
        throw new Error("TAXONOMY_DRAFT_CHANGED");
      id = target.id;
      if (data.kind === "discard") await tx.execute("DELETE FROM taxonomy_drafts WHERE id=1");
      else if (data.kind === "shadow") {
        await shadowTaxonomy(tx, actor, active, target);
      } else {
        if (target.requires_shadow) {
          const shadow = await tx.one<{ id: string }>(
            "SELECT id FROM taxonomy_shadow_runs WHERE revision_id=? AND active_revision_id=? AND status='passed' ORDER BY created_at DESC LIMIT 1",
            [target.id, active.id],
          );
          if (!shadow) throw new Error("TAXONOMY_SHADOW_REQUIRED");
        }
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
