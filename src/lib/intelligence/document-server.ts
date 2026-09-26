/**
 * document-server.ts
 *
 * TanStack Start transport adapters for candidate documents, pipeline execution, and versioned intent.
 * Strict Authentication & Authorization Enforcement (ADR-008).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { EvaluationCoordinator } from "./EvaluationCoordinator";
import { requireAuthUser } from "../auth/guard";
import type { CareerIntentRecord } from "../../data/sqlite/repositories/SqliteDocumentStore";
import { activateSearchPlanForIntent, validateIntentActivationPreconditions } from "./search-plan-activation";
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../../data/database";
import { authenticateTenantMembership, authorizePersonScope } from "../security/auth";

export async function authorizeCandidate(userId: string, tenantId: string, personId: string, permission: "read:person" | "write:person") {
  const db = getDatabaseAdapter();
  const auth = await authenticateTenantMembership(userId, tenantId, db);
  return authorizePersonScope(auth, personId, db, permission);
}

export const getDefaultProfileScopeFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const db = getDatabaseAdapter();
  const person = await db.one<{ tenant_id: string | null }>("SELECT tenant_id FROM people WHERE id = ?", [user.id]);
  if (!person?.tenant_id) throw new Error("PROFILE_SCOPE_REQUIRED");
  return authorizeCandidate(user.id, person.tenant_id, user.id, "read:person");
});

/**
 * Accepts a protected document and acknowledges only a durable queued job.
 */
export const uploadDocumentFn = createServerFn({ method: "POST" })
  .validator((data: {
    tenantId: string;
    personId: string;
    filename: string;
    mimeType: string;
    documentText?: string;
    base64Buffer?: string;
  }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = await authorizeCandidate(user.id, data.tenantId, data.personId, "write:person");
    const repos = getRepositories();
    const payloadBytes = data.base64Buffer ? Buffer.from(data.base64Buffer, "base64") : Buffer.from(data.documentText || "", "utf8");
    const contentHash = crypto.createHash("sha256").update(payloadBytes).digest("hex");
    // Content hashes are provenance, never protected document identity. Each
    // upload receives its own owner-safe identity, even if another candidate
    // has uploaded byte-identical content.
    const documentId = `doc-${crypto.randomUUID()}`;
    // Accepted means durably queued, never merely attached to this request's
    // process lifetime. A worker/bootstrap owns subsequent processing.
    await repos.documents.saveDocument(scope, {
      id: documentId, tenantId: scope.tenantId, personId: scope.personId, filename: data.filename,
      storageUri: `turso://document_contents/${documentId}`, mimeType: data.mimeType,
      documentHash: contentHash, status: "UPLOADED", stage: "DOCUMENT_REGISTERED",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await repos.documents.enqueueDocumentProcessing(scope, {
      id: `document-job-${crypto.randomUUID()}`,
      documentId,
      // Retry/job identity is independent of both owner and document content.
      jobHash: `document-job:${documentId}`,
      payloadJson: JSON.stringify({ filename: data.filename, mimeType: data.mimeType, documentText: data.documentText, base64Buffer: data.base64Buffer, documentHash: contentHash }),
    });

    return {
      success: true,
      documentId,
      personId: scope.personId,
      status: "ACCEPTED",
      message: "Document received and durably queued for processing."
    };
  });

/**
 * Transport adapter returning live pipeline status for UI progress display.
 */
export const getPipelineStatusFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string; personId: string; documentId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = await authorizeCandidate(user.id, data.tenantId, data.personId, "read:person");
    const repos = getRepositories();
    const doc = await repos.documents.getDocument(scope, data.documentId);
    if (!doc) {
      return { success: false, error: "Document not found" };
    }
    return {
      success: true,
      documentId: doc.id,
      stage: doc.stage,
      status: doc.status,
      errorMessage: doc.errorMessage,
      updatedAt: doc.updatedAt
    };
  });

/**
 * Transport adapter for saving versioned Candidate Intent (ADR-012).
 */
export const saveIntentFn = createServerFn({ method: "POST" })
  .validator((intent: {
    tenantId: string;
    personId: string;
    currency?: "INR" | "USD" | "EUR" | "GBP";
    targetSalaryAmount?: number;
    minSalaryUsd?: number;
    preferredLocations: string[];
    targetTitles: string[];
    preferredWorkModel?: "HYBRID" | "REMOTE" | "ON_SITE" | "ANY";
    travelTolerance?: "HIGH" | "MEDIUM" | "LOW";
  }) => intent)
  .handler(async ({ data: intent }) => {
    const user = await requireAuthUser();
    const scope = await authorizeCandidate(user.id, intent.tenantId, intent.personId, "write:person");
    const repos = getRepositories();

    const intentRecord: CareerIntentRecord = {
      personId: scope.personId,
      currency: intent.currency,
      targetSalaryAmount: intent.targetSalaryAmount,
      // A normalized USD number is canonical only with explicit FX provenance.
      minSalaryUsd: intent.currency === "USD" ? intent.targetSalaryAmount : undefined,
      preferredLocations: intent.preferredLocations,
      targetTitles: intent.targetTitles,
      preferredWorkModel: intent.preferredWorkModel,
      travelTolerance: intent.travelTolerance
    };

    // Check all deterministic activation prerequisites before recording a new
    // immutable intent version. This prevents an API error from concealing a
    // newly persisted but unusable intent.
    await validateIntentActivationPreconditions({ ...intentRecord, scope });
    await repos.documents.saveCareerIntent(scope, intentRecord);

    // Saving the versioned intent must also replace the active scraper plan.
    // Otherwise the UI reports success while scraping continues to resolve a
    // legacy plan with empty targetRoles/functions.
    try {
      await activateSearchPlanForIntent({
        ...intentRecord,
        scope,
        activatedBy: "career-intent-save",
      });
    } catch (error: any) {
      // The version is durable, but any non-preflight activation failure is
      // explicitly reported as pending rather than masquerading as a failed
      // write or a current evaluation context.
      return {
        success: true,
        activationState: "PENDING_ACTIVATION" as const,
        message: "Career intent saved; canonical activation is pending.",
        activationError: error?.message || "Activation failed",
      };
    }

    // Refresh evaluations via EvaluationCoordinator
    await EvaluationCoordinator.notify({ event: "INTENT_UPDATED", personId: scope.personId });

    return {
      success: true,
      activationState: "ACTIVE" as const,
      message: "Career intent saved as new version."
    };
  });

/**
 * Transport adapter returning user's latest versioned Candidate Intent.
 */
export const getLatestIntentFn = createServerFn({ method: "GET" })
  .validator((data: { tenantId: string; personId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = await authorizeCandidate(user.id, data.tenantId, data.personId, "read:person");
    const repos = getRepositories();
    const intent = await repos.documents.getLatestCareerIntent(scope);
    return intent || null;
  });
