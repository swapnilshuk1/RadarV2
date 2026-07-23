import fs from "fs";
import path from "path";
import { invalidateCandidateDossierCache } from "./cip";
import { invalidateEngineCache } from "./engine";
import { 
  type CandidateState, 
  type CandidateIdentity, 
  type ExtractedFact, 
  type CandidateClaim, 
  type UserSession,
  type CareerIntentSession,
  type EvidenceSource
} from "../../types/candidate";

function getNodeFs() {
  if (typeof window !== "undefined") return null;
  return fs;
}

function getNodePath() {
  if (typeof window !== "undefined") return null;
  return path;
}

export class IdentityEngine {
  private static getPaths() {
    const p = getNodePath();
    if (!p || typeof process === "undefined") return null;
    return {
      STATE_PATH: p.join(process.cwd(), "src", "data", "candidate-state.json"),
      BACKUP_PATH: p.join(process.cwd(), ".radar", "candidate-state.json"),
      LEGACY_PROFILE_PATH: p.join(process.cwd(), "src", "data", "candidate-profile.json")
    };
  }

  /**
   * Loads the current candidate state, seeding it from candidate-profile.json if empty.
   */
  public static loadState(): CandidateState {
    const paths = this.getPaths();
    const fs = getNodeFs();

    // 1. Try reading candidate-state.json first
    if (paths && fs && fs.existsSync(paths.STATE_PATH)) {
      try {
        const state = JSON.parse(fs.readFileSync(paths.STATE_PATH, "utf-8"));
        return state;
      } catch (e) {
        console.warn("[IdentityEngine] Failed to parse candidate-state.json, falling back to backup/legacy:", e);
      }
    }

    if (paths && fs && fs.existsSync(paths.BACKUP_PATH)) {
      try {
        const state = JSON.parse(fs.readFileSync(paths.BACKUP_PATH, "utf-8"));
        return state;
      } catch (e) {}
    }

    // 2. Seed from legacy candidate-profile.json
    return this.seedFromLegacy();
  }

  /**
   * Seeds the CandidateState model using the legacy candidate-profile.json.
   */
  public static seedFromLegacy(): CandidateState {
    let rawProfile: any = {};
    const paths = this.getPaths();
    const fs = getNodeFs();

    if (paths && fs && fs.existsSync(paths.LEGACY_PROFILE_PATH)) {
      try {
        rawProfile = JSON.parse(fs.readFileSync(paths.LEGACY_PROFILE_PATH, "utf-8"));
      } catch (e) {
        console.error("[IdentityEngine] Critical: Failed to load legacy candidate-profile.json:", e);
      }
    }

    const defaultSession: UserSession = {
      userId: "swapnil-shukla-dev",
      email: "swapnil@radar.advisory",
      name: rawProfile.identity?.name || "Swapnil Shukla",
      avatarUrl: "https://lh3.googleusercontent.com/a/default-user=s100",
      onboarded: true
    };

    const defaultIntent: CareerIntentSession = {
      sessionId: "session-1",
      targetRoles: [
        { title: "Chief Marketing Officer", priorityMultiplier: 1.0 },
        { title: "VP Marketing", priorityMultiplier: 0.9 },
        { title: "Performance CoE Lead", priorityMultiplier: 0.8 },
        { title: "Commercial Growth Leader", priorityMultiplier: 1.0 }
      ],
      locations: rawProfile.leadershipProfile?.regions || ["APAC", "India", "Remote"],
      workModel: "Hybrid",
      minCompensation: 350000,
      maxMonthlyPursuits: rawProfile.headspaceCapacityPerMonth || 5,
      isActive: true
    };

    // Convert legacy achievements and evidence into Evidence Ledger & Claims
    const seedSource: EvidenceSource = {
      id: "seed-resume-legacy",
      type: "Resume",
      name: "Seeded_Swapnil_Shukla_CV.txt",
      verbatimText: JSON.stringify(rawProfile.experience?.achievements || []),
      uploadedAt: new Date().toISOString()
    };

    const seedFacts: ExtractedFact[] = [];
    const seedClaims: CandidateClaim[] = [];

    // Synthesize standard claims out of legacy evidence
    const legacyEvidence = rawProfile.evidence || [];
    legacyEvidence.forEach((ev: any, index: number) => {
      const factId = `fact-legacy-${index}`;
      const claimId = `claim-legacy-${index}`;

      seedFacts.push({
        id: factId,
        evidenceId: seedSource.id,
        verbatimQuote: ev.proof,
        subject: ev.type,
        predicate: ev.proof,
        confidence: 1.0
      });

      seedClaims.push({
        id: claimId,
        type: "Capability",
        title: ev.type,
        statement: ev.proof,
        supportingFactIds: [factId],
        confidence: 0.95,
        lastUpdated: new Date().toISOString()
      });
    });

    // Compile dynamic counts
    const quantifiedOutcomes = (rawProfile.experience?.achievements || []).filter((ach: string) => 
      /\d+[%$M]/i.test(ach)
    ).length;

    const identity: CandidateIdentity = {
      identity: {
        archetype: rawProfile.executiveIdentity?.archetype || "Commercial Growth Leader",
        valueProposition: rawProfile.executiveIdentity?.valueProposition || "",
        executiveThemes: rawProfile.executiveIdentity?.executiveThemes || []
      },
      capabilities: {
        categories: rawProfile.capabilities || {}
      },
      leadership: {
        largestTeam: rawProfile.leadershipProfile?.largestTeam || 40,
        budgetScale: rawProfile.leadershipProfile?.budgetResponsibility || "$8M",
        boardExposure: rawProfile.leadershipProfile?.boardExposure ?? true,
        globalMarketsCount: rawProfile.leadershipProfile?.globalMarkets || 13
      },
      evidence: legacyEvidence,
      achievements: rawProfile.experience?.achievements || [],
      identityConfidence: 96,
      evidenceCount: seedFacts.length,
      quantifiedOutcomesCount: quantifiedOutcomes
    };

    const newState: CandidateState = {
      version: "1.0.0",
      session: defaultSession,
      sources: [seedSource],
      facts: seedFacts,
      claims: seedClaims,
      identity,
      intent: defaultIntent,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Dynamic compiler: takes raw flat extracted facts from Gemini and compiles
   * them into structured claims, capabilities, leadership, and scores.
   */
  public static compile(
    session: UserSession,
    sources: EvidenceSource[],
    facts: ExtractedFact[],
    intent: CareerIntentSession
  ): CandidateState {
    const claims: CandidateClaim[] = [];
    
    // Group facts by subject/theme to synthesize logical claims
    const factsBySubject: Record<string, ExtractedFact[]> = {};
    facts.forEach(fact => {
      const key = fact.subject || "General Experience";
      if (!factsBySubject[key]) factsBySubject[key] = [];
      factsBySubject[key].push(fact);
    });

    Object.entries(factsBySubject).forEach(([subject, subFacts], index) => {
      claims.push({
        id: `claim-auto-${index}`,
        type: "Capability",
        title: subject,
        statement: subFacts.map(f => f.predicate).join(" Also, ") + ".",
        supportingFactIds: subFacts.map(f => f.id),
        confidence: parseFloat((subFacts.reduce((sum, f) => sum + f.confidence, 0) / subFacts.length).toFixed(2)),
        lastUpdated: new Date().toISOString()
      });
    });

    // Compile capabilities category dictionary dynamically
    const categories: Record<string, string[]> = {
      growth: [],
      crm: [],
      analytics: [],
      transformation: []
    };

    facts.forEach(f => {
      const pred = f.predicate.toLowerCase();
      if (pred.includes("grow") || pred.includes("revenue") || pred.includes("acquisition") || pred.includes("marketing")) {
        categories.growth.push(f.subject);
      }
      if (pred.includes("crm") || pred.includes("salesforce") || pred.includes("hubspot")) {
        categories.crm.push(f.subject);
      }
      if (pred.includes("analytics") || pred.includes("data") || pred.includes("experiment") || pred.includes("attribution")) {
        categories.analytics.push(f.subject);
      }
      if (pred.includes("transform") || pred.includes("turnaround") || pred.includes("operating model") || pred.includes("coe")) {
        categories.transformation.push(f.subject);
      }
    });

    // Deduplicate capabilities
    Object.keys(categories).forEach(k => {
      categories[k] = Array.from(new Set(categories[k].filter(Boolean)));
    });

    // Extract numerical metrics for leadership
    let largestTeam = 10;
    let budgetScale = "$1M";
    let boardExposure = false;
    let globalMarketsCount = 1;

    facts.forEach(f => {
      const pred = f.predicate.toLowerCase();
      const teamMatch = pred.match(/(\d+)\s*[- ]\s*member|team of (\d+)/);
      if (teamMatch) {
        const size = parseInt(teamMatch[1] || teamMatch[2]);
        if (size > largestTeam) largestTeam = size;
      }
      const budgetMatch = pred.match(/\$(\d+)\s*m/);
      if (budgetMatch) {
        budgetScale = `$${budgetMatch[1]}M`;
      }
      if (pred.includes("board") || pred.includes("ceo") || pred.includes("executive committee")) {
        boardExposure = true;
      }
      const marketMatch = pred.match(/(\d+)\s*(markets|countries|regions)/);
      if (marketMatch) {
        const count = parseInt(marketMatch[1]);
        if (count > globalMarketsCount) globalMarketsCount = count;
      }
    });

    const achievements = facts.map(f => `${f.subject}: ${f.predicate}`);
    const quantifiedOutcomes = achievements.filter(ach => /\d+[%$M]/i.test(ach)).length;

    // Build backwards compatible evidence array for scoring engines
    const legacyEvidence = claims.map(cl => ({
      type: cl.title,
      proof: cl.statement
    }));

    // Emergent archetype based on capabilities strength
    let archetype = "Executive Leader";
    if (categories.growth.length > categories.transformation.length) {
      archetype = "Commercial Growth Leader";
    } else if (categories.transformation.length > 0) {
      archetype = "Digital Transformation Partner";
    }

    const compiledIdentity: CandidateIdentity = {
      identity: {
        archetype,
        valueProposition: claims.map(c => c.statement).slice(0, 2).join(" "),
        executiveThemes: ["Transformation", "Commercial", "Growth", "Leadership"].slice(0, 3)
      },
      capabilities: {
        categories
      },
      leadership: {
        largestTeam,
        budgetScale,
        boardExposure,
        globalMarketsCount
      },
      evidence: legacyEvidence,
      achievements,
      identityConfidence: Math.min(100, Math.round(70 + facts.length * 2.5)),
      evidenceCount: facts.length,
      quantifiedOutcomesCount: quantifiedOutcomes
    };

    const newState: CandidateState = {
      version: "1.0.0",
      session,
      sources,
      facts,
      claims,
      identity: compiledIdentity,
      intent,
      updatedAt: new Date().toISOString()
    };

    this.saveState(newState);
    return newState;
  }

  /**
   * Persists the candidate state atomic document to disk.
   */
  public static saveState(state: CandidateState): void {
    try {
      const paths = this.getPaths();
      const fs = getNodeFs();
      const path = getNodePath();

      if (!paths || !fs || !path) return;

      const stateDir = path.dirname(paths.STATE_PATH);
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
      
      const backupDir = path.dirname(paths.BACKUP_PATH);
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const stateContent = JSON.stringify(state, null, 2);
      fs.writeFileSync(paths.STATE_PATH, stateContent, "utf-8");
      fs.writeFileSync(paths.BACKUP_PATH, stateContent, "utf-8");
      
      // Also overwrite the legacy candidate-profile.json dynamically!
      // This completely avoids having to rewrite existing legacy consumers that read raw candidate-profile.json!
      const legacyComp = {
        identity: {
          name: state.session?.name || state.identity.identity.archetype,
          currentTitle: state.intent.targetRoles[0]?.title || "Executive Leader"
        },
        executiveIdentity: {
          archetype: state.identity.identity.archetype,
          valueProposition: state.identity.identity.valueProposition,
          executiveThemes: state.identity.identity.executiveThemes
        },
        experience: {
          yearsExperience: 20, // default placeholder
          teamSizeManaged: state.identity.leadership.largestTeam,
          feeBookScale: state.identity.leadership.budgetScale,
          plOwnership: true,
          boardInteraction: state.identity.leadership.boardExposure,
          achievements: state.identity.achievements
        },
        leadershipProfile: {
          largestTeam: state.identity.leadership.largestTeam,
          globalMarkets: state.identity.leadership.globalMarketsCount,
          regions: state.intent.locations,
          budgetResponsibility: state.identity.leadership.budgetScale,
          commercialOwnership: true,
          boardExposure: state.identity.leadership.boardExposure,
          globalPrograms: true,
          peopleLeadership: true,
          matrixLeadership: true,
          vendorManagement: true,
          clientLeadership: true
        },
        evidence: state.identity.evidence,
        capabilities: state.identity.capabilities.categories,
        headspaceCapacityPerMonth: state.intent.maxMonthlyPursuits
      };
      
      fs.writeFileSync(paths.LEGACY_PROFILE_PATH, JSON.stringify(legacyComp, null, 2), "utf-8");
      
      try {
        invalidateCandidateDossierCache();
        invalidateEngineCache();
      } catch {}
    } catch (e) {
      console.error("[IdentityEngine] Failed to write candidate state to disk:", e);
    }
  }
}
