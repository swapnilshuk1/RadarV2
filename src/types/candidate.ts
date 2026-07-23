import { type CandidateEvidence } from "@/data/candidate-profile";

export interface UserSession {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  onboarded: boolean;
}

// ─── 1. EVIDENCE LEDGER ───────────────────────────────────────────────────────
export interface EvidenceSource {
  id: string;                      // MD5/SHA hash of content
  type: "Resume" | "LinkedIn" | "Interview" | "Manual";
  name: string;                    // Name of file or event source
  verbatimText: string;
  uploadedAt: string;
}

export interface ExtractedFact {
  id: string;
  evidenceId: string;              // Belongs to EvidenceSource
  verbatimQuote: string;           // Verbatim matching quote from the file
  subject: string;                 // Accomplishment or credential name
  predicate: string;               // Metric/achievement details
  confidence: number;              // Gemini extraction confidence
}

// ─── 2. CLAIMS LAYER ─────────────────────────────────────────────────────────
export type ClaimType = "Capability" | "Leadership" | "Domain" | "Achievement";

export interface CandidateClaim {
  id: string;
  type: ClaimType;
  title: string;                   // "CRM Transformation", "P&L Management"
  statement: string;               // Explainable narrative claim
  supportingFactIds: string[];     // Fact linkage
  confidence: number;              // Derived claim confidence [0.0 - 1.0]
  lastUpdated: string;
}

// ─── 3. IDENTITY LAYER (EMERGENT PROFILE) ───────────────────────────────────
export interface ExecutiveIdentity {
  archetype: string;               // "Commercial Growth Leader"
  valueProposition: string;        // "Transforms enterprise organizations..."
  executiveThemes: string[];       // ["Growth", "Transformation", "Commercial"]
}

export interface CapabilityProfile {
  // Mapping categories like "growth" to specific credentials or skills
  categories: Record<string, string[]>;
}

export interface LeadershipProfile {
  largestTeam: number;
  budgetScale: string;
  boardExposure: boolean;
  globalMarketsCount: number;
}

export interface CandidateIdentity {
  identity: ExecutiveIdentity;
  capabilities: CapabilityProfile;
  leadership: LeadershipProfile;
  evidence: CandidateEvidence[];   // Preserves back-compatibility with present.ts/QA.mapping
  achievements: string[];          // Flat list of key achievements
  
  // Platform Confidence Metrics
  identityConfidence: number;      // Calculated score [0 - 100]
  evidenceCount: number;           // Total evidence items supporting claims
  quantifiedOutcomesCount: number; // Supported by M outcome claims
}

// ─── 4. INTENT SESSION (DYNAMIC WORKSPACE) ──────────────────────────────────
export interface TargetRole {
  title: string;
  priorityMultiplier: number;
}

export interface CareerIntentSession {
  sessionId: string;
  targetRoles: TargetRole[];
  locations: string[];
  workModel: "Hybrid" | "Remote" | "Onsite" | "Any";
  minCompensation?: number;
  maxMonthlyPursuits: number;      // defaults to headspace capacity (e.g., 5)
  isActive: boolean;
}

// ─── 5. FULL PIPELINE DTO ────────────────────────────────────────────────────
export interface CandidateState {
  version: string;
  session: UserSession | null;
  sources: EvidenceSource[];
  facts: ExtractedFact[];
  claims: CandidateClaim[];
  identity: CandidateIdentity;
  intent: CareerIntentSession;
  updatedAt: string;
}
