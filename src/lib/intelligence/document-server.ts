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
import { activateSearchPlanForIntent } from "./search-plan-activation";
import crypto from "node:crypto";

/**
 * Fire-and-forget document upload transport adapter.
 * Accepts document upload, saves record in Turso, returns 202-style ACCEPTED status,
 * and initiates ProjectionPipeline asynchronously for the authenticated user.
 */
export const uploadDocumentFn = createServerFn({ method: "POST" })
  .validator((data: {
    filename: string;
    mimeType: string;
    documentText?: string;
    base64Buffer?: string;
  }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const userId = user.id;
    const repos = getRepositories();
    const payloadBytes = data.base64Buffer ? Buffer.from(data.base64Buffer, "base64") : Buffer.from(data.documentText || "", "utf8");
    const contentHash = crypto.createHash("sha256").update(payloadBytes).digest("hex");
    const documentId = `doc-${contentHash}`;
    // Accepted means durably queued, never merely attached to this request's
    // process lifetime. A worker/bootstrap owns subsequent processing.
    await repos.documents.saveDocument({
      id: documentId, personId: userId, filename: data.filename,
      storageUri: `turso://document_contents/${documentId}`, mimeType: data.mimeType,
      documentHash: contentHash, status: "UPLOADED", stage: "DOCUMENT_REGISTERED",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await repos.documents.enqueueDocumentProcessing({
      id: `document-job-${contentHash}`,
      personId: userId,
      documentId,
      jobHash: `document:${userId}:${contentHash}`,
      payloadJson: JSON.stringify({ filename: data.filename, mimeType: data.mimeType, documentText: data.documentText, base64Buffer: data.base64Buffer, documentHash: contentHash }),
    });

    return {
      success: true,
      documentId,
      personId: userId,
      status: "ACCEPTED",
      message: "Document received and durably queued for processing."
    };
  });

/**
 * Transport adapter returning live pipeline status for UI progress display.
 */
export const getPipelineStatusFn = createServerFn({ method: "GET" })
  .validator((data: { documentId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const repos = getRepositories();
    const doc = await repos.documents.getDocument(data.documentId);
    if (!doc) {
      return { success: false, error: "Document not found" };
    }
    if (doc.personId !== user.id && user.role !== "admin") {
      const error: any = new Error("FORBIDDEN: Document access denied");
      error.statusCode = 403;
      throw error;
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
    const repos = getRepositories();

    const intentRecord: CareerIntentRecord = {
      personId: user.id,
      currency: intent.currency,
      targetSalaryAmount: intent.targetSalaryAmount,
      // A normalized USD number is canonical only with explicit FX provenance.
      minSalaryUsd: intent.currency === "USD" ? intent.targetSalaryAmount : undefined,
      preferredLocations: intent.preferredLocations,
      targetTitles: intent.targetTitles,
      preferredWorkModel: intent.preferredWorkModel,
      travelTolerance: intent.travelTolerance
    };

    await repos.documents.saveCareerIntent(intentRecord);

    // Saving the versioned intent must also replace the active scraper plan.
    // Otherwise the UI reports success while scraping continues to resolve a
    // legacy plan with empty targetRoles/functions.
    await activateSearchPlanForIntent({
      ...intentRecord,
      activatedBy: "career-intent-save",
    });

    // Refresh evaluations via EvaluationCoordinator
    await EvaluationCoordinator.notify({ event: "INTENT_UPDATED", personId: user.id });

    return {
      success: true,
      message: "Career intent saved as new version."
    };
  });

/**
 * Transport adapter returning user's latest versioned Candidate Intent.
 */
export const getLatestIntentFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    const repos = getRepositories();
    const intent = await repos.documents.getLatestCareerIntent(user.id);
    return intent || null;
  });
