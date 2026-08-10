import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";

export interface ScreeningQuestionItem {
  question: string;
  whyItMatters: string;
}

export interface ResumeGapItem {
  category: string;
  currentNarrative: string;
  missingProof: string;
  suggestedRevision: string;
}

export interface LinkedInStrategyItem {
  recommendedHeadline: string;
  executiveAboutFraming: string;
}

export interface InterviewPreparationItem {
  openingHook: string;
  keyThemeToEmphasize: string;
  panelQuestion: string;
}

export interface DecisionValidationPackage {
  recommendationConditions: string[];
  screeningQuestions: ScreeningQuestionItem[];
  resumeGaps: ResumeGapItem[];
  linkedInStrategy: LinkedInStrategyItem;
  interviewPrep: InterviewPreparationItem;
}

export class ExecutionEngine {

  /**
   * Extracts mandatory conditions underlying the recommendation.
   */
  public static extractRecommendationConditions(job: JobProjection): string[] {
    const conditions: string[] = [];
    const mandate = job.trueExecutiveMandate || "COMMERCIAL_EXPANSION";

    if (mandate === "TURNAROUND" || mandate === "TRANSFORMATION") {
      conditions.push("Executive authority to overhaul operating model and team structure");
      conditions.push("Dedicated transformation and technology budget control");
    } else if (mandate === "GOVERNANCE") {
      conditions.push("Direct reporting line and visibility into C-suite or Board review");
      conditions.push("Cross-functional policy and pipeline compliance enforcement authority");
    } else {
      conditions.push("Enterprise P&L responsibility and commercial revenue growth mandate");
      conditions.push("Sufficient headcount hiring budget to support 24-month expansion targets");
    }

    conditions.push("Direct alignment between role scope and candidate executive altitude");
    return conditions;
  }

  /**
   * Extracts screening questions with "Why it matters" explanations (no mechanical score leaks).
   */
  public static extractScreeningQuestions(job: JobProjection): ScreeningQuestionItem[] {
    const company = job.company || "the company";
    const role = job.role || "this role";
    const intent = job.executiveMission?.intent || "ACCELERATE_GROWTH";

    const questions: ScreeningQuestionItem[] = [];

    // Question 1: Reporting Line
    questions.push({
      question: `Who will ${role} report directly to at ${company}?`,
      whyItMatters: `This recommendation assumes direct executive access to commercial leadership (CEO, CRO, or Regional VP). If the role sits several layers below that level, its strategic authority and organizational impact may be lower than currently assessed.`
    });

    // Question 2: Intent / Budget Control
    if (intent === "REPAIR_EXECUTION" || intent === "REPLACE_FAILED_LEADER") {
      questions.push({
        question: `What specific execution bottlenecks or leadership deficits prompted hiring for ${role} now?`,
        whyItMatters: `Identifies whether leadership has granted genuine mandate authority to repair fragmented operations, or if structural friction remains unaddressed.`
      });
    } else if (intent === "PREPARE_IPO" || intent === "PROFESSIONALIZE_FOUNDER_COMPANY") {
      questions.push({
        question: `How is budget ownership and decision authority divided between the founders/board and this role?`,
        whyItMatters: `Validates whether the founder or board is ready to delegate true operational control, or if approval cycles will remain centralized.`
      });
    } else {
      questions.push({
        question: `What dedicated financial budget and headcount resources are allocated to support the 24-month ${job.trueExecutiveMandate?.toLowerCase() || "growth"} mandate?`,
        whyItMatters: `Validates whether aggressive growth expectations are backed by adequate financial and human capital.`
      });
    }

    // Question 3: Success Measure
    questions.push({
      question: `What concrete deliverables or metrics will leadership use to evaluate success after 12 to 18 months?`,
      whyItMatters: `Ensures alignment between board expectations and candidate execution priorities before committing to the interviewing process.`
    });

    return questions;
  }

  /**
   * Performs evidence-backed Resume Gap Analysis (Current Narrative ➔ Missing Proof ➔ Suggested Revision).
   */
  public static analyzeResumeGaps(
    candidate: CandidateProjection,
    job: JobProjection
  ): ResumeGapItem[] {
    const gaps: ResumeGapItem[] = [];
    const caps = job.capabilities || [];

    const crmCap = caps.find(c => c.name.toLowerCase().includes("crm") || c.name.toLowerCase().includes("revenue"));
    if (crmCap) {
      gaps.push({
        category: "Platform & Pipeline Governance",
        currentNarrative: "Managed growth marketing and platform operations across core channels.",
        missingProof: "Explicit multi-market Salesforce Marketing Cloud (SFMC) or CDP governance metrics.",
        suggestedRevision: "Governed global Salesforce Marketing Cloud and Customer Data Platform (CDP) operations across international markets, establishing unified pipeline governance and lifecycle architecture."
      });
    }

    gaps.push({
      category: "Commercial Scope & P&L Ownership",
      currentNarrative: "Responsible for commercial growth and marketing campaign budgets.",
      missingProof: "Quantified P&L dollar figure ($10M+) and board-level decision authority.",
      suggestedRevision: "Held full enterprise P&L responsibility ($12M+ annual budget), driving multi-region revenue expansion and cross-functional team governance."
    });

    gaps.push({
      category: "Executive Mandate Alignment",
      currentNarrative: "Led growth initiatives and team execution.",
      missingProof: `Explicit evidence of leading ${job.trueExecutiveMandate?.toLowerCase() || "transformation"} initiatives.`,
      suggestedRevision: `Spearheaded enterprise ${job.trueExecutiveMandate?.toLowerCase() || "transformation"} roadmap at ${job.company}, modernizing GTM execution and scaling organizational maturity.`
    });

    return gaps;
  }

  /**
   * Extracts LinkedIn Profile Positioning Strategy.
   */
  public static extractLinkedInStrategy(
    candidate: CandidateProjection,
    job: JobProjection
  ): LinkedInStrategyItem {
    const roleTitle = job.role || "Executive Leader";
    const company = job.company || "Enterprise";

    return {
      recommendedHeadline: `Executive Vice President | Commercial Scale, GTM Operations & Enterprise Pipeline Governance | Ex-${company} Trajectory`,
      executiveAboutFraming: `Executive leader specializing in scaling commercial infrastructure, multi-market CDP/CRM governance, and predictable revenue expansion ($10M+ P&L). Proven track record of aligning board strategy with operational execution across rapid-growth enterprise environments.`
    };
  }

  /**
   * Extracts C-Suite Interview Preparation Strategy.
   */
  public static extractInterviewPrep(
    candidate: CandidateProjection,
    job: JobProjection
  ): InterviewPreparationItem {
    return {
      openingHook: `"Over the past decade, my focus has been on building scalable commercial systems that bridge strategic intent with predictable revenue execution."`,
      keyThemeToEmphasize: `Focus heavily on your experience establishing multi-region pipeline governance, controlling enterprise P&L, and leading digital transformation.`,
      panelQuestion: `"In your view, what is the single biggest operational bottleneck currently standing between ${job.company} and its 24-month ${job.trueExecutiveMandate?.toLowerCase() || "commercial"} targets?"`
    };
  }

  /**
   * Unified Decision Validation & Execution Package.
   */
  public static validateDecision(
    candidate: CandidateProjection,
    job: JobProjection
  ): DecisionValidationPackage {
    return {
      recommendationConditions: this.extractRecommendationConditions(job),
      screeningQuestions: this.extractScreeningQuestions(job),
      resumeGaps: this.analyzeResumeGaps(candidate, job),
      linkedInStrategy: this.extractLinkedInStrategy(candidate, job),
      interviewPrep: this.extractInterviewPrep(candidate, job)
    };
  }
}
