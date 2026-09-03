/**
 * document-server.ts
 *
 * TanStack Start transport adapters for candidate documents, pipeline execution, and versioned intent.
 * Strict Authentication & Authorization Enforcement (ADR-008).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { ProjectionPipeline } from "./pipeline/ProjectionPipeline";
import { EvaluationCoordinator } from "./EvaluationCoordinator";
import { requireAuthUser } from "../auth/guard";
import type { CareerIntentRecord } from "../../data/sqlite/repositories/SqliteDocumentStore";
import { activateSearchPlanForIntent } from "./search-plan-activation";

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
    const documentId = `doc-${Date.now()}`;
    const fileBuffer = data.base64Buffer ? Buffer.from(data.base64Buffer, "base64") : undefined;

    const pipeline = new ProjectionPipeline();

    // Fire-and-forget asynchronous execution
    void pipeline.run({
      documentId,
      personId: userId,
      filename: data.filename,
      storageUri: `turso://document_contents/${documentId}`,
      mimeType: data.mimeType,
      documentHash: `hash-${Date.now()}`,
      documentText: data.documentText,
      fileBuffer
    }).catch((err) => {
      console.error(`[document-server] Async pipeline run failed for ${documentId}:`, err);
    });

    return {
      success: true,
      documentId,
      personId: userId,
      status: "ACCEPTED",
      message: "Document received. Pipeline execution initiated asynchronously."
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
      currency: intent.currency || "INR",
      targetSalaryAmount: intent.targetSalaryAmount || intent.minSalaryUsd || 8000000,
      minSalaryUsd: intent.minSalaryUsd || intent.targetSalaryAmount,
      preferredLocations: intent.preferredLocations,
      targetTitles: intent.targetTitles,
      preferredWorkModel: intent.preferredWorkModel || "ANY",
      travelTolerance: intent.travelTolerance || "MEDIUM"
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
    return intent || {
      personId: user.id,
      currency: "INR",
      targetSalaryAmount: 8000000,
      preferredLocations: ["Gurugram", "Remote India"],
      targetTitles: ["Vice President", "CMO", "CGO"],
      preferredWorkModel: "ANY",
      travelTolerance: "MEDIUM"
    };
  });
