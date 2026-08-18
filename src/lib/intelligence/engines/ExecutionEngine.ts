/**
 * src/lib/intelligence/engines/ExecutionEngine.ts
 *
 * RADAR V4 — Truth-Preserving Decision Validation & Execution Engine
 *
 * Replaces unsafe mock templates with the constitutional TruthPreservingRewriteEngine
 * and ExecutionEvidenceGate pipeline.
 */

import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { CandidateEvidenceGraph } from "../execution/CandidateEvidenceGraph";
import { TruthPreservingRewriteEngine } from "../execution/TruthPreservingRewriteEngine";
import {
  ExecutionPackage,
  ScreeningQuestionItem,
  ResumeSuggestion,
  SafeLinkedInStrategy,
  SafeInterviewStrategy
} from "../execution/types";
import candidateProfileData from "../../../data/candidate-profile.json";

export type {
  ScreeningQuestionItem,
  ResumeSuggestion,
  SafeLinkedInStrategy as LinkedInStrategyItem,
  SafeInterviewStrategy as InterviewPreparationItem,
  ExecutionPackage as DecisionValidationPackage
};

export class ExecutionEngine {
  private static defaultEvidenceGraph = new CandidateEvidenceGraph(candidateProfileData);

  /**
   * Extracts mandatory conditions underlying the recommendation.
   */
  public static extractRecommendationConditions(job: JobProjection): string[] {
    const pkg = TruthPreservingRewriteEngine.generateExecutionPackage(this.defaultEvidenceGraph, job);
    return pkg.package.recommendationConditions;
  }

  /**
   * Extracts screening questions with "Why it matters" explanations.
   */
  public static extractScreeningQuestions(job: JobProjection): ScreeningQuestionItem[] {
    const pkg = TruthPreservingRewriteEngine.generateExecutionPackage(this.defaultEvidenceGraph, job);
    return pkg.package.screeningQuestions;
  }

  /**
   * Performs evidence-grounded Resume Positioning & Evidence-Gap Coaching.
   */
  public static analyzeResumeGaps(
    candidate: CandidateProjection,
    job: JobProjection
  ): ResumeSuggestion[] {
    const pkg = TruthPreservingRewriteEngine.generateExecutionPackage(this.defaultEvidenceGraph, job);
    return pkg.package.resumeGaps;
  }

  /**
   * Extracts LinkedIn Profile Positioning Strategy.
   */
  public static extractLinkedInStrategy(
    candidate: CandidateProjection,
    job: JobProjection
  ): SafeLinkedInStrategy {
    const pkg = TruthPreservingRewriteEngine.generateExecutionPackage(this.defaultEvidenceGraph, job);
    return pkg.package.linkedInStrategy;
  }

  /**
   * Extracts C-Suite Interview Preparation Strategy.
   */
  public static extractInterviewPrep(
    candidate: CandidateProjection,
    job: JobProjection
  ): SafeInterviewStrategy {
    const pkg = TruthPreservingRewriteEngine.generateExecutionPackage(this.defaultEvidenceGraph, job);
    return pkg.package.interviewPrep;
  }

  /**
   * Unified Decision Validation & Execution Package.
   * Gated and guaranteed truth-preserving.
   */
  public static validateDecision(
    candidate: CandidateProjection,
    job: JobProjection
  ): ExecutionPackage {
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(this.defaultEvidenceGraph, job);
    return result.package;
  }
}
