/**
 * src/pursuit/ledger.ts
 *
 * Projects the candidate's canonical evidence into the Evidence Ledger.
 *
 * This module deliberately does NOT ingest documents. Uploading, parsing and
 * fact extraction already happen once, upstream, into candidate_documents and
 * evidence_graphs. Duplicating that would create a second, divergent version of
 * candidate truth — the single most damaging thing this feature could do.
 *
 * What it adds is shape: employer and role attribution, metric isolation, and a
 * capability index, so generation can select evidence without ever inventing it.
 */

import { getDatabaseAdapter } from "../data/database";
import type { ExtractedFact, FactType } from "../domain/evidence";
import { markCurrentProjection, upsertClaims, type ClaimUpsert, type Scope } from "./store";
import type { ClaimType } from "./types";

interface GraphRow {
  id: string;
  document_id: string;
  graph_json: string;
}

const CLAIM_TYPE_BY_FACT: Record<FactType, ClaimType> = {
  EMPLOYMENT: "EMPLOYMENT",
  ACHIEVEMENT: "ACHIEVEMENT",
  LEADERSHIP: "LEADERSHIP",
  TECHNOLOGY: "TECHNOLOGY",
  EDUCATION: "EDUCATION",
  LOCATION: "LOCATION",
  OTHER: "OTHER",
};

/** Quantities are the part of a claim generation may never touch. Isolate them. */
const METRIC_PATTERN =
  /(?:[₹$€£]\s?\d[\d,.]*\s?(?:k|m|bn|cr|crore|lakh|million|billion)?|\d[\d,.]*\s?%|\b\d[\d,.]*\s?(?:x|bps|pp)\b|\b\d{2,}\b)/gi;

function extractMetric(text: string): string | null {
  const matches = text.match(METRIC_PATTERN);
  if (!matches || matches.length === 0) return null;
  return matches.slice(0, 4).join(" · ");
}

/** A line that is only a date range: it dates the role above it, it is not a role. */
const PERIOD_ONLY =
  /^(?:[A-Z][a-z]{2,8}\.?\s*\d{4}|\d{4})\s*(?:[-–—]|to)\s*(?:present\.?|current|[A-Z][a-z]{2,8}\.?\s*\d{4}|\d{4})\.?$/i;

/** Extraction noise from PDF internals — never candidate evidence. */
const SOURCE_NOISE = /^%PDF|^[A-Z]{6}\+|^\/?(?:Type|Font|Encoding)\b/;

/**
 * Office locations frequently trail an employer name on a resume line. They are
 * geography, not the employer, so they must not become the grouping key.
 */
const LOCATION_TAIL =
  /^(?:india|singapore|uae|dubai|abu dhabi|usa|united states|uk|united kingdom|london|new york|mumbai|delhi|new delhi|gurugram|gurgaon|bengaluru|bangalore|chennai|pune|hyderabad|kolkata|apac|emea|mena|remote)$/i;

interface RoleHeader {
  employer: string;
  roleTitle: string | null;
}

/**
 * Reads a resume role header such as
 *   "Senior Vice President — VML (WPP Group)"
 *   "AGM — Digital Marketing, TVS Motor Company"
 *   "Director of Growth @ Global Consumer Brand (2016 - 2021)"
 * and returns the employer separately from the title. Anything that does not
 * look like a header returns null so the caller keeps the previous employer.
 */
function parseRoleHeader(span: string): RoleHeader | null {
  const line = span.replace(/\s+/g, " ").trim();
  if (line.length < 5 || line.length > 140) return null;
  if (PERIOD_ONLY.test(line) || SOURCE_NOISE.test(line)) return null;
  // Sentences are bullets, not headers.
  if (
    /[.!?]\s+\S/.test(line) ||
    /\b(led|managed|scaled|delivered|built|drove|owned)\b/i.test(line)
  ) {
    return null;
  }

  const [head] = line.split(/\s*\((?:19|20)\d{2}\b/);
  const parts = head
    .split(/\s+[—–]\s+|\s+@\s+|\s+\bat\b\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const title = parts[0];
  let employer = parts
    .slice(1)
    .join(" — ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "Digital Marketing, TVS Motor Company" — the trailing segment is the company,
  // unless it is only the office location ("Patt & Hoff Group, Singapore").
  const commaParts = employer
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length > 1) {
    const meaningful = commaParts.filter((part) => !LOCATION_TAIL.test(part));
    employer = (meaningful.length > 0 ? meaningful : commaParts)[
      (meaningful.length > 0 ? meaningful : commaParts).length - 1
    ];
  }
  employer = employer.replace(/[.,;/\s]+$/, "").trim();

  if (employer.length < 2 || employer.length > 80) return null;
  if (PERIOD_ONLY.test(employer) || /^(?:present|current)\.?$/i.test(employer)) return null;
  return { employer, roleTitle: title.length > 1 && title.length < 90 ? title : null };
}

const CAPABILITY_VOCABULARY: Array<{ capability: string; pattern: RegExp }> = [
  { capability: "Brand & Marketing", pattern: /\b(brand|marketing|campaign|advertis)/i },
  {
    capability: "Digital & Performance",
    pattern: /\b(digital|performance marketing|seo|sem|paid media|programmatic)/i,
  },
  {
    capability: "MarTech & Automation",
    pattern: /\b(martech|salesforce|sfmc|crm|automation|adobe|hubspot)/i,
  },
  { capability: "P&L & Commercial", pattern: /\b(p&l|revenue|margin|budget|cost|pricing|profit)/i },
  {
    capability: "Team Leadership",
    pattern: /\b(led|leading|managed|mentor|hired|built a team|headcount)/i,
  },
  {
    capability: "Transformation",
    pattern: /\b(transform|migrat|re-?platform|turnaround|restructur)/i,
  },
  {
    capability: "Global Capability Centre",
    pattern: /\b(gcc|global capability|shared services|gss|offshore)/i,
  },
  { capability: "Automotive", pattern: /\b(automotive|auto|vehicle|mobility|oem|dealer)/i },
  { capability: "Agency", pattern: /\b(agency|client servicing|pitch|account management)/i },
  { capability: "Analytics", pattern: /\b(analytic|data|dashboard|attribution|measurement)/i },
];

function deriveCapabilities(text: string): string[] {
  return CAPABILITY_VOCABULARY.filter((entry) => entry.pattern.test(text)).map(
    (entry) => entry.capability,
  );
}

/**
 * The canonical candidate source set: the evidence graphs bound to one exact
 * profile version (profile_projection_source_bindings). Historical re-extractions
 * of the same CV are never projected alongside the current one.
 *
 * profileVersion should be the evaluation context's profile version when the
 * caller has one (Pursuit derivation does); otherwise the most recently bound
 * profile version is current.
 */
export async function resolveCanonicalSources(
  scope: Scope,
  profileVersion?: string | null,
): Promise<{
  profileVersion: string | null;
  graphIds: string[];
  documentIds: string[];
  fingerprint: string;
}> {
  const db = getDatabaseAdapter();
  const explicitVersion = profileVersion !== undefined;
  if (explicitVersion && !profileVersion) throw new Error("PROFILE_BINDING_NOT_FOUND");
  let version = profileVersion ?? null;
  if (!explicitVersion) {
    const latest = await db.one<{ profile_version: string }>(
      `SELECT profile_version FROM profile_projection_source_bindings
       WHERE tenant_id = ? AND person_id = ? ORDER BY created_at DESC, profile_version DESC LIMIT 1`,
      [scope.tenantId, scope.personId],
    );
    version = latest?.profile_version ?? null;
  }
  if (!version) return { profileVersion: null, graphIds: [], documentIds: [], fingerprint: "none" };
  const rows = await db.many<{ document_id: string; evidence_graph_id: string }>(
    `SELECT document_id, evidence_graph_id FROM profile_projection_source_bindings
     WHERE tenant_id = ? AND person_id = ? AND profile_version = ? ORDER BY document_id`,
    [scope.tenantId, scope.personId, version],
  );
  if (explicitVersion && rows.length === 0) throw new Error("PROFILE_BINDING_NOT_FOUND");
  const graphIds = rows.map((r) => r.evidence_graph_id);
  return {
    profileVersion: version,
    graphIds,
    documentIds: rows.map((r) => r.document_id),
    fingerprint: `${version}:${[...graphIds].sort().join(",")}`,
  };
}

export interface LedgerState {
  profileVersion: string | null;
  bindingFingerprint: string;
  claims: number;
  documents: number;
  projectedAt: string | null;
}

export async function readLedgerState(scope: Scope): Promise<LedgerState | null> {
  const row = await getDatabaseAdapter().one<{
    profile_version: string | null;
    binding_fingerprint: string;
    claim_count: number;
    document_count: number;
    projected_at: string;
  }>(
    `SELECT profile_version, binding_fingerprint, claim_count, document_count, projected_at
     FROM pursuit_ledger_projection_state WHERE tenant_id = ? AND person_id = ?`,
    [scope.tenantId, scope.personId],
  );
  return row
    ? {
        profileVersion: row.profile_version,
        bindingFingerprint: row.binding_fingerprint,
        claims: row.claim_count,
        documents: row.document_count,
        projectedAt: row.projected_at,
      }
    : null;
}

/** Cheap staleness check: bindings only, never graph bodies. */
export async function isLedgerStale(
  scope: Scope,
  profileVersion?: string | null,
): Promise<boolean> {
  const [sources, state] = await Promise.all([
    resolveCanonicalSources(scope, profileVersion),
    readLedgerState(scope),
  ]);
  return !state || state.bindingFingerprint !== sources.fingerprint;
}

/**
 * Project the ledger from the canonical source binding. No-op when the binding
 * fingerprint is unchanged, so repeated calls cost one small indexed read.
 * Claims from graphs outside the current binding are flagged superseded (kept,
 * because earlier strategy versions reference them) and never served.
 */
export async function projectLedger(
  scope: Scope,
  options: { profileVersion?: string | null; force?: boolean } = {},
): Promise<{
  claims: number;
  documents: number;
  skipped: boolean;
  fingerprint: string;
  profileVersion: string | null;
}> {
  const db = getDatabaseAdapter();
  const sources = await resolveCanonicalSources(scope, options.profileVersion);
  const state = await readLedgerState(scope);
  if (!options.force && state && state.bindingFingerprint === sources.fingerprint) {
    return {
      claims: state.claims,
      documents: state.documents,
      skipped: true,
      fingerprint: sources.fingerprint,
      profileVersion: sources.profileVersion,
    };
  }

  const graphs = sources.graphIds.length
    ? await db.many<GraphRow>(
        `SELECT id, document_id, graph_json FROM evidence_graphs
         WHERE tenant_id = ? AND person_id = ? AND id IN (${sources.graphIds.map(() => "?").join(",")})`,
        [scope.tenantId, scope.personId, ...sources.graphIds],
      )
    : [];

  const upserts: ClaimUpsert[] = [];
  const documents = new Set<string>();

  for (const graph of graphs) {
    let facts: ExtractedFact[] = [];
    try {
      const parsed = JSON.parse(graph.graph_json) as { facts?: ExtractedFact[] };
      facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    } catch {
      continue;
    }
    documents.add(graph.document_id);

    // Facts arrive in document order, so a role header attributes every
    // achievement beneath it until the next header.
    let current: RoleHeader | null = null;
    let ordinal = 0;

    for (const fact of facts) {
      ordinal += 1;
      if (!fact?.value || typeof fact.value !== "string") continue;
      const span = fact.sourceSpan ?? fact.value;
      if (SOURCE_NOISE.test(span.trim()) || SOURCE_NOISE.test(fact.value.trim())) continue;
      if (PERIOD_ONLY.test(fact.value.trim())) continue;

      const header = fact.type === "EMPLOYMENT" ? parseRoleHeader(span) : null;
      if (header) current = header;
      const employer = header?.employer ?? current?.employer ?? null;
      const roleTitle = header?.roleTitle ?? current?.roleTitle ?? null;
      const combined = `${fact.value} ${fact.sourceSpan ?? ""}`;
      upserts.push({
        statement: fact.value.trim(),
        claimType: CLAIM_TYPE_BY_FACT[fact.type] ?? "OTHER",
        employer,
        roleTitle,
        metricResult: extractMetric(fact.value),
        capabilities: deriveCapabilities(combined),
        sourceDocumentId: graph.document_id,
        sourceEvidenceGraphId: graph.id,
        sourceFactId: fact.id ?? `${graph.id}:${fact.value.slice(0, 40)}`,
        sourceLocator: fact.sourceSpan ?? null,
        sourceOrdinal: ordinal,
        profileVersion: sources.profileVersion,
        provenance: "SOURCE_BACKED",
        verificationState: "EXTRACTED",
        confidence: typeof fact.confidence === "number" ? fact.confidence : null,
      });
    }
  }

  const written = await upsertClaims(scope, upserts);
  await markCurrentProjection(scope, sources.graphIds);
  await db.execute(
    `INSERT INTO pursuit_ledger_projection_state
       (tenant_id, person_id, profile_version, binding_fingerprint, claim_count, document_count, projected_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (tenant_id, person_id) DO UPDATE SET
       profile_version = excluded.profile_version, binding_fingerprint = excluded.binding_fingerprint,
       claim_count = excluded.claim_count, document_count = excluded.document_count,
       projected_at = excluded.projected_at`,
    [
      scope.tenantId,
      scope.personId,
      sources.profileVersion,
      sources.fingerprint,
      written,
      documents.size,
      new Date().toISOString(),
    ],
  );
  return {
    claims: written,
    documents: documents.size,
    skipped: false,
    fingerprint: sources.fingerprint,
    profileVersion: sources.profileVersion,
  };
}
