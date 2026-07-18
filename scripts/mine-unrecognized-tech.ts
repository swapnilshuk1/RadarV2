import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const DB_PATH = path.join(__dirname, "../radar.sqlite");
const ONTOLOGY_PATH = path.join(__dirname, "../config/ontologies/technology.json");
const REPORT_DIR = path.join(__dirname, "../config/reports");
const REPORT_PATH = path.join(REPORT_DIR, "unrecognized-technologies.md");

// Thresholds
const TF_MIN = 3;
const TF_HIGH = 8;
const MIN_SHARED_DOCS = 3; // Co-occurrence support threshold

// Common Stopwords & Generic Phrases
const STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "for", "with", "on", "at", "by", "an", "be", "is", "are", 
  "this", "that", "from", "as", "it", "its", "or", "but", "not", "your", "our", "their", "we", "us", "you",
  "they", "he", "she", "them", "who", "whom", "which", "what", "where", "when", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "than", "too", "very", "can", "will", "just",
  "should", "would", "could", "has", "have", "had", "having", "do", "does", "did", "doing", "about", "above",
  "after", "again", "against", "along", "among", "around", "before", "behind", "below", "between", "during",
  "into", "through", "under", "until", "upon", "within", "without"
]);

const GENERIC_WORDS = new Set([
  "experience", "team", "management", "skills", "work", "role", "business", "growth", "sales", "marketing",
  "product", "technology", "tools", "years", "platforms", "knowledge", "customers", "leads", "processes",
  "strategy", "planning", "support", "operations", "executive", "development", "solutions", "services",
  "requirements", "systems", "applications", "performance", "results", "success", "responsibilities",
  "communication", "ability", "working", "job", "description", "apply", "easily", "company", "location",
  "posted", "recent", "status", "posting", "hiring", "managed", "using", "field", "industry", "customer",
  "strategic", "key", "high", "new", "strong", "preferred", "relevant", "related", "minimum", "required",
  "equivalent", "track", "record", "degree", "hands-on", "proven", "ability", "excellent", "written",
  "verbal", "highly", "motivated", "fast-paced", "environment", "global", "office", "opportunity",
  "candidates", "position", "full-time", "part-time", "remotely", "hybrid", "flexible", "benefits",
  "salary", "competitive", "compensation", "package", "health", "insurance", "join", "culture",
  "leader", "leading", "innovative", "successful", "focused", "client", "partners", "relationships"
]);

const CAPABILITY_KEYWORDS = new Set([
  "crm", "seo", "sem", "cdp", "attribution", "optimization", "automation", "analytics", "intelligence", 
  "marketing", "sales", "support", "engineering", "success", "operations", "revops", "growth", "strategy", 
  "methodology", "planning", "accounting", "advisory", "evaluation", "design", "development", "content", 
  "media", "reporting", "campaigns", "analysis", "roi", "creative", "ads", "digital", "comms"
]);

const BUSINESS_CONTEXT_KEYWORDS = new Set([
  "saas", "b2b", "d2c", "b2c", "gtm", "plg", "business", "market", "model", "industry", "pricing", 
  "capital", "equity", "finance", "banking", "startup", "firm", "enterprise", "corporate", "domain",
  "permanent", "role", "employment", "time", "full", "india", "usa", "asia", "global", "office", "head",
  "permanentrole", "skillsskills", "chief"
]);

interface ContextSnippet {
  docTitle: string;
  docPortal: string;
  sentence: string;
}

interface EvidenceCandidate {
  phrase: string;
  category: "Technology" | "Capability" | "BusinessContext";
  occurrences: number;
  docs: Set<string>;
  functions: Set<string>;
  archetypes: Set<string>;
  exampleQuotes: string[];
  confidence: number;
  contexts: ContextSnippet[];
}

interface NormalizedDoc {
  id: string;
  title: string;
  company: string;
  portal: string;
  text: string;
  function: string;
  archetype: string;
}

function classifyFunction(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("engineer") || t.includes("developer") || t.includes("architect") || t.includes("tech lead") || t.includes("cto") || t.includes("technology")) return "Engineering";
  if (t.includes("marketing") || t.includes("growth") || t.includes("seo") || t.includes("brand") || t.includes("content") || t.includes("creative")) return "Marketing";
  if (t.includes("sales") || t.includes("account executive") || t.includes("revenue") || t.includes("business development") || t.includes("ae") || t.includes("bde")) return "Sales";
  if (t.includes("product manager") || t.includes("product owner") || t.includes("pm") || t.includes("cpo") || t.includes("head of product")) return "Product";
  if (t.includes("customer success") || t.includes("success manager") || t.includes("support") || t.includes("client relations")) return "Customer Success";
  if (t.includes("finance") || t.includes("cfo") || t.includes("treasury") || t.includes("tax") || t.includes("accountant") || t.includes("audit") || t.includes("controller")) return "Finance";
  if (t.includes("operations") || t.includes("coo") || t.includes("ops") || t.includes("delivery") || t.includes("process manager")) return "Operations";
  if (t.includes("strategy") || t.includes("planning") || t.includes("chief of staff") || t.includes("corp dev") || t.includes("corporate development")) return "Strategy";
  if (t.includes("hr") || t.includes("human resources") || t.includes("recruiter") || t.includes("people") || t.includes("talent")) return "HR / People";
  if (t.includes("data") || t.includes("analytics") || t.includes("bi ") || t.includes("business intelligence") || t.includes("analyst")) return "Data / Analytics";
  if (t.includes("consultant") || t.includes("consulting") || t.includes("advisor") || t.includes("advisory")) return "Consulting";
  return "Other";
}

function classifyEmployerArchetype(companyName: string, text: string): string {
  const c = companyName.toLowerCase();
  const t = text.toLowerCase();
  
  if (t.includes("gcc") || t.includes("global capability") || t.includes("shared services") || t.includes("offshore development") || t.includes("delivery center") || t.includes("captive center")) {
    return "GCC";
  }
  if (t.includes("startup") || t.includes("start-up") || t.includes("early stage") || t.includes("venture-backed") || t.includes("venture capital") || t.includes("series a") || t.includes("series b") || t.includes("seed-funded") || t.includes("seed stage")) {
    return "Startup";
  }
  if (t.includes("private equity") || t.includes("pe-backed") || t.includes("portfolio company") || t.includes("pe backed")) {
    return "PE-backed";
  }
  if (t.includes("fortune 500") || t.includes("multinational") || t.includes("enterprise scale") || t.includes("global enterprise") || t.includes("conglomerate") || t.includes("large-scale enterprise")) {
    return "Enterprise";
  }
  if (t.includes("mid-market") || t.includes("mid market") || t.includes("medium-sized") || t.includes("sme") || t.includes("smb") || t.includes("growing company") || t.includes("medium enterprise")) {
    return "Mid Market";
  }
  return "Unknown archetype";
}

function calculateConfidence(phrase: string, tokens: string[]): number {
  let score = 0.95;
  if (phrase.length <= 2) {
    score -= 0.15;
  }
  for (const t of tokens) {
    if (/^[A-Z]/.test(t)) {
      score += 0.02;
    } else {
      score -= 0.05;
    }
  }
  return parseFloat(Math.min(1.0, Math.max(0.5, score)).toFixed(2));
}

function qualifiesForPromotion(cand: EvidenceCandidate): boolean {
  return (
    cand.docs.size >= 5 &&
    cand.functions.size >= 2 &&
    cand.archetypes.size >= 2 &&
    cand.confidence >= 0.8
  );
}

function shouldExcludeGram(tokens: string[], existingTerms: Set<string>): boolean {
  if (tokens.length === 0) return true;
  if (tokens.length === 1) {
    const single = tokens[0].toLowerCase();
    if (single.length === 1 && single !== "r" && single !== "c" && single !== "q") return true;
  }
  const joined = tokens.join("");
  if (/^[0-9+.-]+$/.test(joined)) return true;

  const first = tokens[0].toLowerCase();
  const last = tokens[tokens.length - 1].toLowerCase();

  if (STOPWORDS.has(first) || STOPWORDS.has(last)) return true;
  if (GENERIC_WORDS.has(first) || GENERIC_WORDS.has(last)) return true;

  for (const tok of tokens) {
    const tLower = tok.toLowerCase();
    if (STOPWORDS.has(tLower)) return true;
    if (tLower.length <= 1 && !/^[a-zA-Z0-9]$/.test(tLower)) return true;
  }
  return false;
}

function isRedundantWithOntology(term: string, existingTerms: Set<string>): boolean {
  if (existingTerms.has(term)) return true;
  for (const ext of existingTerms) {
    if (ext.length > 3 && term.length > 3) {
      if (ext.includes(term) || term.includes(ext)) {
        return true;
      }
    }
  }
  return false;
}

function passesProperNounHeuristic(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tokens.length > 1 && i > 0 && i < tokens.length - 1 && STOPWORDS.has(tok.toLowerCase())) {
      continue;
    }
    const firstChar = tok.charAt(0);
    const isCapitalized = firstChar >= "A" && firstChar <= "Z";
    const isAcronym = /^[A-Z0-9+#.-]+$/.test(tok) && tok.length >= 2;
    const hasInternalCap = /[a-z]+[A-Z]+/.test(tok);

    if (!isCapitalized && !isAcronym && !hasInternalCap) {
      return false;
    }
  }
  return true;
}

function cleanContextSentence(sentence: string, targetPhrase: string): string {
  let clean = sentence.replace(/\s+/g, " ").trim();
  const index = clean.toLowerCase().indexOf(targetPhrase.toLowerCase());
  
  if (index !== -1 && clean.length > 120) {
    const start = Math.max(0, index - 40);
    const end = Math.min(clean.length, index + targetPhrase.length + 50);
    clean = (start > 0 ? "... " : "") + clean.substring(start, end).trim() + (end < clean.length ? " ..." : "");
  }
  return clean;
}

function getQueue(phrase: string): { code: "A" | "B" | "C"; category: "Technology" | "Capability" | "BusinessContext" } {
  const words = phrase.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (BUSINESS_CONTEXT_KEYWORDS.has(w)) {
      return { code: "C", category: "BusinessContext" };
    }
  }
  for (const w of words) {
    if (CAPABILITY_KEYWORDS.has(w)) {
      return { code: "B", category: "Capability" };
    }
  }
  return { code: "A", category: "Technology" };
}

// ==========================================================================
// PRESCRIPTIVE CANDIDATE ENGINE (Ontology Ingestion / Human-in-the-Loop)
// ==========================================================================
class EvidenceCandidateEngine {
  public candidates: Map<string, EvidenceCandidate> = new Map();

  constructor(
    private readonly documents: NormalizedDoc[],
    private readonly existingTerms: Set<string>
  ) {}

  public mine(): void {
    for (const doc of this.documents) {
      const rawSentences = doc.text.split(/[.!?;\n]+/);
      
      for (const rawSentence of rawSentences) {
        const sentence = rawSentence.trim();
        if (sentence.length < 5) continue;

        const tokens = sentence.match(/[a-zA-Z0-9+#.-]+/g) || [];
        if (tokens.length === 0) continue;

        for (let n = 1; n <= 3; n++) {
          for (let i = 0; i <= tokens.length - n; i++) {
            const gramTokens = tokens.slice(i, i + n);
            if (shouldExcludeGram(gramTokens, this.existingTerms)) continue;

            const rawPhrase = gramTokens.join(" ");
            const normalizedPhrase = rawPhrase.toLowerCase().trim();

            if (isRedundantWithOntology(normalizedPhrase, this.existingTerms)) continue;
            if (!passesProperNounHeuristic(gramTokens)) continue;

            if (!this.candidates.has(normalizedPhrase)) {
              const queueInfo = getQueue(rawPhrase);
              this.candidates.set(normalizedPhrase, {
                phrase: rawPhrase,
                category: queueInfo.category,
                occurrences: 0,
                docs: new Set<string>(),
                functions: new Set<string>(),
                archetypes: new Set<string>(),
                exampleQuotes: [],
                confidence: calculateConfidence(rawPhrase, gramTokens),
                contexts: []
              });
            }

            const cand = this.candidates.get(normalizedPhrase)!;
            cand.occurrences++;
            cand.docs.add(doc.id);
            cand.functions.add(doc.function);
            cand.archetypes.add(doc.archetype);
            
            if (cand.contexts.length < 3 && !cand.contexts.some(c => c.sentence === sentence)) {
              cand.contexts.push({
                docTitle: doc.title,
                docPortal: doc.portal,
                sentence: cleanContextSentence(sentence, rawPhrase)
              });
            }
          }
        }
      }
    }
  }

  public getQueues() {
    const list = Array.from(this.candidates.values()).filter(c => c.docs.size >= TF_MIN);
    const queueA = list.filter(c => c.category === "Technology").sort((a, b) => b.docs.size - a.docs.size);
    const queueB = list.filter(c => c.category === "Capability").sort((a, b) => b.docs.size - a.docs.size);
    const queueC = list.filter(c => c.category === "BusinessContext").sort((a, b) => b.docs.size - a.docs.size);
    return { queueA, queueB, queueC };
  }
}

// ==========================================================================
// DESCRIPTIVE CORPUS ANALYTICS ENGINE (Descriptive observations, Trends, Graph)
// ==========================================================================
interface CooccurrencePair {
  termA: string;
  termB: string;
  sharedDocs: number;
  jaccard: number;
  avgConfidence: number;
  type: "Stack" | "Affinity";
}

class CorpusAnalyticsEngine {
  private readonly functionsList = [
    "Engineering", "Marketing", "Sales", "Product", "Finance", 
    "Customer Success", "Operations", "Strategy", "Consulting", "Other"
  ];

  constructor(
    private readonly documents: NormalizedDoc[],
    private readonly ontology: Record<string, any>,
    private readonly candidates: Map<string, EvidenceCandidate>
  ) {}

  /**
   * Generates a structural heatmap of Matched Technologies (rows) by Functional Domain (columns).
   */
  public generateHeatmap(): { topProducts: string[]; heatmap: Record<string, Record<string, number>> } {
    const productCounts: Record<string, number> = {};
    const productDocMap: Record<string, Set<string>> = {};
    const heatmap: Record<string, Record<string, number>> = {};

    // Initialize counts
    for (const [prodName, details] of Object.entries(this.ontology)) {
      productCounts[prodName] = 0;
      productDocMap[prodName] = new Set();
      heatmap[prodName] = {};
      for (const fn of this.functionsList) {
        heatmap[prodName][fn] = 0;
      }
    }

    // Scan docs
    for (const doc of this.documents) {
      const textLower = doc.text.toLowerCase();
      
      for (const [prodName, details] of Object.entries(this.ontology)) {
        const termsToSearch = new Set<string>([prodName.toLowerCase()]);
        const d = details as { aliases?: string[] };
        if (d.aliases) {
          for (const alias of d.aliases) {
            termsToSearch.add(alias.toLowerCase());
          }
        }

        let matched = false;
        for (const term of termsToSearch) {
          const escaped = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
          const regex = new RegExp(`\\b${escaped}\\b`, "i");
          if (regex.test(textLower)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          productCounts[prodName]++;
          productDocMap[prodName].add(doc.id);
          const fn = this.functionsList.includes(doc.function) ? doc.function : "Other";
          heatmap[prodName][fn]++;
        }
      }
    }

    // Extract top 10 products
    const topProducts = Object.keys(productCounts)
      .sort((a, b) => productCounts[b] - productCounts[a])
      .slice(0, 10);

    return { topProducts, heatmap };
  }

  /**
   * Evaluates Tool Stack (Tech-Tech) and Tool Affinity (Tech-Cap) co-occurrences.
   */
  public calculateCooccurrences(queueAPhrases: Set<string>, queueBPhrases: Set<string>): CooccurrencePair[] {
    const docItems = new Map<string, Set<{ term: string; type: "Tech" | "Cap"; confidence: number }>>();

    // 1. Map documents to sets of active matched technologies & mined candidates
    for (const doc of this.documents) {
      const set = new Set<{ term: string; type: "Tech" | "Cap"; confidence: number }>();
      docItems.set(doc.id, set);

      // Add matched products
      const textLower = doc.text.toLowerCase();
      for (const [prodName, details] of Object.entries(this.ontology)) {
        const termsToSearch = new Set<string>([prodName.toLowerCase()]);
        const d = details as { aliases?: string[] };
        if (d.aliases) {
          for (const alias of d.aliases) {
            termsToSearch.add(alias.toLowerCase());
          }
        }

        let matched = false;
        for (const term of termsToSearch) {
          const escaped = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
          const regex = new RegExp(`\\b${escaped}\\b`, "i");
          if (regex.test(textLower)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          set.add({ term: prodName, type: "Tech", confidence: 1.0 });
        }
      }

      // Add Queue A & B candidates
      for (const cand of this.candidates.values()) {
        if (cand.docs.has(doc.id)) {
          if (cand.category === "Technology" && queueAPhrases.has(cand.phrase.toLowerCase())) {
            set.add({ term: cand.phrase, type: "Tech", confidence: cand.confidence });
          } else if (cand.category === "Capability" && queueBPhrases.has(cand.phrase.toLowerCase())) {
            set.add({ term: cand.phrase, type: "Cap", confidence: cand.confidence });
          }
        }
      }
    }

    // 2. Count document frequencies for Jaccard calculation
    const docFreqs: Record<string, number> = {};
    const itemTypes: Record<string, "Tech" | "Cap"> = {};
    const itemConfidences: Record<string, number> = {};

    for (const [_, items] of docItems.entries()) {
      for (const item of items) {
        docFreqs[item.term] = (docFreqs[item.term] || 0) + 1;
        itemTypes[item.term] = item.type;
        itemConfidences[item.term] = Math.max(itemConfidences[item.term] || 0, item.confidence);
      }
    }

    // 3. Count shared co-occurrence documents
    const pairSharedDocs = new Map<string, number>();

    for (const [_, items] of docItems.entries()) {
      const arr = Array.from(items);
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const key = arr[i].term < arr[j].term 
            ? `${arr[i].term}||${arr[j].term}` 
            : `${arr[j].term}||${arr[i].term}`;
          pairSharedDocs.set(key, (pairSharedDocs.get(key) || 0) + 1);
        }
      }
    }

    // 4. Compute metrics and filter by Support Threshold
    const results: CooccurrencePair[] = [];

    for (const [key, shared] of pairSharedDocs.entries()) {
      if (shared < MIN_SHARED_DOCS) continue; // Apply strict support threshold

      const [termA, termB] = key.split("||");
      const freqA = docFreqs[termA] || 0;
      const freqB = docFreqs[termB] || 0;

      // Jaccard similarity
      const jaccard = shared / (freqA + freqB - shared);
      const avgConf = (itemConfidences[termA] + itemConfidences[termB]) / 2;

      // Classify type: Stack (Tech-Tech) vs Affinity (Tech-Cap)
      const typeA = itemTypes[termA];
      const typeB = itemTypes[termB];
      const type = (typeA === "Tech" && typeB === "Tech") ? "Stack" : "Affinity";

      results.push({
        termA,
        termB,
        sharedDocs: shared,
        jaccard,
        avgConfidence: avgConf,
        type
      });
    }

    // 5. Rank by: (1) sharedDocs descending, (2) Jaccard descending, (3) confidence descending
    return results.sort((a, b) => {
      if (b.sharedDocs !== a.sharedDocs) return b.sharedDocs - a.sharedDocs;
      if (b.jaccard !== a.jaccard) return b.jaccard - a.jaccard;
      return b.avgConfidence - a.avgConfidence;
    });
  }
}

// ==========================================================================
// CORE ORCHESTRATION PIPELINE
// ==========================================================================
function main() {
  console.log("==========================================================================");
  console.log("             RADAR EVIDENCE INTELLIGENCE & CORPUS ANALYTICS               ");
  console.log("==========================================================================");

  // 1. Load Ontology
  if (!fs.existsSync(ONTOLOGY_PATH)) {
    console.error(`Error: Ontology not found at ${ONTOLOGY_PATH}`);
    process.exit(1);
  }
  const ontology = JSON.parse(fs.readFileSync(ONTOLOGY_PATH, "utf8"));
  const existingTerms = new Set<string>();

  for (const [prodName, details] of Object.entries(ontology)) {
    existingTerms.add(prodName.toLowerCase().trim());
    const d = details as { aliases?: string[] };
    if (d.aliases) {
      for (const alias of d.aliases) {
        existingTerms.add(alias.toLowerCase().trim());
      }
    }
  }
  console.log(`✓ Loaded technology ontology containing ${existingTerms.size} unique terms/aliases.`);

  // 2. Connect to Database & fetch normalized JDs
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: Database not found at ${DB_PATH}`);
    process.exit(1);
  }
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare("SELECT content FROM documents").all() as { content: string }[];
  
  const documents: NormalizedDoc[] = [];
  let totalDocs = 0;

  for (let i = 0; i < rows.length; i++) {
    const content = JSON.parse(rows[i].content);
    const text = content.normalizedText?.trim() || "";
    if (text.length > 50) {
      documents.push({
        id: content.jobHash || `doc-${i}`,
        title: content.role || "Unknown Title",
        company: content.company ?? content.company_name ?? "",
        portal: content.scrapedFrom || "Unknown",
        text,
        function: classifyFunction(content.role || "Unknown"),
        archetype: classifyEmployerArchetype(content.company ?? content.company_name ?? "", text)
      });
    }
    totalDocs++;
  }

  console.log(`✓ Database scanned: ${documents.length} / ${totalDocs} documents have verified normalizedText.`);

  if (documents.length === 0) {
    console.log("⚠ No documents with normalized source text found. Please run scrapers first.");
    process.exit(0);
  }

  // ==========================================================================
  // EXECUTE MODULES
  // ==========================================================================

  // A. Candidate Engine (Prescriptive Ontology Candidates)
  const candidateEngine = new EvidenceCandidateEngine(documents, existingTerms);
  candidateEngine.mine();
  const { queueA, queueB, queueC } = candidateEngine.getQueues();

  console.log(`✓ Mined ${candidateEngine.candidates.size} unrecognized candidate phrases.`);

  // B. Analytics Engine (Descriptive Observations & Graphs)
  const analyticsEngine = new CorpusAnalyticsEngine(documents, ontology, candidateEngine.candidates);
  const { topProducts, heatmap } = analyticsEngine.generateHeatmap();

  const queueAPhrases = new Set(queueA.map(c => c.phrase.toLowerCase()));
  const queueBPhrases = new Set(queueB.map(c => c.phrase.toLowerCase()));
  const cooccurrences = analyticsEngine.calculateCooccurrences(queueAPhrases, queueBPhrases);

  // Split co-occurrences into Stacks (Tech-Tech) and Affinities (Tech-Cap)
  const toolStacks = cooccurrences.filter(c => c.type === "Stack").slice(0, 10);
  const toolAffinities = cooccurrences.filter(c => c.type === "Affinity").slice(0, 10);

  // ==========================================================================
  // GENERATE THE INTEGRATED REPORT
  // ==========================================================================
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  let markdown = `# RADAR Evidence Intelligence & Corpus Analytics Report

> **Architectural Principle**: *Corpus analytics are descriptive; ontology promotion is prescriptive.*
> - **Corpus Analytics** describe patterns observed in the corpus.
> - **Promotion Decisions** determine what becomes part of the platform's permanent knowledge.

---

## 📊 Report Metadata & Versioning

* **Generated Date**: ${new Date().toISOString().split("T")[0]}
* **Corpus Tier 1 Size**: ${documents.length} / ${totalDocs} documents (Modernized raw text preserved)
* **Ontology Metadata Version**: 1.1.0
* **Ontology Product Count**: ${Object.keys(ontology).length} products (${existingTerms.size} aliases)
* **Promotion Policy Version**: v1.0
  * *Threshold gates*: Document Frequency $C_{docs} \ge 5$, Functional Domains $\ge 2$, Employer Archetypes $\ge 2$, Confidence Score $\ge 80\%$.

---

## Part I: Prescriptive Evidence Intelligence

Unrecognized Title Case noun phrases are mined, classified into logical evaluation queues, and evaluated against strict promotion gates for direct ontology inclusion.

`;

  const renderQueueTable = (title: string, desc: string, list: EvidenceCandidate[]) => {
    let out = `### ✦ ${title}\n> *${desc}*\n\n`;
    if (list.length === 0) {
      out += "*No candidates surfaced in this queue.*\n\n";
      return out;
    }

    out += `| Candidate Phrase | Occurrences | Doc Freq ($C_{docs}$) | Functions | Archetypes | Confidence | Promotion Status | Context/Sample Sentiment |\n`;
    out += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

    for (const cand of list) {
      const freq = cand.docs.size;
      const confidenceStr = `${Math.round(cand.confidence * 100)}%`;
      const promotionStatus = qualifiesForPromotion(cand) ? "✅ Certified" : "Under Review";
      
      const sampleContext = cand.contexts.length > 0 
        ? cand.contexts[0].sentence.replace(new RegExp(`(${cand.phrase})`, "i"), "**$1**")
        : "";

      out += `| **${cand.phrase}** | ${cand.occurrences} | ${freq} | ${cand.functions.size} | ${cand.archetypes.size} | ${confidenceStr} | **${promotionStatus}** | *"${sampleContext}"* |\n`;
    }
    out += "\n";
    return out;
  };

  markdown += renderQueueTable("Queue A — Product Candidates", "Specific software platforms, software tools, or vendor brand names. Candidates here are prime options for direct ontology admission.", queueA);
  markdown += renderQueueTable("Queue B — Capability Candidates", "Broad skills, technical domains, or categories. (Map as categories/inferred capabilities rather than products).", queueB);
  markdown += renderQueueTable("Queue C — Business Context Candidates", "Business model descriptors, industries, or operational contexts. (Pause/Hold; do not add to Technology ontology).", queueC);

  markdown += `\n---\n\n## Part II: Descriptive Corpus Analytics

Observational data structures mapping tech stack distribution and tooling affinities across corpus dimensions.

### ✦ Matched Technology Heatmap
The table below maps the frequency of the top 10 most common recognized technology products across functional executive domains.

| Technology | Engineering | Marketing | Sales | Product | Finance | CS | Operations | Strategy | Consulting | Other |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const prod of topProducts) {
    const row = heatmap[prod];
    markdown += `| **${prod}** | ${row["Engineering"]} | ${row["Marketing"]} | ${row["Sales"]} | ${row["Product"]} | ${row["Finance"]} | ${row["Customer Success"]} | ${row["Operations"]} | ${row["Strategy"]} | ${row["Consulting"]} | ${row["Other"]} |\n`;
  }

  markdown += `\n### ✦ Emerging Tool Stacks (Technology ↔ Technology)
Logical tooling dependencies matching pairs of products/tech candidates co-occurring frequently in the same opportunities.
*Support Threshold: shared_docs $\ge ${MIN_SHARED_DOCS}$*

| Product A | Product B | Shared Docs | Jaccard Similarity | Average Confidence | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |\n`;

  for (const stack of toolStacks) {
    const isCandA = queueAPhrases.has(stack.termA.toLowerCase());
    const isCandB = queueAPhrases.has(stack.termB.toLowerCase());
    const status = (isCandA || isCandB) ? "🟡 Candidate Stack" : "✅ Certified Stack";
    markdown += `| **${stack.termA}** | **${stack.termB}** | ${stack.sharedDocs} | ${(stack.jaccard * 100).toFixed(1)}% | ${Math.round(stack.avgConfidence * 100)}% | ${status} |\n`;
  }

  markdown += `\n### ✦ Emerging Tool Affinities (Technology ↔ Capability)
Tool-to-human-skill associations matching specific tools against broad domains or categories.
*Support Threshold: shared_docs $\ge ${MIN_SHARED_DOCS}$*

| Technology | Capability | Shared Docs | Jaccard Similarity | Average Confidence | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |\n`;

  for (const aff of toolAffinities) {
    markdown += `| **${aff.termA}** | **${aff.termB}** | ${aff.sharedDocs} | ${(aff.jaccard * 100).toFixed(1)}% | ${Math.round(aff.avgConfidence * 100)}% | 🟡 Emerging Affinity |\n`;
  }

  markdown += `\n---\n\n## Part III: Candidate Context Details\n\n`;
  markdown += `Below are detailed contextual sentence examples from the JDs for the candidate proper nouns to assist in human-in-the-loop ontology categorization.\n\n`;

  const renderQueueDetails = (title: string, list: EvidenceCandidate[]) => {
    let out = `### ✦ ${title} Details\n\n`;
    if (list.length === 0) return out;

    for (const cand of list) {
      const qualifies = qualifiesForPromotion(cand);
      const promotionStatus = qualifies 
        ? "✅ Certified (Meets standard gates: docs >= 5, functions >= 2, archetypes >= 2, confidence >= 0.8)" 
        : "Under Review (Insufficient distinct document frequency, functional diversity, or confidence score)";
        
      out += `#### ${cand.phrase} ($C_{docs} = ${cand.docs.size}$)\n`;
      out += `* **Total Occurrences**: ${cand.occurrences}\n`;
      out += `* **Confidence Level**: ${Math.round(cand.confidence * 100)}%\n`;
      out += `* **Promotion Status**: ${promotionStatus}\n`;
      out += `* **Associated Functions**: ${Array.from(cand.functions).join(", ")}\n`;
      out += `* **Associated Archetypes**: ${Array.from(cand.archetypes).join(", ")}\n`;
      out += `* **Sample Usage Contexts**:\n`;
      for (const ctx of cand.contexts) {
        const formattedSentence = ctx.sentence.replace(new RegExp(`(${cand.phrase})`, "i"), "**$1**");
        out += `  * [${ctx.docPortal}] *"${formattedSentence}"* (Role: **${ctx.docTitle}**)\n`;
      }
      out += `\n`;
    }
    return out;
  };

  markdown += renderQueueDetails("Queue A (Products)", queueA);
  markdown += renderQueueDetails("Queue B (Capabilities)", queueB);
  markdown += renderQueueDetails("Queue C (Business Context)", queueC);

  fs.writeFileSync(REPORT_PATH, markdown, "utf8");
  console.log(`✓ Integrated report compiled and successfully written to:`);
  console.log(`  ${REPORT_PATH}`);
  console.log("==========================================================================");
}

main();
