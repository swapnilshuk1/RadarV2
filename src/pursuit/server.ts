/**
 * src/pursuit/server.ts
 *
 * Every server entry point for the Pursuit Cockpit.
 *
 * Boundary note: this is the only file in src/pursuit/ that touches RADAR's auth
 * and opportunity services. Porting the module to another RADAR instance means
 * adapting this file and role-brief.ts; everything else is self-contained.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDatabaseAdapter } from "../data/database";
import { writeAuthorizedDecision } from "../data/sqlite/repositories/SqliteDecisionSupportStore";
import { requireAuthUser } from "../lib/auth/guard";
import { authenticateTenantMembership, authorizePersonScope } from "../lib/security/auth";
import { resolveServingScope } from "../lib/security/scope-resolver";
import { renderInterviewBrief, renderMessage, renderResume } from "./artifacts";
import { resumeToDocx } from "./export/docx";
import { interviewBriefToPdf, messageToPdf, resumeToPdf } from "./export/pdf";
import { isLedgerStale, projectLedger, readLedgerState, resolveCanonicalSources } from "./ledger";
import { candidateIdentity, loadBrief, resolveLineage } from "./preparation";
import { toRoleBrief } from "./role-brief";
import * as store from "./store";
import { ledgerApprovalBlockers } from "./approval";
import {
  approvalBlockers,
  archetypeInputSchema,
  artifactContentSchema,
  artifactLabels,
  pursuitStatuses,
  type ArtifactContent,
  type CandidateArchetype,
  type CockpitView,
  type LearningSignal,
} from "./types";


/**
 * Scope is resolved server-side from the authenticated session.
 *
 * tenantId/personId stay optional on the wire: ordinary candidate browsing never
 * carries them (the URL is just /opportunity/<jobHash>), and a client-supplied
 * tenant is not a trust boundary. When they ARE supplied — delegated recruiter or
 * admin access — resolveServingScope re-validates membership and person
 * permissions, so cross-tenant access still fails closed.
 */
const scopeInput = z.object({
  tenantId: z.string().min(1).nullish(),
  personId: z.string().min(1).nullish(),
});

async function authorize(
  data: { tenantId?: string | null; personId?: string | null },
  permission: "read:person" | "write:person",
): Promise<store.Scope> {
  const user = await requireAuthUser();
  const db = getDatabaseAdapter();
  if (data.tenantId && data.personId) {
    const auth = await authenticateTenantMembership(user.id, data.tenantId, db);
    return authorizePersonScope(auth, data.personId, db, permission);
  }
  const resolved = await resolveServingScope(
    user.id,
    data.tenantId ?? undefined,
    db,
    data.personId ?? undefined,
    permission,
  );
  return resolved.scope;
}

async function readCockpit(scope: store.Scope, jobHash: string): Promise<CockpitView> {
  const pursuit = await store.getPursuit(scope, jobHash);
  if (!pursuit) throw new Error("PURSUIT_NOT_FOUND");
  const [thesis, thesisHistory, artifacts, archetypes, claims, activities, coverage, preparation] =
    await Promise.all([
      pursuit.activeThesisId ? store.getThesis(pursuit.activeThesisId) : Promise.resolve(null),
      store.listThesisHistory(pursuit.id),
      store.listLatestArtifacts(pursuit.id),
      store.listArchetypes(scope),
      store.listClaims(scope),
      store.listActivities(pursuit.id),
      store.ledgerCoverage(scope),
      store.livePreparation(scope, pursuit.id),
    ]);
  return {
    preparation,
    scope: { tenantId: scope.tenantId, personId: scope.personId },
    pursuit,
    thesis,
    thesisHistory,
    artifacts,
    archetypes,
    claims,
    activities,
    ledgerCoverage: coverage,
  };
}

// ---------------------------------------------------------------------------
// Profile vault
// ---------------------------------------------------------------------------

export const getPursuitVaultFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string; personId: string }) => scopeInput.parse(data))
  .handler(async ({ data }) => {
    const scope = await authorize(data, "read:person");
    // Strictly read-only: a GET never runs an EvidenceGraph projection. When no
    // projection exists the vault reports uninitialised state and the UI offers
    // an explicit "Initialise evidence" action (refreshLedgerFn).
    const ledger = await readLedgerState(scope);
    const [archetypes, claims, coverage, pursuits, sources, stale] = await Promise.all([
      store.listArchetypes(scope),
      store.listClaims(scope),
      store.ledgerCoverage(scope),
      store.listPursuits(scope),
      resolveCanonicalSources(scope),
      ledger ? isLedgerStale(scope) : Promise.resolve(true),
    ]);
    const documents = await store.listSourceDocuments(scope, sources.documentIds);
    return {
      archetypes,
      claims,
      coverage,
      pursuits,
      documents,
      ledger,
      ledgerStale: stale,
      ledgerInitialised: ledger !== null,
    };
  });

/** Explicit refresh when a newer CV profile version has been bound. */
export const refreshLedgerFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => scopeInput.parse(data))
  .handler(async ({ data }) => {
    const scope = await authorize(data, "write:person");
    const projection = await projectLedger(scope);
    const sources = await resolveCanonicalSources(scope);
    return {
      projection,
      claims: await store.listClaims(scope),
      coverage: await store.ledgerCoverage(scope),
      documents: await store.listSourceDocuments(scope, sources.documentIds),
    };
  });

export const saveArchetypeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => scopeInput.extend({ archetype: archetypeInputSchema }).parse(data))
  .handler(async ({ data }) => {
    const scope = await authorize(data, "write:person");
    const archetype = await store.saveArchetype(scope, data.archetype);
    return { archetype, archetypes: await store.listArchetypes(scope) };
  });

export const deleteArchetypeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput.extend({ archetypeId: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }) => {
    const scope = await authorize(data, "write:person");
    await store.deleteArchetype(scope, data.archetypeId);
    return { archetypes: await store.listArchetypes(scope) };
  });

// ---------------------------------------------------------------------------
// Cockpit lifecycle
// ---------------------------------------------------------------------------

/**
 * PURSUE. Idempotent: reopening an existing pursuit returns the saved strategy
 * rather than regenerating it, so a candidate never loses edits by clicking twice.
 */
export const openPursuitFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput.extend({ jobHash: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data }): Promise<CockpitView> => {
    const user = await requireAuthUser();
    const scope = await authorize(data, "write:person");
    const brief = await loadBrief(user.id, scope, data.jobHash);
    const lineage = await resolveLineage(scope, brief);
    await getDatabaseAdapter().transaction(async (tx) => {
      await writeAuthorizedDecision(tx, scope.personId, scope.tenantId, data.jobHash, "PURSUE");
      await store.openPursuitInTransaction(tx, scope, {
        jobHash: data.jobHash, company: brief.company, roleTitle: brief.roleTitle,
      }, user.id, lineage);
    });
    return readCockpit(scope, data.jobHash);
  });

/**
 * Atomic PURSUE. One command records the canonical decision AND opens the
 * pursuit, so the two can never diverge: previously a saved PURSUE could exist
 * with no pursuit (launch failed) or a pursuit with no recorded decision.
 * Ordering is decision-first — the decision is the canonical record; if opening
 * then fails the caller sees the error and retry is idempotent on both halves.
 */
export const pursueOpportunityFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput
      .extend({
        jobHash: z.string().min(1),
        reason: z.string().max(2000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ view: CockpitView; reviewedFingerprint: string | null }> => {
    const user = await requireAuthUser();
    const scope = await authorize(data, "write:person");
    // Reads (opportunity brief, canonical lineage) happen first; then the
    // decision and the pursuit commit in ONE transaction, so a failure after
    // the decision write rolls the decision back too.
    const brief = await loadBrief(user.id, scope, data.jobHash);
    const lineage = await resolveLineage(scope, brief);
    const acknowledgement = await getDatabaseAdapter().transaction(async (tx) => {
      const ack = await writeAuthorizedDecision(
        tx, scope.personId, scope.tenantId, data.jobHash, "PURSUE", data.reason,
      );
      await store.openPursuitInTransaction(
        tx, scope,
        { jobHash: data.jobHash, company: brief.company, roleTitle: brief.roleTitle },
        user.id, lineage,
      );
      return ack;
    });
    return {
      view: await readCockpit(scope, data.jobHash),
      reviewedFingerprint: acknowledgement.reviewedFingerprint ?? null,
    };
  });

export const getCockpitFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => scopeInput.extend({ jobHash: z.string().min(1) }).parse(data))
  .handler(async ({ data }): Promise<CockpitView> => {
    const scope = await authorize(data, "read:person");
    return readCockpit(scope, data.jobHash);
  });

/**
 * Lightweight preparation status. The cockpit polls THIS, never getCockpitFn:
 * one narrow row instead of eight table reads per tick, which keeps the
 * read budget flat while a derivation is in flight.
 */
export const getPursuitPreparationStatusFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => scopeInput.extend({ jobHash: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const scope = await authorize(data, "read:person");
    return store.preparationStatus(scope, data.jobHash);
  });

/**
 * Requests a new strategy version. The request only records the commitment and
 * queues durable preparation; the worker derives the thesis and artifacts.
 * Always appends versions — regeneration never overwrites candidate edits.
 */
export const derivePursuitFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput
      .extend({
        jobHash: z.string().min(1),
        preferredArchetypeId: z.string().min(1).nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<CockpitView> => {
    const user = await requireAuthUser();
    const scope = await authorize(data, "write:person");
    const pursuit = await store.getPursuit(scope, data.jobHash);
    if (!pursuit) throw new Error("PURSUIT_NOT_FOUND");
    await store.enqueuePreparation(scope, {
      pursuitId: pursuit.id,
      jobHash: data.jobHash,
      requestedBy: user.id,
      preferredArchetypeId: data.preferredArchetypeId ?? null,
    });
    await store.updatePursuit(scope, pursuit.id, { preparationState: "QUEUED", preparationError: null });
    return readCockpit(scope, data.jobHash);
  });

// ---------------------------------------------------------------------------
// Editing & learning
// ---------------------------------------------------------------------------

const learningSignalSchema = z.object({
  signalType: z.enum([
    "BULLET_PROMOTED",
    "BULLET_DEMOTED",
    "BULLET_REJECTED",
    "PHRASE_REWRITTEN",
    "ARCHETYPE_OVERRIDDEN",
    "SUMMARY_REWRITTEN",
    "MESSAGE_REWRITTEN",
    "PROOF_SWAPPED",
  ]),
  subject: z.string().max(400).nullable().default(null),
  originalValue: z.string().max(4000).nullable().default(null),
  newValue: z.string().max(4000).nullable().default(null),
});

/** Re-renders text from structured content so exports never drift from the editor. */
function renderArtifact(content: ArtifactContent): string {
  if (content.kind === "RESUME") return renderResume(content.resume);
  if (content.kind === "INTERVIEW_BRIEF") return renderInterviewBrief(content.brief);
  return renderMessage(content.message);
}

export const saveArtifactFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput
      .extend({
        jobHash: z.string().min(1),
        artifactId: z.string().min(1),
        content: artifactContentSchema,
        approve: z.boolean().default(false),
        signals: z.array(learningSignalSchema).max(40).default([]),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<CockpitView> => {
    const user = await requireAuthUser();
    const scope = await authorize(data, "write:person");
    const pursuit = await store.getPursuit(scope, data.jobHash);
    if (!pursuit) throw new Error("PURSUIT_NOT_FOUND");
    const existing = await store.getArtifact(pursuit.id, data.artifactId);
    if (!existing) throw new Error("ARTIFACT_NOT_FOUND");

    const content = data.content as ArtifactContent;
    if (data.approve) {
      const blockers = approvalBlockers(content);
      // Prove edited figures and claim links against the candidate's own ledger.
      const [claims, brief] = await Promise.all([
        store.listClaims(scope),
        loadBrief(user.id, scope, data.jobHash).catch(() => null),
      ]);
      blockers.push(
        ...ledgerApprovalBlockers(content, {
          claims,
          contextText: brief ? JSON.stringify(brief) : "",
          proofRelationships: existing.thesisId
            ? (await store.getThesis(existing.thesisId))?.semantic?.proofRelationships ?? {}
            : {},
        }),
      );
      // Approval is what leaves the system; refuse to mark an incomplete
      // artifact as final rather than exporting placeholders.
      if (blockers.length > 0) throw new Error(`ARTIFACT_NOT_APPROVABLE: ${blockers.join(" ")}`);
    }
    await store.updateArtifactContent(pursuit.id, data.artifactId, content, {
      status: data.approve ? "APPROVED" : "USER_CUSTOMIZED",
      renderedText: renderArtifact(content),
    });

    if (data.signals.length > 0) {
      await store.recordLearningSignals(
        scope,
        { pursuitId: pursuit.id, archetypeId: pursuit.activeArchetypeId },
        data.signals as LearningSignal[],
      );
    }
    return readCockpit(scope, data.jobHash);
  });

export const updatePursuitStateFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput
      .extend({
        jobHash: z.string().min(1),
        status: z.enum(pursuitStatuses).optional(),
        nextAction: z.string().max(400).nullish(),
        nextActionDue: z.string().max(40).nullish(),
        notes: z.string().max(8000).nullish(),
        activeArchetypeId: z.string().min(1).nullish(),
        logActivity: z
          .object({
            activityType: z.string().min(1).max(60),
            summary: z.string().min(1).max(600),
            channel: z.string().max(60).nullish(),
            counterparty: z.string().max(160).nullish(),
          })
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<CockpitView> => {
    if (data.status === "OUTREACH_SENT" || data.logActivity?.activityType === "OUTREACH_SENT")
      throw new Error("APPROVED_OUTREACH_REQUIRED");
    const scope = await authorize(data, "write:person");
    const pursuit = await store.getPursuit(scope, data.jobHash);
    if (!pursuit) throw new Error("PURSUIT_NOT_FOUND");

    await store.updatePursuit(scope, pursuit.id, {
      ...(data.status ? { status: data.status } : {}),
      ...(data.nextAction !== undefined ? { nextAction: data.nextAction ?? null } : {}),
      ...(data.nextActionDue !== undefined ? { nextActionDue: data.nextActionDue ?? null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes ?? null } : {}),
      ...(data.activeArchetypeId !== undefined
        ? { activeArchetypeId: data.activeArchetypeId ?? null }
        : {}),
    });

    if (data.status && data.status !== pursuit.status) {
      await store.recordActivity(pursuit.id, {
        activityType: "STATUS_CHANGED",
        summary: `Stage moved from ${pursuit.status} to ${data.status}.`,
      });
    }
    if (data.logActivity) {
      await store.recordActivity(pursuit.id, data.logActivity);
    }
    return readCockpit(scope, data.jobHash);
  });

export const markOutreachSentFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => scopeInput.extend({
    jobHash: z.string().min(1), artifactId: z.string().min(1),
  }).parse(data))
  .handler(async ({ data }): Promise<CockpitView> => {
    const scope = await authorize(data, "write:person");
    await store.recordApprovedOutreachSent(scope, data.jobHash, data.artifactId);
    return readCockpit(scope, data.jobHash);
  });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "pursuit";

/**
 * Exports the *saved* artifact, never a freshly generated one: what the candidate
 * reviewed and edited is exactly what leaves the system.
 */
export const exportArtifactFn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    scopeInput
      .extend({
        jobHash: z.string().min(1),
        artifactId: z.string().min(1),
        format: z.enum(["PDF", "DOCX", "TXT"]),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const scope = await authorize(data, "read:person");
    const pursuit = await store.getPursuit(scope, data.jobHash);
    if (!pursuit) throw new Error("PURSUIT_NOT_FOUND");
    const artifact = await store.requireApprovedArtifact(pursuit.id, data.artifactId);

    const identity = await candidateIdentity(scope);
    const label = artifactLabels[artifact.artifactType];
    const base = `${slug(identity.fullName)}-${slug(pursuit.company ?? "")}-${slug(label)}`;
    const content = artifact.content;

    if (data.format === "TXT") {
      return {
        filename: `${base}.txt`,
        mimeType: "text/plain",
        base64: toBase64(new TextEncoder().encode(renderArtifact(content))),
      };
    }

    if (data.format === "DOCX") {
      if (content.kind !== "RESUME") throw new Error("DOCX_ONLY_SUPPORTED_FOR_RESUME");
      return {
        filename: `${base}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64: toBase64(resumeToDocx(content.resume)),
      };
    }

    const title = `${identity.fullName} — ${label}`;
    const bytes =
      content.kind === "RESUME"
        ? resumeToPdf(content.resume)
        : content.kind === "INTERVIEW_BRIEF"
          ? interviewBriefToPdf(content.brief, title)
          : messageToPdf(content.message, title);

    return { filename: `${base}.pdf`, mimeType: "application/pdf", base64: toBase64(bytes) };
  });
