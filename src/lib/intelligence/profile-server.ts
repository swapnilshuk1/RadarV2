import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createServerFn } from "@tanstack/react-start";
import mammoth from "mammoth";
import { IdentityEngine } from "./identity-engine";
import { invalidateCandidateDossierCache } from "./cip";
import { invalidateEngineCache } from "./engine";
import { 
  type CandidateState, 
  type ExtractedFact, 
  type EvidenceSource, 
  type UserSession,
  type CareerIntentSession
} from "../../types/candidate";

function getNodeFs() {
  if (typeof window !== "undefined") return null;
  return fs;
}

function getNodePath() {
  if (typeof window !== "undefined") return null;
  return path;
}

function getNodeChildProcess() {
  if (typeof window !== "undefined") return null;
  return { execSync };
}

// ─── UTILITY: ADC TOKEN & GEMINI HELPER ──────────────────────────────────────
let adcTokenCache: { token: string; expiresAt: number } | null = null;

function getADCToken(): string | null {
  try {
    if (adcTokenCache && Date.now() < adcTokenCache.expiresAt) {
      return adcTokenCache.token;
    }
    const fs = getNodeFs();
    const path = getNodePath();
    const cp = getNodeChildProcess();
    if (!fs || !path || !cp) return null;

    let cmd = "gcloud";
    if (process.platform === "win32") {
      const commonPaths = [
        "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
        path.join(process.env.USERPROFILE || "", "AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"),
        "C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          cmd = `"${p}"`;
          break;
        }
      }
    }
    const token = cp.execSync(`${cmd} auth application-default print-access-token`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (token) {
      adcTokenCache = {
        token,
        expiresAt: Date.now() + 50 * 60 * 1000,
      };
      return token;
    }
  } catch (err: any) {
    console.warn(`[profile-server] Failed to get ADC token from gcloud CLI: ${err.message}`);
  }
  return null;
}

async function fetchGeminiContent(prompt: string, inlineFile?: { mimeType: string; data: string }): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";

  if (apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  } else {
    const adcToken = getADCToken();
    if (!adcToken) {
      throw new Error("No Gemini credentials (API Key or Google Cloud print-access-token) available.");
    }
    headers["Authorization"] = `Bearer ${adcToken}`;
    const projectId = process.env.GCP_PROJECT_ID || "project-0e166cfc-e3f5-49d7-af6";
    url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
  }

  const parts: any[] = [];
  if (inlineFile) {
    parts.push({
      inlineData: {
        mimeType: inlineFile.mimeType,
        data: inlineFile.data
      }
    });
  }
  parts.push({ text: prompt });

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini Error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Received empty content from Gemini API.");
  return content;
}

// ─── API: DYNAMIC STATE LOAD ───────────────────────────────────────────────
export const getCandidateStateFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<CandidateState> => {
    return IdentityEngine.loadState();
  });

// ─── API: RESUME / LINKEDIN FACT EXTRACTION ──────────────────────────────────
interface IngestInput {
  sourceName: string;
  sourceText?: string;
  sourceFileBase64?: string;
  sourceMimeType?: string;
  sourceType: "Resume" | "LinkedIn";
}

export const ingestEvidenceFn = createServerFn({ method: "POST" })
  .validator((d: IngestInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; state?: CandidateState; error?: string }> => {
    const { sourceName, sourceText, sourceFileBase64, sourceMimeType, sourceType } = data;
    try {
      console.log(`[profile-server] Ingesting ${sourceType} (${sourceName})…`);
      
      let finalTextForSource = sourceText || "";
      let inlineFile: { mimeType: string; data: string } | undefined = undefined;

      if (sourceFileBase64 && sourceMimeType) {
        if (sourceMimeType === "application/pdf") {
          // Pass PDF base64 directly to Gemini
          inlineFile = {
            mimeType: "application/pdf",
            data: sourceFileBase64
          };
          finalTextForSource = `[PDF Document Ingested: ${sourceName}]`;
        } else if (
          sourceMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
          sourceName.endsWith(".docx")
        ) {
          // Extract Word document text
          const buffer = Buffer.from(sourceFileBase64, "base64");
          const result = await mammoth.extractRawText({ buffer });
          finalTextForSource = result.value;
        } else {
          // Decodes other files as raw text
          finalTextForSource = Buffer.from(sourceFileBase64, "base64").toString("utf-8");
        }
      }

      const prompt = `You are an elite executive talent research analyst.
Analyze the following raw candidate credentials.
Your task is to extract exactly 10 to 25 high-impact, verifiable "Facts" about the candidate's achievements, skills, and corporate credentials.

For each Fact, provide:
1. "subject": The name of the capability, project, or role (e.g., "CRM Transformation", "P&L Management", "GCC Scaling", "Ford Commercial Portfolio"). Keep this short and noun-focused.
2. "verbatimQuote": The exact, verbatim quote validating this fact from the source credentials. Do NOT paraphrase or alter a single letter.
3. "predicate": A high-impact descriptive sentence summarizing the metric, scale, or action performed (e.g., "Managed an $8M Ford agency commercial portfolio", "Won and led BMW India digital transformation retainer").
4. "confidence": Extraction accuracy score between 0.8 and 1.0.

Candidate Credentials:
${inlineFile ? "[Analyzing PDF document file attachment loaded below]" : `"""\n${finalTextForSource.slice(0, 15000)}\n"""`}

Return ONLY a valid JSON object matching the following structure:
{
  "candidateName": "The full name of the candidate parsed from the credentials (e.g., 'Michele Ling' or 'Swapnil Shukla')",
  "facts": [
    {
      "subject": "Capability/Project",
      "verbatimQuote": "verbatim text matching source...",
      "predicate": "short descriptive sentence including metrics...",
      "confidence": 0.95
    }
  ]
}`;

      const responseText = await fetchGeminiContent(prompt, inlineFile);
      const parsed = JSON.parse(responseText);
      
      if (!parsed.facts || !Array.isArray(parsed.facts)) {
        throw new Error("Invalid output format: facts array missing.");
      }

      const parsedName = parsed.candidateName && parsed.candidateName !== "Anonymous Candidate" 
        ? parsed.candidateName 
        : "";

      // Load active state
      const currentState = IdentityEngine.loadState();
      
      const sourceId = `source-${Date.now()}`;
      const newSource: EvidenceSource = {
        id: sourceId,
        type: sourceType,
        name: sourceName,
        verbatimText: finalTextForSource || `[Document: ${sourceName}]`,
        uploadedAt: new Date().toISOString()
      };

      const extractedFacts: ExtractedFact[] = parsed.facts.map((f: any, idx: number) => ({
        id: `fact-${Date.now()}-${idx}`,
        evidenceId: sourceId,
        verbatimQuote: f.verbatimQuote || "",
        subject: f.subject || "Skill",
        predicate: f.predicate || "",
        confidence: f.confidence || 0.9
      }));

      // Combine sources, facts
      const updatedSources = [newSource, ...currentState.sources.filter(s => s.id !== "seed-resume-legacy")];
      const updatedFacts = [...extractedFacts, ...currentState.facts.filter(f => f.evidenceId !== "seed-resume-legacy")];

      const activeSession: UserSession = {
        userId: currentState.session?.userId || "swapnil-shukla-dev",
        email: currentState.session?.email || "candidate@radar.advisory",
        name: parsedName || currentState.session?.name || "Anonymous Candidate",
        avatarUrl: currentState.session?.avatarUrl || "https://lh3.googleusercontent.com/a/default-user=s100",
        onboarded: true
      };

      // Compile state using IdentityEngine
      const compiledState = IdentityEngine.compile(
        activeSession,
        updatedSources,
        updatedFacts,
        currentState.intent
      );

      return { success: true, state: compiledState };
    } catch (e: any) {
      console.error("[profile-server] Ingestion failed:", e.message);
      return { success: false, error: e.message };
    }
  });

// ─── API: MANUAL PROFILE UPDATES ──────────────────────────────────────────────
interface UpdateProfileInput {
  name: string;
  archetype: string;
  valueProposition: string;
  themes: string[];
  largestTeam: number;
  budgetScale: string;
  boardExposure: boolean;
  achievements: string[];
}

export const updateIdentityStateFn = createServerFn({ method: "POST" })
  .validator((d: UpdateProfileInput) => d)
  .handler(async ({ data }): Promise<CandidateState> => {
    const currentState = IdentityEngine.loadState();
    
    // Update identity directly
    currentState.identity.identity.archetype = data.archetype;
    currentState.identity.identity.valueProposition = data.valueProposition;
    currentState.identity.identity.executiveThemes = data.themes;
    
    currentState.identity.leadership.largestTeam = data.largestTeam;
    currentState.identity.leadership.budgetScale = data.budgetScale;
    currentState.identity.leadership.boardExposure = data.boardExposure;
    
    currentState.identity.achievements = data.achievements;
    if (currentState.session) {
      currentState.session.name = data.name;
    }
    
    currentState.updatedAt = new Date().toISOString();
    IdentityEngine.saveState(currentState);
    
    return currentState;
  });

// ─── API: UPDATE CAREER INTENT & GENERATE SEARCH PLAN ───────────────────────────
interface UpdateIntentInput {
  targetRoles: string[];
  locations: string[];
  workModel: "Hybrid" | "Remote" | "Onsite" | "Any";
  maxMonthlyPursuits: number;
}

export const updateIntentSessionFn = createServerFn({ method: "POST" })
  .validator((d: UpdateIntentInput) => d)
  .handler(async ({ data }): Promise<CandidateState> => {
    const currentState = IdentityEngine.loadState();
    
    const updatedIntent: CareerIntentSession = {
      sessionId: `intent-${Date.now()}`,
      targetRoles: data.targetRoles.map((title, idx) => ({
        title,
        priorityMultiplier: parseFloat((1.0 - idx * 0.1).toFixed(2))
      })),
      locations: data.locations,
      workModel: data.workModel,
      maxMonthlyPursuits: data.maxMonthlyPursuits,
      isActive: true
    };

    currentState.intent = updatedIntent;
    currentState.updatedAt = new Date().toISOString();
    
    // Save updated state & legacy compensation
    IdentityEngine.saveState(currentState);

    // DYNAMIC RE-PLANNING: Invoke CareerIntent extraction and SearchPlanner!
    try {
      console.log("[profile-server] Triggering automatic Search Re-Planning...");
      const path = getNodePath();
      const fs = getNodeFs();
      if (path && fs) {
        const profilePath = path.join(process.cwd(), "src", "data", "candidate-profile.json");
        const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
        const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
        const searchPlanOutputPath = path.join(process.cwd(), "src", "data", "search-plan.json");
        
        const { CareerIntentModel } = await import("../../../scripts/scraper/run/career-intent");
        const intent = CareerIntentModel.extractIntent(profilePath, taxonomyPath);
        
        const { SearchPlanner } = await import("../../../scripts/scraper/run/search-planner");
        const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
        
        fs.writeFileSync(searchPlanOutputPath, JSON.stringify(searchPlan, null, 2), "utf-8");
        console.log(`[profile-server] Successfully regenerated search-plan.json with ${searchPlan.rankedQueries.length} compiled queries!`);
      }
    } catch (e: any) {
      console.error("[profile-server] Automated search planning failed:", e.message);
    }

    return currentState;
  });

// ─── API: INITIALIZE SESSION (SWAPNIL OR NEW USER) ───────────────────────────
interface InitializeSessionInput {
  mode: "swapnil" | "new_user";
}

export const initializeSessionFn = createServerFn({ method: "POST" })
  .validator((d: InitializeSessionInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean }> => {
    try {
      const path = getNodePath();
      const fs = getNodeFs();
      const cp = getNodeChildProcess();
      if (!path || !fs) {
        return { success: false };
      }

      const statePath = path.join(process.cwd(), "src", "data", "candidate-state.json");
      const backupPath = path.join(process.cwd(), ".radar", "candidate-state.json");
      const profilePath = path.join(process.cwd(), "src", "data", "candidate-profile.json");

      if (data.mode === "swapnil") {
        console.log("[profile-server] Resetting to Swapnil Shukla (Golden) profile...");
        // Revert candidate-profile.json to git HEAD
        try {
          if (cp) {
            cp.execSync("git checkout src/data/candidate-profile.json", { stdio: "ignore" });
          }
        } catch (e: any) {
          console.warn("[profile-server] Failed git checkout of legacy profile, proceeding:", e.message);
        }
        
        // Remove existing state files
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        
        console.log("[profile-server] Successfully restored Swapnil Shukla (Golden) seed.");
      } else {
        console.log("[profile-server] Initializing Fresh Blank Session for new candidate...");
        
        // Create an empty skeleton state
        const skeletonSession: UserSession = {
          userId: `user-${Date.now()}`,
          email: "candidate@radar.advisory",
          name: "Guest Executive",
          avatarUrl: "https://lh3.googleusercontent.com/a/default-user=s100",
          onboarded: false
        };

        const skeletonIntent: CareerIntentSession = {
          sessionId: `intent-${Date.now()}`,
          targetRoles: [],
          locations: [],
          workModel: "Hybrid",
          maxMonthlyPursuits: 5,
          isActive: true
        };

        const skeletonState: CandidateState = {
          version: "1.0.0",
          session: skeletonSession,
          sources: [],
          facts: [],
          claims: [],
          identity: {
            identity: {
              archetype: "Executive Leader",
              valueProposition: "",
              executiveThemes: []
            },
            capabilities: {
              categories: {
                growth: [],
                crm: [],
                analytics: [],
                transformation: []
              }
            },
            leadership: {
              largestTeam: 0,
              budgetScale: "$0M",
              boardExposure: false,
              globalMarketsCount: 0
            },
            evidence: [],
            achievements: [],
            identityConfidence: 50,
            evidenceCount: 0,
            quantifiedOutcomesCount: 0
          },
          intent: skeletonIntent,
          updatedAt: new Date().toISOString()
        };

        // Write both state paths and the legacy profile JSON so all layers are synchronized
        fs.writeFileSync(statePath, JSON.stringify(skeletonState, null, 2), "utf-8");
        fs.writeFileSync(backupPath, JSON.stringify(skeletonState, null, 2), "utf-8");

        const legacyProfileComp = {
          identity: {
            name: "Guest Executive",
            currentTitle: "Executive Leader"
          },
          executiveIdentity: {
            archetype: "Executive Leader",
            valueProposition: "",
            executiveThemes: []
          },
          experience: {
            yearsExperience: 10,
            teamSizeManaged: 0,
            feeBookScale: "$0M",
            plOwnership: false,
            boardInteraction: false,
            achievements: []
          },
          leadershipProfile: {
            largestTeam: 0,
            globalMarkets: 0,
            regions: [],
            budgetResponsibility: "$0M",
            commercialOwnership: false,
            boardExposure: false,
            globalPrograms: false,
            peopleLeadership: false,
            matrixLeadership: false,
            headspaceCapacityPerMonth: 5
          }
        };
        fs.writeFileSync(profilePath, JSON.stringify(legacyProfileComp, null, 2), "utf-8");
        console.log("[profile-server] Successfully initialized Guest Candidate empty skeleton.");
      }

      try {
        invalidateCandidateDossierCache();
        invalidateEngineCache();
      } catch {}

      return { success: true };
    } catch (err: any) {
      console.error("[profile-server] Failed to initialize session:", err.message);
      return { success: false };
    }
  });
