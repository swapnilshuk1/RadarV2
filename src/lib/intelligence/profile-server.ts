import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import mammoth from "mammoth";
import { IdentityEngine } from "./identity-engine";
import { invalidateCandidateDossierCache } from "./cip";
import { invalidateEngineCache } from "./engine";
import { getRepositories } from "../../data/sqlite/provider";
import { validateSessionToken, SESSION_COOKIE_NAME } from "../auth/session";
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

async function getAuthenticatedUser(): Promise<UserSession> {
  try {
    const token = getCookie(SESSION_COOKIE_NAME);
    if (token) {
      const { user } = await validateSessionToken(token);
      if (user) {
        return {
          userId: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl || undefined,
          onboarded: user.onboarded
        };
      }
    }
  } catch (err) {
    console.warn("[profile-server] Session lookup fallback triggered:", err);
  }
  return {
    userId: "swapnil-shukla",
    email: "swapnil@radar.advisory",
    name: "Swapnil Shukla",
    avatarUrl: undefined,
    onboarded: true
  };
}

// ─── API: DYNAMIC STATE LOAD ───────────────────────────────────────────────
export const getCandidateStateFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<CandidateState> => {
    const user = await getAuthenticatedUser();
    const repos = getRepositories();
    const state = await repos.people.getCandidateState(user.userId);
    if (!state) {
      throw new Error("Candidate state not found for user. Please complete onboarding.");
    }
    return state;
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
      const activeSession = await getAuthenticatedUser();
      console.log(`[profile-server] Ingesting ${sourceType} (${sourceName})…`);
      
      let finalTextForSource = sourceText || "";
      let inlineFile: { mimeType: string; data: string } | undefined = undefined;

      if (sourceFileBase64 && sourceMimeType) {
        if (sourceMimeType === "application/pdf") {
          inlineFile = {
            mimeType: "application/pdf",
            data: sourceFileBase64
          };
          finalTextForSource = `[PDF Document Ingested: ${sourceName}]`;
        } else if (
          sourceMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
          sourceName.endsWith(".docx")
        ) {
          const buffer = Buffer.from(sourceFileBase64, "base64");
          const result = await mammoth.extractRawText({ buffer });
          finalTextForSource = result.value;
        } else {
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

      const repos = getRepositories();
      let currentState = await repos.people.getCandidateState(activeSession.userId);
      
      if (!currentState) {
        throw new Error("Cannot ingest evidence on an uninitialized profile. Complete onboarding first.");
      }
      
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
      const updatedSources = [newSource, ...currentState.sources.filter((s: any) => s.id !== "seed-resume-legacy")];
      const updatedFacts = [...extractedFacts, ...currentState.facts.filter((f: any) => f.evidenceId !== "seed-resume-legacy")];

      if (parsedName) activeSession.name = parsedName;

      // Compile state using IdentityEngine
      const compiledState = IdentityEngine.compile(
        activeSession,
        updatedSources,
        updatedFacts,
        currentState.intent
      );

      await repos.people.saveCandidateState(activeSession.userId, compiledState);

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
    const user = await getAuthenticatedUser();
    const repos = getRepositories();
    const currentState = await repos.people.getCandidateState(user.userId);
    
    if (!currentState) throw new Error("State not found");
    
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
    await repos.people.saveCandidateState(user.userId, currentState);
    
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
    const user = await getAuthenticatedUser();
    const repos = getRepositories();
    const currentState = await repos.people.getCandidateState(user.userId);
    
    if (!currentState) throw new Error("State not found");
    
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
    
    await repos.people.saveCandidateState(user.userId, currentState);

    // DYNAMIC RE-PLANNING: Invoke CareerIntent extraction and SearchPlanner!
    try {
      console.log("[profile-server] Triggering automatic Search Re-Planning...");
      const path = getNodePath();
      const fs = getNodeFs();
      if (path && fs) {
        // Create a temporary mock of the profile file for the scraper
        const tempProfilePath = path.join(process.cwd(), ".radar", `temp-profile-${user.userId}.json`);
        
        const legacyProfileComp = {
          identity: {
            name: currentState.session?.name || currentState.identity.identity.archetype,
            currentTitle: currentState.intent.targetRoles[0]?.title || "Executive Leader"
          },
          executiveIdentity: currentState.identity.identity,
          experience: {
            yearsExperience: 20,
            teamSizeManaged: currentState.identity.leadership.largestTeam,
            feeBookScale: currentState.identity.leadership.budgetScale,
            plOwnership: true,
            boardInteraction: currentState.identity.leadership.boardExposure,
            achievements: currentState.identity.achievements
          },
          leadershipProfile: {
            largestTeam: currentState.identity.leadership.largestTeam,
            globalMarkets: currentState.identity.leadership.globalMarketsCount,
            regions: currentState.intent.locations,
            budgetResponsibility: currentState.identity.leadership.budgetScale,
            commercialOwnership: true,
            boardExposure: currentState.identity.leadership.boardExposure,
            globalPrograms: true,
            peopleLeadership: true,
            matrixLeadership: true,
            vendorManagement: true,
            clientLeadership: true
          },
          evidence: currentState.identity.evidence,
          capabilities: currentState.identity.capabilities.categories,
          headspaceCapacityPerMonth: currentState.intent.maxMonthlyPursuits
        };
        fs.writeFileSync(tempProfilePath, JSON.stringify(legacyProfileComp, null, 2), "utf-8");
        
        const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
        const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
        const searchPlanOutputPath = path.join(process.cwd(), "src", "data", "search-plan.json");
        
        const { CareerIntentModel } = await import("../../../scripts/scraper/run/career-intent");
        const intent = CareerIntentModel.extractIntent(tempProfilePath, taxonomyPath);
        
        const { SearchPlanner } = await import("../../../scripts/scraper/run/search-planner");
        const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
        
        fs.writeFileSync(searchPlanOutputPath, JSON.stringify(searchPlan, null, 2), "utf-8");
        console.log(`[profile-server] Successfully regenerated search-plan.json with ${searchPlan.rankedQueries.length} compiled queries!`);
        
        fs.unlinkSync(tempProfilePath);
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
      let user: UserSession;
      try {
        user = await getAuthenticatedUser();
      } catch {
        user = {
          userId: data.mode === "swapnil" ? "swapnil-shukla" : `user-${Date.now()}`,
          email: data.mode === "swapnil" ? "swapnil@radar.advisory" : "guest@radar.advisory",
          name: data.mode === "swapnil" ? "Swapnil Shukla" : "Guest Executive",
          avatarUrl: "https://lh3.googleusercontent.com/a/default-user=s100",
          onboarded: true
        };
      }
      const repos = getRepositories();

      console.log("[profile-server] Initializing Fresh Blank Session for candidate...");
      
      // Create an empty skeleton state
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
        session: user,
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

      await repos.people.saveCandidateState(user.userId, skeletonState);
      
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
