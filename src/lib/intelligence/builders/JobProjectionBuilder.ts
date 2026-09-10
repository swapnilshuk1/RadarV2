import { JobProjection, GroundedOpportunityDimension, ExecutiveIdentity, OperatingContext, TrueExecutiveMandate, CapabilityTaxonomyTier, OrganizationalIntent, ExecutiveMission, type CapabilityRequirement, type ProjectedCapability, type DocumentRegion, type ProjectedRoleWorkEvidence } from "../../domain/job_projection";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import { SemanticResolutionEngine } from "../semantic/SemanticResolutionEngine";
import type { CanonicalSemanticEvidence } from "../semantic/types";
import type { ValidatedJobDocument } from "../../domain/canonical_acquisition";
import { createHash } from "node:crypto";

type RoleWorkRejectionReason =
  | "empty"
  | "oversized"
  | "malformed"
  | "mixed_or_meta"
  | "qualification"
  | "corporate_or_workplace"
  | "not_assigned_work";

type RoleWorkExtraction = {
  evidence: ProjectedRoleWorkEvidence[];
  rejected: Record<RoleWorkRejectionReason, number>;
};

export class JobProjectionBuilder {

  public static readonly PROJECTION_VERSION = "job-projection/v1-grounded-document";
  /** Additive presentation evidence version; intentionally independent of projection identity. */
  public static readonly ROLE_WORK_EVIDENCE_VERSION = "role-work-evidence/v1";

  private static regexCache = new Map<string, RegExp>();
  private static projectionCache = new Map<string, JobProjection>();
  private static actualBuildCount = 0;

  public static clearCache(): void {
    this.regexCache.clear();
    this.projectionCache.clear();
    this.actualBuildCount = 0;
  }

  public static getCacheSize(): number {
    return this.projectionCache.size;
  }

  public static getBuildCount(): number {
    return this.actualBuildCount;
  }

  public static resetMetrics(): void {
    this.actualBuildCount = 0;
  }

  private static testKeyword(text: string, kw: string): boolean {
    let regex = this.regexCache.get(kw);
    if (!regex) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(`\\b${escaped}\\b`, 'i');
      this.regexCache.set(kw, regex);
    }
    return regex.test(text);
  }

  private static resolveEmployerName(rawCompany: string, fullText: string): string {
    if (!rawCompany) return "Target Company";
    const agencyKeywords = ["clanx", "michael page", "randstad", "korn ferry", "naukri", "recruitment partner", "headhunter"];
    const isAgency = agencyKeywords.some(a => rawCompany.toLowerCase().includes(a));
    
    if (isAgency) {
      const match = fullText.match(/(?:helping|partnering with|for|client|hire a)\s+([A-Z][A-Za-z0-9\s]+?)\s+(?:hire|build|grow|is hiring|to hire|to define)/i);
      if (match && match[1] && match[1].trim().length > 2 && match[1].trim().length < 30) {
        const cleaned = match[1].trim();
        return cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }
    }
    return rawCompany;
  }

  private static inferTrueExecutiveMandate(fullText: string, title: string): TrueExecutiveMandate {
    const text = (title + " " + fullText).toLowerCase();
    if (this.testKeyword(text, "turnaround") || this.testKeyword(text, "rebuild") || this.testKeyword(text, "fix") || this.testKeyword(text, "fragmented") || this.testKeyword(text, "corrective actions")) {
      return "TURNAROUND";
    }
    if (this.testKeyword(text, "ai-native") || this.testKeyword(text, "digital transformation") || this.testKeyword(text, "modernize") || this.testKeyword(text, "cloud migration")) {
      return "TRANSFORMATION";
    }
    if (this.testKeyword(text, "governance") || this.testKeyword(text, "reporting standards") || this.testKeyword(text, "pipeline visibility") || this.testKeyword(text, "sales review")) {
      return "GOVERNANCE";
    }
    if (this.testKeyword(text, "scale") || this.testKeyword(text, "d2c acquisition") || this.testKeyword(text, "rapid growth") || this.testKeyword(text, "international expansion")) {
      return "SCALE";
    }
    return "COMMERCIAL_EXPANSION";
  }

  private static inferOrganizationalIntent(fullText: string, title: string): OrganizationalIntent {
    const text = (title + " " + fullText).toLowerCase();
    if (this.testKeyword(text, "failed") || this.testKeyword(text, "previous") || this.testKeyword(text, "replace") || this.testKeyword(text, "interim")) {
      return "REPLACE_FAILED_LEADER";
    }
    if (this.testKeyword(text, "ipo") || this.testKeyword(text, "public listing") || this.testKeyword(text, "sox") || this.testKeyword(text, "pre-ipo")) {
      return "PREPARE_IPO";
    }
    if (this.testKeyword(text, "founder") || this.testKeyword(text, "first hire") || this.testKeyword(text, "professionalize") || this.testKeyword(text, "early stage")) {
      return "PROFESSIONALIZE_FOUNDER_COMPANY";
    }
    // Buying assets, sourcing debt, or raising capital is not evidence that
    // the role owns post-merger integration. Require explicit integration or
    // synergy language before emitting that factual organizational intent.
    if (this.testKeyword(text, "post-merger") || this.testKeyword(text, "acquisition integration") || this.testKeyword(text, "m&a integration") || this.testKeyword(text, "synergy")) {
      return "INTEGRATE_ACQUISITION";
    }
    if (this.testKeyword(text, "international") || this.testKeyword(text, "asean") || this.testKeyword(text, "global expansion") || this.testKeyword(text, "new markets")) {
      return "EXPAND_GEOGRAPHY";
    }
    if (this.testKeyword(text, "rebuild") || this.testKeyword(text, "repair") || this.testKeyword(text, "corrective") || this.testKeyword(text, "turnaround")) {
      return "REPAIR_EXECUTION";
    }
    if (this.testKeyword(text, "new team") || this.testKeyword(text, "build from scratch") || this.testKeyword(text, "0 to 1") || this.testKeyword(text, "greenfield")) {
      return "BUILD_NEW_CAPABILITY";
    }
    return "ACCELERATE_GROWTH";
  }

  private static buildExecutiveMission(
    role: string,
    company: string,
    mandate: TrueExecutiveMandate,
    intent: OrganizationalIntent,
    sourceText: string,
  ): ExecutiveMission {
    const intentLabels: Record<OrganizationalIntent, string> = {
      REPLACE_FAILED_LEADER: `Stabilize execution and replace leadership deficit at ${company}`,
      BUILD_NEW_CAPABILITY: `Establish greenfield ${role} organization at ${company} from 0 to 1`,
      PROFESSIONALIZE_FOUNDER_COMPANY: `Professionalize commercial operations and governance at ${company}`,
      PREPARE_IPO: `Prepare ${company}'s GTM and operational governance for enterprise IPO readiness`,
      INTEGRATE_ACQUISITION: `Lead post-merger integration and commercial synergy capture at ${company}`,
      REPAIR_EXECUTION: `Repair fragmented execution and rebuild operational rigor at ${company}`,
      ACCELERATE_GROWTH: `Accelerate enterprise revenue growth and market expansion at ${company}`,
      EXPAND_GEOGRAPHY: `Drive multi-region geographic expansion and GTM scaling for ${company}`,
      COMMERCIALIZE_TECHNOLOGY: `Commercialize proprietary technology assets into scalable revenue lines at ${company}`
    };

    return {
      intent,
      statement: intentLabels[intent] || `Lead strategic ${mandate.toLowerCase()} mission at ${company}`,
      // A mission may be inferred for classification, but success conditions
      // are published facts. Do not turn a generic mandate into invented P&L,
      // governance, or GTM commitments.
      successConditions: this.extractPublishedSuccessConditions(sourceText),
    };
  }

  private static extractPublishedSuccessConditions(sourceText: string): string[] {
    return sourceText
      .split(/(?<=[.!?])\s+|[\r\n]+/)
      .map((sentence) => sentence.replace(/\s+/g, " ").trim())
      .filter((sentence) => sentence.length >= 24 && sentence.length <= 500)
      .filter((sentence) => /\b(deliver|achieve|own|accountable|responsible|target|objective|kpi|metric|revenue|p\s*&\s*l|profitability|margin)\b/i.test(sentence))
      .filter((sentence, index, all) => all.indexOf(sentence) === index)
      .slice(0, 3);
  }

  private static normalizeSourceAtom(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private static sourceRegionForHeading(value: string): DocumentRegion | null {
    const heading = this.normalizeSourceAtom(value).toLowerCase().replace(/[:\d.\s—–-]+$/, "");
    if (!heading || heading.length > 100) return null;
    if (/\b(?:roles?\s*&\s*)?responsibilities|what you(?:'| a)?ll do|what you(?:'| a)?ll own|key deliverables|key accountabilities|(?:the )?mandate|the role|your role|duties\b/.test(heading)) {
      return "RESPONSIBILITIES";
    }
    if (/\b(?:requirements|qualifications|what you(?:'| a)?ll bring|what this role is not(?: for)?|ideal candidate|skills|experience required|who you are)\b/.test(heading)) {
      return "REQUIREMENTS";
    }
    if (/\b(?:about us|about the company|who we are|company overview|our story|why join)\b/.test(heading)) {
      return "COMPANY";
    }
    if (/\b(?:benefits|perks|what we offer|compensation)\b/.test(heading)) {
      return "BENEFITS";
    }
    return null;
  }

  private static roleWorkSpans(sourceText: string): Array<{ statement: string; sourceRegion: DocumentRegion }> {
    const spans: Array<{ statement: string; sourceRegion: DocumentRegion }> = [];
    let region: DocumentRegion = "SUMMARY";

    // Several portals flatten headings and numbered bullets into one text run.
    // Reintroduce only structural boundaries; content is never paraphrased.
    const headingPattern = /(?:role and responsibilities|roles?\s*&\s*responsibilities|key responsibilities|what you(?:'|’)?ll own|what you(?:'|’)?ll do|key deliverables|key accountabilities|(?:the )?mandate|requirements|qualifications|what you bring|what this role is not(?: for)?|ideal candidate|about (?:us|the company)|benefits|what we offer)/gi;
    const structuralText = sourceText
      .replace(/([.!?])(?=[A-Z])/g, "$1 ")
      .replace(/(?<=[a-zA-Z])(?=\d{1,2}[.)]\s*)/g, "\n")
      .replace(/(?<=\.)(?=\d{1,2}[.)]\s*)/g, "\n")
      .replace(new RegExp(`(^|[.!?]\\s*|\\n\\s*)(${headingPattern.source})\\s*:?[\\s\\d.]*`, "gim"), (_match, prefix: string, heading: string) => `${prefix}\n${heading.trim()}\n`)
      .replace(/(?<!^)\s+(?=\d{1,2}[.)]\s+)/gm, "\n");

    for (const line of structuralText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const headingRegion = this.sourceRegionForHeading(trimmed);
      if (headingRegion) {
        region = headingRegion;
        continue;
      }

      for (const part of trimmed.split(/(?:[•●▪]\s*)|(?<=[.!?])\s+/)) {
        const statement = this.normalizeSourceAtom(part.replace(/^(?:[-–—]|\d{1,2}[.)])\s*/, ""));
        if (statement) spans.push({ statement, sourceRegion: region });
      }
    }

    return spans;
  }

  private static isMetaAtom(statement: string): boolean {
    const normalized = this.normalizeSourceAtom(statement);
    return !normalized
      || /^(?:why |about |what makes |what deliverables|role overview|job summary|key competencies|how you(?:'|’)ll make an impact|what success looks like|show more show less)\b/i.test(normalized)
      || /^(?:responsibilities|job duties|deliverables|how you will make an impact)(?:[A-Z]|\b)/i.test(normalized)
      || /\b(?:role responsibilities|responsibilities(?:how|what|[A-Z]))\b/i.test(normalized)
      || (/^[^.!?]{1,100}:$/.test(normalized) && normalized.split(/\s+/).length <= 12);
  }

  private static isFlattenedSubheadingBlob(statement: string): boolean {
    // A run of title-cased words immediately followed by a work verb is a
    // flattened subheading plus content (for example, "Channel Partnership
    // Partner with..."). It has lost a source boundary, so fail closed.
    return /^(?:(?:[A-Z][^\s]*|&)\s+){2,8}(?:Partner|Provide|Own|Lead|Manage|Drive|Build|Develop|Execute|Deliver|Monitor|Track|Coordinate)\b/.test(statement);
  }

  private static isQualificationSource(statement: string, sourceRegion: DocumentRegion): boolean {
    if (sourceRegion === "REQUIREMENTS") return true;
    return /\b(?:must have|required|preferred|minimum qualification|years? of experience|bachelor(?:'s)?|master(?:'s)?|degree|strong (?:experience|understanding|knowledge)|experience (?:in|with|of)|knowledge of|familiarity with|skills? in|you (?:have|bring|possess)|ideal candidate|ability to|written and verbal communication|portfolio)\b/i.test(statement)
      || /^(?:demonstrated|proven|excellent|strong|exceptional|outstanding|solid|deep|extensive|relevant)\s+(?:experience|track record|communication|interpersonal|problem[- ]solving|analytical|leadership|ability|skills?|knowledge|understanding|expertise)\b/i.test(statement)
      || /^(?:demonstrated|proven|excellent|strong|exceptional|outstanding|solid|deep|extensive|relevant)\b[^.!?]{0,80}\b(?:experience|track record|communication|interpersonal|problem[- ]solving|analytical|leadership|ability|skills?|knowledge|understanding|expertise)\b/i.test(statement)
      || /^(?:experience|background|track record)\s+(?:in|leading|with)\b/i.test(statement)
      || /^(?:this role is ideal for|we are looking for|the ideal candidate|you are)\b/i.test(statement);
  }

  private static isCorporateSource(statement: string, sourceRegion: DocumentRegion): boolean {
    if (sourceRegion === "COMPANY" || sourceRegion === "BENEFITS") return true;
    return /^(?:about\s+(?:us|the company)|we are|our (?:company|business|mission|purpose)|founded in|we believe|our values)\b/i.test(statement)
      || /^(?:pay|salary|compensation|work location|job type|employment type|benefits?)\b/i.test(statement)
      || /^(?:backed|funded)\s+by\b/i.test(statement)
      || /^(?:our (?:marquee|active|company|business|pipeline|portfolio)|[A-Z][A-Za-z0-9&\s]+ is now (?:a|an)\b)/.test(statement)
      || /\b(?:is (?:a|an|the) [^.]{0,160}\b(?:company|network|platform|provider|agency|group))\b/i.test(statement)
      // Employer-branding and cultural statements often use role-like verbs,
      // but do not describe work assigned to the vacancy.
      || /\b(?:core values|our values|life at |meaningful work|employee growth|do their best work|grow both personally|bring your best self|teamwork matters|equal (?:employment )?opportunity|equal opportunity employer|diversity,? equity|inclusive workplace)\b/i.test(statement)
      || /^(?:why\s+\S+|an?\s+(?:exciting|unique) opportunity|the role offers)\b/i.test(statement);
  }

  private static hasRoleAssignment(statement: string, sourceRegion: DocumentRegion): boolean {
    if (sourceRegion === "RESPONSIBILITIES") {
      // A structural region supplies the discourse role, while a bounded
      // grammatical assignment opener distinguishes an assigned action from
      // the remaining descriptive/meta fragments in flattened portal text.
      // This is deliberately a compact, role-agnostic grammar rather than a
      // domain vocabulary or a corpus-specific phrase list.
      return /^(?:own|lead|manage|deliver|drive|build|develop|execute|achieve|monitor|track|analy[sz]e|improve|reduce|increase|establish|oversee|coordinate|negotiate|plan|design|create|hire|coach|direct|conduct|maintain|ensure|identify|collaborate|guide|use|provide|review|allocate|launch|close|pitch|partner)\b/i.test(statement)
        || /^(?:be )?(?:responsible|accountable)\s+for\b/i.test(statement)
        || /^(?:you|this (?:person|position)|the role|this role)(?:'ll| will)\b/i.test(statement);
    }
    return /\b(?:you(?:'ll| will)|this (?:person|position) will|(?:the|this) role\s+(?:will|exists to|(?:is )?(?:responsible|accountable)\b|owns?\b|leads?\b|manages?\b|translates?\b|orchestrates?\b|ensures?\b)|responsible for|responsibilities include|accountable(?: for)?|will own|will lead|will manage|reports? to|reporting to|partner with|work closely with)\b/i.test(statement);
  }

  private static isExplicitOutcomeStatement(statement: string): boolean {
    // A duty mentioning revenue, metrics, or improvement remains a
    // responsibility. An outcome must state a required result directly.
    return /^(?:achieve|deliver|reduce|increase|grow)\b[\s\S]*\b(?:target|targets|by|to|within|below|above|margin|revenue|retention|conversion|profitability|budget|kpi|metric|objective|outcome)s?\b/i.test(statement)
      || /^(?:maintain|ensure)\b[\s\S]*\b(?:within|below|above|target|targets|approved budget|agreed (?:threshold|margin|target))\b/i.test(statement);
  }

  private static roleWorkKind(statement: string, sourceRegion: DocumentRegion): "RESPONSIBILITY" | "OUTCOME" | "ROLE_CONTEXT" | null {
    if (sourceRegion === "TITLE" || sourceRegion === "BENEFITS" || sourceRegion === "COMPANY") return null;
    if (/\b(?:role and responsibilities|key responsibilities|what you(?:'|’)?ll own|the mandate|what this role is not|show more show less)\b/i.test(statement)) return null;
    if (/\b(?:reports? to|reporting to|base location|work location|team size)\b/i.test(statement)) {
      return "ROLE_CONTEXT";
    }
    if (/\b(?:working style|days? (?:a week )?out of the office|working from home)\b/i.test(statement)) {
      return null;
    }
    if (!this.hasRoleAssignment(statement, sourceRegion)) return null;
    return this.isExplicitOutcomeStatement(statement)
      ? "OUTCOME"
      : "RESPONSIBILITY";
  }

  private static stableRoleWorkId(opportunityVersion: string, statement: string, ordinal: number): string {
    const input = JSON.stringify({
      version: this.ROLE_WORK_EVIDENCE_VERSION,
      opportunityVersion,
      statement: statement.toLowerCase(),
      ordinal,
    });
    return `rolework_${createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32)}`;
  }

  private static capabilityKeysForRoleWork(
    statement: string,
    capabilities: readonly ProjectedCapability[],
  ): string[] {
    const normalizedStatement = this.normalizeSourceAtom(statement).toLowerCase();
    const keys: string[] = [];
    for (const capability of capabilities) {
      if (capability.source !== "explicit") continue;
      const label = this.normalizeSourceAtom(capability.canonicalConcept || capability.name);
      if (!label) continue;
      const normalizedLabel = label.toLowerCase();
      const tokens = normalizedLabel.split(/[^a-z0-9+#]+/).filter((token) => token.length >= 4);
      const exactPhrase = normalizedLabel.length >= 6 && normalizedStatement.includes(normalizedLabel);
      const sharedTokens = tokens.filter((token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(normalizedStatement));
      if (exactPhrase || sharedTokens.length >= 2) keys.push(label);
    }
    return Array.from(new Set(keys));
  }

  /**
   * Retains bounded employer role work from the authoritative source pass.
   * This method deliberately does not create qualifications from duties or
   * recover corporate copy. It is presentation evidence only.
   */
  private static extractRoleWorkEvidence(
    sourceText: string,
    opportunityVersion: string,
    capabilities: readonly ProjectedCapability[],
  ): RoleWorkExtraction {
    const occurrences = new Map<string, number>();
    const evidence: ProjectedRoleWorkEvidence[] = [];
    const rejected: Record<RoleWorkRejectionReason, number> = {
      empty: 0,
      oversized: 0,
      malformed: 0,
      mixed_or_meta: 0,
      qualification: 0,
      corporate_or_workplace: 0,
      not_assigned_work: 0,
    };

    for (const span of this.roleWorkSpans(sourceText)) {
      const statement = this.normalizeSourceAtom(span.statement);
      if (!statement) {
        rejected.empty++;
        continue;
      }

      // The ordinal identifies this exact normalized atom's occurrence in the
      // canonical source stream, not its rank among admitted work evidence.
      // Interpretation changes must therefore never renumber later atoms.
      const occurrenceKey = statement.toLowerCase();
      const ordinal = (occurrences.get(occurrenceKey) || 0) + 1;
      occurrences.set(occurrenceKey, ordinal);

      if (statement.length > 420) {
        rejected.oversized++;
        continue;
      }
      if (!/^[A-Z0-9“"']/.test(statement)) {
        rejected.malformed++;
        continue;
      }
      // Reject known boundary corruption (for example, "InventoryOwn") rather
      // than publishing a composite span whose source structure was lost.
      if (
        this.isMetaAtom(statement)
        || this.isFlattenedSubheadingBlob(statement)
        // A long, punctuation-free summary is a flattened mixed blob, not an
        // independently understandable employer fact. Do not invent internal
        // boundaries here; a later canonical source extractor can recover it.
        || (span.sourceRegion === "SUMMARY" && statement.length > 280 && !/[.!?;]/.test(statement))
        || /[a-z](?:Own|Lead|Manage|Drive|Build|Develop|Execute|Achieve|Monitor|Identify|Design|Set|Hire|Recruit|Close|Pitch|Use|Plan|Coordinate|Guide|Collaborate|Maintain|Provide|Review|Allocate|Launch)\b/.test(statement)
      ) {
        rejected.mixed_or_meta++;
        continue;
      }
      if (this.isQualificationSource(statement, span.sourceRegion)) {
        rejected.qualification++;
        continue;
      }
      if (this.isCorporateSource(statement, span.sourceRegion)) {
        rejected.corporate_or_workplace++;
        continue;
      }
      const kind = this.roleWorkKind(statement, span.sourceRegion);
      if (!kind) {
        rejected.not_assigned_work++;
        continue;
      }

      evidence.push({
        id: this.stableRoleWorkId(opportunityVersion, statement, ordinal),
        kind,
        statement,
        sourceQuote: statement,
        sourceRegion: span.sourceRegion,
        ordinal,
        capabilityKeys: this.capabilityKeysForRoleWork(statement, capabilities),
        confidence: span.sourceRegion === "RESPONSIBILITIES"
          ? 0.95
          : kind === "ROLE_CONTEXT"
            ? 0.9
            : 0.8,
      });
    }

    const unique = new Map<string, ProjectedRoleWorkEvidence>();
    for (const atom of evidence) {
      if (!unique.has(atom.id)) unique.set(atom.id, atom);
    }
    return {
      evidence: Array.from(unique.values()),
      rejected,
    };
  }

  /**
   * Read-only extraction diagnostics for provenance review. This is not part
   * of JobProjection and is intentionally unavailable to evaluation engines.
   */
  public static inspectRoleWorkEvidence(opportunity: any): RoleWorkExtraction {
    const projection = this.build(opportunity);
    const sourceText = opportunity.description || opportunity.normalizedText || opportunity.rawText || opportunity.rawDescription || "";
    const sourceVersion = String(
      opportunity.opportunityVersion
      || opportunity.opportunityVersionId
      || opportunity.versionId
      || opportunity.contentHash
      || opportunity.id
      || opportunity.jobHash
      || "unknown-opportunity-version",
    );
    return this.extractRoleWorkEvidence(
      String(sourceText),
      sourceVersion,
      projection.capabilities,
    );
  }

  private static assignCapabilityTier(capName: string): CapabilityTaxonomyTier {
    const nameLower = capName.toLowerCase();
    const techKeywords = ["salesforce", "ga4", "cdp", "adobe", "sap", "braze", "segment", "mixpanel", "appsflyer", "adjust", "snowflake", "redshift", "databricks", "hubspot", "klaviyo", "shopify"];
    if (techKeywords.some(t => nameLower.includes(t))) {
      return "TECHNOLOGY_STACK";
    }
    const domainKeywords = ["b2b", "d2c", "retail", "beauty", "fintech", "5g", "broadband", "mobility", "automotive", "fmcg", "distressed debt", "arc operations", "insolvency", "asset reconstruction"];
    if (domainKeywords.some(d => nameLower.includes(d))) {
      return "DOMAIN_FAMILIARITY";
    }
    const coreKeywords = ["growth", "leadership", "transformation", "p&l", "cgo", "cmo", "head", "mandate", "commercial leadership"];
    if (coreKeywords.some(c => nameLower.includes(c))) {
      return "CORE_MANDATE";
    }
    return "EXECUTION_CAPABILITY";
  }

  /**
   * Requirements belong to the qualification side of a JD, not its execution
   * responsibilities. A responsibility-only mention must never create a
   * decision ceiling.
   */
  private static extractCapabilityRequirements(
    sourceText: string,
    capabilities: readonly ProjectedCapability[],
  ): CapabilityRequirement[] {
    const requirementMarker = /\b(?:must have|required|strong\s+(?:hands[-\s]?on\s+)?(?:experience|understanding|expertise)|demonstrated experience|proven (?:experience|track record)|deep expertise)\b/i;
    const ignoredTokens = new Set(["operations", "management", "capability", "leadership", "commercial", "business"]);
    const clauses = sourceText
      .split(/(?<=[.!?])|[\r\n]+/)
      .map((clause) => clause.trim())
      .filter(Boolean);

    const stableEvidenceId = (capability: string, quote: string) => {
      const input = `${capability}|${quote}`.toLowerCase();
      let hash = 2166136261;
      for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
      return `capreq_${(hash >>> 0).toString(16)}`;
    };

    return capabilities.flatMap((capability) => {
      const signals = capability.name
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter((token) => token.length >= 4 && !ignoredTokens.has(token));
      if (signals.length === 0) return [];

      const supportingClauses = clauses.filter((clause) =>
        requirementMarker.test(clause) && signals.some((signal) => new RegExp(`\\b${signal.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(clause)),
      );
      if (supportingClauses.length === 0) return [];

      return [{
        capability: capability.name,
        tier: capability.tier || this.assignCapabilityTier(capability.name),
        required: true,
        materiality: "CORE" as const,
        evidenceIds: supportingClauses.map((quote) => stableEvidenceId(capability.name, quote)),
        sourceQuotes: supportingClauses,
      }];
    });
  }

  public static build(opportunity: any): JobProjection {
    const cacheKey = opportunity?.jobHash || opportunity?.id;
    if (cacheKey && this.projectionCache.has(cacheKey)) {
      const cached = this.projectionCache.get(cacheKey)!;
      return { ...cached, originalOpportunity: opportunity };
    }

    const projection = this.buildUncached(opportunity);
    if (cacheKey) {
      this.projectionCache.set(cacheKey, projection);
    }
    return projection;
  }

  /**
   * Authoritative projection entry point for canonical acquisition. A failed,
   * redirected, binary, or genuinely sparse document cannot be silently
   * upgraded into a rich job projection.
   */
  public static buildFromValidatedDocument(document: ValidatedJobDocument): JobProjection {
    if (document.usabilityState !== "SUBSTANTIVE" || !document.extractedText) {
      throw new Error(`Cannot project non-substantive job document (${document.usabilityState}:${document.failureClass || "none"}).`);
    }
    const projection = this.buildUncached({
      jobHash: `${document.source}:${document.sourceJobId || document.canonicalUrl}`,
      role: document.title || "",
      company: document.company || "",
      location: document.location || "",
      rawDescription: document.extractedText,
    });
    const sourceText = `${document.title || ""}\n${document.extractedText}`;
    const dimensions = (projection.dimensions || []).map((dimension) => {
      const value = dimension.jdEvidence.value;
      const supported = Boolean(value && value !== "UNKNOWN" && new RegExp(`\\b${String(value).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(sourceText));
      return supported
        ? dimension
        : { ...dimension, jdEvidence: { status: "Missing" as const } };
    });
    return {
      ...projection,
      dimensions,
      projectionVersion: this.PROJECTION_VERSION,
      projectionFingerprint: this.fingerprint(document),
      originalOpportunity: { ...projection.originalOpportunity, validatedDocument: document },
    };
  }

  private static fingerprint(document: ValidatedJobDocument): string {
    const source = `${this.PROJECTION_VERSION}|${document.source}|${document.canonicalUrl}|${document.extractedText || ""}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `jp_${(hash >>> 0).toString(16)}`;
  }

  private static buildUncached(opportunity: any): JobProjection {
    this.actualBuildCount++;
    const title = opportunity.role || opportunity.canonicalTitle || opportunity.title || "";
    const sourceText = opportunity.description || opportunity.normalizedText || opportunity.rawText || opportunity.rawDescription || "";
    let fullText = String(sourceText).toLowerCase();
    const fullContext = (title + "\n" + fullText);
    const titleLower = title.toLowerCase();

    const resolvedCompany = this.resolveEmployerName(opportunity.company || "", fullText);
    const trueExecutiveMandate = this.inferTrueExecutiveMandate(fullText, title);
    const organizationalIntent = this.inferOrganizationalIntent(fullText, title);
    const executiveMission = this.buildExecutiveMission(title, resolvedCompany, trueExecutiveMandate, organizationalIntent, String(sourceText));

    // 1. Executive Identity Classification (Positive Domain Validation)
    const isExecutiveTechLeader = /(head of|director|vp|vice president|cto|cio|chief)/i.test(titleLower);

    const isTitleTechIC = (!isExecutiveTechLeader && /(\bengineer\b|\bdeveloper\b|\bprogrammer\b|\bfull stack\b|\bfrontend\b|\bbackend\b|\bcoding\b|\barchitect\b)/i.test(titleLower)) ||
                          /(\bjava\b|\bpython\b|\bnode\.?js\b|\breact\b|\bangular\b|\bc\+\+\b|\bgolang\b|\bruby\b|\bdevops\b|\bcloud engineer\b|\bdata engineer\b|\bmachine learning engineer\b|\bai engineer\b|\bsoftware\b)/i.test(titleLower);

    const isTitleTechLeadership = isExecutiveTechLeader && /(\btechnology\b|\binformation technology\b|\bit\b|\bcio\b|\bcto\b|\bengineering\b|\bsoftware\b|\bdata\b|\bdigital\b|\bai\b)/i.test(titleLower);

    const isTitleOps = /(\boperations\b|\bcoo\b|\bchief operating\b|\bhead of operations\b|\bvp operations\b|\bdelivery\b|\bsupply chain\b|\blogistics\b)/i.test(titleLower);

    // Negative Domain Exclusions (Explicit Vetoes)
    const hasMedicalAffairsVeto = /\bmedical affairs\b/i.test(titleLower) && !/commercial|marketing/i.test(titleLower);
    const hasClinicalVeto = /\bclinical\b/i.test(titleLower);
    const hasBimVeto = /\bbim\b/i.test(titleLower);
    const hasCivilStructuralVeto = /(\bcivil\b|\bstructural\b)/i.test(titleLower);
    const hasQualityVeto = /(\bquality assurance\b|\bqa lead\b|\bquality manager\b|\bqc\b|\btesting\b)/i.test(titleLower) && !/revenue|marketing|growth/i.test(titleLower);
    const hasRecruitmentStaffingVeto = /(\btalent acquisition\b|\brecruitment\b|\bstaffing\b|\bhuman resources\b|\bhr\b)/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);
    const hasSoftwareVeto = /(\bsoftware engineering\b|\bsde\b|\bfrontend\b|\bbackend\b|\bembedded\b)/i.test(titleLower) && !/head of|vp|director/i.test(titleLower);
    const hasIndustrialResinVeto = /(\bresin\b|\bpolymers\b|\bchemical manufacturing\b)/i.test(titleLower);
    const hasTelecomEngVeto = /(\brf engineer\b|\bran engineer\b|\b5g engineer\b|\btelecom field\b)/i.test(titleLower);
    const hasHeavyElectronicsVeto = /(\bpcb\b|\bsemiconductor fab\b|\bvlsi\b|\bhardware test\b)/i.test(titleLower);
    const hasDerivedDataVeto = /\bderived data\b/i.test(titleLower);
    const hasDeliveryLeaderVeto = /\bdelivery (leader|lead)\b/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);
    const hasItcVeto = /\bitc\b/i.test(titleLower) && !/marketing|growth/i.test(titleLower);
    const hasPracticeLeadVeto = /\bpractice (lead|director|head)\b/i.test(titleLower) && !/marketing|growth/i.test(titleLower);
    const hasArchitectureVeto = /\barchitecture\b/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);

    const isNonCommercialDomain = 
      isTitleTechIC ||
      hasMedicalAffairsVeto ||
      hasClinicalVeto ||
      hasBimVeto ||
      hasCivilStructuralVeto ||
      hasQualityVeto ||
      hasRecruitmentStaffingVeto ||
      hasSoftwareVeto ||
      hasIndustrialResinVeto ||
      hasTelecomEngVeto ||
      hasHeavyElectronicsVeto ||
      hasDerivedDataVeto ||
      hasDeliveryLeaderVeto ||
      hasItcVeto ||
      hasPracticeLeadVeto ||
      hasArchitectureVeto;

    // Positive commercial & growth identity recognition
    const isExplicitCommercialRole = /(\bmarketing\b|\bgrowth\b|\bcommercial\b|\brevenue\b|\bcmo\b|\bcgo\b|\bcro\b|\bgtm\b|\becommerce\b|\be-commerce\b|\bbrand\b|\bperformance\b|\bd2c\b|\bdigital marketing\b|\bmedia sales\b|\bclient partner\b|\bbusiness development\b|\bsales\b|\bp&l\b|\bcategory head\b|\bbusiness head\b|\bcountry head\b|\bcountry director\b|\bgeneral manager\b|\bchief executive\b|\bceo\b|\bchief operating\b|\bcoo\b|\bchief of staff\b|\bkey accounts\b|\baccount director\b|\bcustomer success\b|\bcustomer experience\b|\bmartech\b|\btrade marketing\b|\bmerchandising\b|\bpr\b|\bpublic relations\b|\bcommunications\b)/i.test(titleLower + " " + fullText.substring(0, 300));

    let primaryIdentity = "Excluded Technical & Industrial Professional Domain";
    let identityConf = 0.85;

    if (isTitleTechLeadership) {
      primaryIdentity = "Technology & Engineering Leadership";
      identityConf = 0.92;
    } else if (isTitleOps && !isExplicitCommercialRole) {
      primaryIdentity = "Operations & Logistics Leadership";
      identityConf = 0.88;
    } else if (isExplicitCommercialRole && !isNonCommercialDomain) {
      primaryIdentity = "Commercial & Marketing Leadership";
      identityConf = 0.90;
    } else {
      primaryIdentity = "Excluded Technical & Industrial Professional Domain";
      identityConf = 0.95;
    }

    const executiveIdentity: ExecutiveIdentity = {
      value: primaryIdentity,
      confidence: identityConf,
      evidence: [title]
    };

    // 2. Extract Capabilities
    const capabilitiesMap = new Map<string, any>();
    const dims = opportunity.dimensions || opportunity.metadata?.enrichment?.dimensions;
    if (dims && Array.isArray(dims)) {
      dims.forEach((dim: any) => {
        let capName = "";
        if (typeof dim === "string") {
          capName = dim.trim();
        } else if (dim.name) {
          capName = String(dim.name).trim();
        } else if (dim.jdEvidence && dim.jdEvidence.value) {
          capName = String(dim.jdEvidence.value).trim();
        }
        if (capName.startsWith("{") && capName.includes('"')) {
          try {
            const parsed = JSON.parse(capName);
            capName = String(parsed.value || parsed.canonicalValue || parsed.rawValue || capName).trim();
          } catch {}
        }
        if (capName.length > 2) {
          capabilitiesMap.set(capName.toLowerCase(), {
            name: capName,
            tier: this.assignCapabilityTier(capName),
            source: "explicit",
            confidence: 0.90
          });
        }
      });
    }

    const compositional = SemanticResolutionEngine.extractCompositional(fullContext);
    // Preserve explicit specialist operating domains. They remain a job-side
    // requirement; they do not imply that a generally strong executive has
    // demonstrated that specialist domain.
    const specialistDomains = [
      { name: "Distressed Debt / ARC Operations", pattern: /\b(?:distressed debt|non-performing assets?|\bnpa\b|asset reconstruction compan(?:y|ies)|\barc\b|sarfaesi|insolvency and bankruptcy code|\bibc\b)\b/i },
      { name: "Merchandising / Category Inventory Operations", pattern: /\b(?:merchandising|category management|inventory planning|product sourcing)\b/i },
    ];
    for (const domain of specialistDomains) {
      if (domain.pattern.test(fullContext)) {
        capabilitiesMap.set(domain.name.toLowerCase(), {
          name: domain.name,
          tier: "DOMAIN_FAMILIARITY",
          source: "explicit",
          confidence: 0.90,
        });
      }
    }
    if (capabilitiesMap.size === 0) {
      for (const evidence of compositional.evidenceList) {
        if (evidence.entityType !== "CAPABILITY" || evidence.negated || evidence.evidenceRelationship === "NON_SATISFYING") continue;
        capabilitiesMap.set(evidence.canonicalConcept, {
          name: evidence.canonicalConcept,
          canonicalConcept: evidence.canonicalConcept,
          source: evidence.evidenceRelationship === "DIRECT_EQUIVALENT" ? "explicit" : "inferred",
          state: evidence.evidenceRelationship === "DIRECT_EQUIVALENT" ? "EXPLICIT" : "INFERRED",
          evidenceRelationship: evidence.evidenceRelationship,
          sourceQuote: evidence.sourcePhrase,
          evidence: [evidence.sourcePhrase],
          confidence: evidence.confidence,
        });
      }
    }

    const capabilities = Array.from(capabilitiesMap.values());
    let capabilityExtractionStatus: "COMPLETE" | "PARTIAL" | "FAILED" = "COMPLETE";
    if (capabilities.length === 0) {
      capabilityExtractionStatus = "FAILED";
    }

    const executiveFunction = new Set<string>();
    const businessObjectives = new Set<string>();
    const executionStyle = new Set<string>();

    if (this.testKeyword(titleLower, "marketing") || this.testKeyword(titleLower, "sales") || this.testKeyword(titleLower, "commercial")) {
      executiveFunction.add("Commercial & Marketing");
    } else if (this.testKeyword(titleLower, "technology") || this.testKeyword(titleLower, "it") || this.testKeyword(titleLower, "architect") || isTitleTechLeadership || isTitleTechIC) {
      executiveFunction.add("Technology");
    } else if (this.testKeyword(titleLower, "operations") || this.testKeyword(titleLower, "delivery") || isTitleOps) {
      executiveFunction.add("Operations");
    }

    if (this.testKeyword(fullText, "growth") || this.testKeyword(fullText, "expansion") || this.testKeyword(fullText, "acquisition")) {
      businessObjectives.add("Growth");
    }
    if (this.testKeyword(fullText, "efficiency") || this.testKeyword(fullText, "optimization") || this.testKeyword(fullText, "margin")) {
      businessObjectives.add("Efficiency");
    }

    if (this.testKeyword(fullText, "transformation") || this.testKeyword(fullText, "change management") || this.testKeyword(fullText, "modernization")) {
      executionStyle.add("Transformation");
    } else {
      executionStyle.add("Delivery");
    }

    const operatingContext: OperatingContext = {
      pnlResponsibility: this.testKeyword(fullText, "p&l") || this.testKeyword(fullText, "profit and loss") || this.testKeyword(fullText, "profit & loss"),
      budgetOwnership: this.testKeyword(fullText, "budget"),
      vendorManagement: this.testKeyword(fullText, "vendor") || this.testKeyword(fullText, "vendors") || this.testKeyword(fullText, "agency"),
      complianceAudit: this.testKeyword(fullText, "compliance") || this.testKeyword(fullText, "sebi") || this.testKeyword(fullText, "audit"),
      directReports: this.testKeyword(fullText, "direct reports") || this.testKeyword(fullText, "manage a team") || this.testKeyword(fullText, "lead a team"),
      remote: this.testKeyword(fullText, "remote"),
      hybrid: this.testKeyword(fullText, "hybrid"),
      travel: this.testKeyword(fullText, "travel") || this.testKeyword(fullText, "willingness to travel")
    };

    let workModel: "HYBRID" | "REMOTE" | "ON_SITE" | "UNKNOWN" = "UNKNOWN";
    if (operatingContext.hybrid) workModel = "HYBRID";
    else if (operatingContext.remote) workModel = "REMOTE";
    else if (this.testKeyword(fullText, "on-site") || this.testKeyword(fullText, "onsite") || this.testKeyword(fullText, "office") || this.testKeyword(fullText, "on site")) {
      workModel = "ON_SITE";
    }

    const workModelDim = opportunity.dimensions?.find((d: any) => d.key === "workModel");
    if (workModelDim && workModelDim.jdEvidence?.value) {
      const val = String(workModelDim.jdEvidence.value).toUpperCase();
      if (val.includes("HYBRID")) workModel = "HYBRID";
      else if (val.includes("REMOTE")) workModel = "REMOTE";
      else if (val.includes("ON-SITE") || val.includes("ON_SITE") || val.includes("OFFICE") || val.includes("ON SITE")) workModel = "ON_SITE";
    }

    const operatingLevel = OperatingLevelClassifier.classify(fullContext, title);
    const workNature = WorkNatureClassifier.classify(fullContext, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(fullContext, title);
    const commercialScope = CommercialScopeClassifier.classify(fullContext, title);

    capabilities.forEach((c) => {
      c.tier = this.assignCapabilityTier(c.name);
    });
    const capabilityRequirements = this.extractCapabilityRequirements(String(sourceText), capabilities);
    const sourceVersion = String(
      opportunity.opportunityVersion
      || opportunity.opportunityVersionId
      || opportunity.versionId
      || opportunity.contentHash
      || opportunity.id
      || opportunity.jobHash
      || "unknown-opportunity-version",
    );
    const roleWorkExtraction = this.extractRoleWorkEvidence(
      String(sourceText),
      sourceVersion,
      capabilities,
    );
    const roleWorkEvidence = roleWorkExtraction.evidence;

    // Phase 5C.2: Canonical Semantic Evidence Extraction
    const semanticEvidence: CanonicalSemanticEvidence[] = [...compositional.evidenceList];
    for (const cap of capabilities) {
      const res = SemanticResolutionEngine.resolveCapability(cap.name, undefined, fullContext);
      if (res && !semanticEvidence.some(e => e.canonicalConcept === res.canonicalConcept && e.sourcePhrase === res.sourcePhrase)) {
        semanticEvidence.push(res);
      }
    }

    // Phase 5C.3: Synthesize Grounded Dimensions for downstream EvidenceRichness & Policy evaluation
    const dimensions = buildGroundedDimensions(
      title,
      opportunity.location || "",
      operatingLevel.value,
      trueExecutiveMandate,
      commercialScope.value,
      decisionAuthority.value,
      workModel,
      executiveIdentity.value,
      opportunity.dimensions
    );

    return {
      jobHash: opportunity.jobHash || "",
      role: title,
      company: resolvedCompany,
      executiveIdentity,
      trueExecutiveMandate,
      executiveMission,
      operatingLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      capabilities,
      capabilityRequirements,
      executiveFunction: Array.from(executiveFunction),
      businessObjectives: Array.from(businessObjectives),
      executionStyle: Array.from(executionStyle),
      operatingContext,
      location: opportunity.location || "",
      workModel,
      capabilityExtractionStatus,
      dimensions,
      originalOpportunity: { ...opportunity, dimensions },
      semanticEvidence,
      roleWorkEvidence,
      roleWorkEvidenceVersion: this.ROLE_WORK_EVIDENCE_VERSION,
      projectionVersion: this.PROJECTION_VERSION,
      projectionFingerprint: this.fingerprint({
        source: String(opportunity.source || "legacy"), canonicalUrl: String(opportunity.url || opportunity.jobHash || ""), finalUrl: String(opportunity.url || opportunity.jobHash || ""),
        contentType: null, transportState: "SUCCEEDED", extractionState: "EXTRACTED", usabilityState: "SUBSTANTIVE",
        acquisitionQuality: "COMPLETE", title, company: resolvedCompany, location: opportunity.location || null,
        titleAgreement: "UNKNOWN", companyAgreement: "UNKNOWN", substantiveWordCount: fullText.split(/\s+/).filter(Boolean).length,
        substantiveCharacterCount: fullText.length, boilerplateRatio: 0, scriptRatio: 0, failureClass: null,
        retryable: false, extractedText: fullText, provenance: "BLOB"
      })
    };
  }
}

/**
 * Authoritative factory for grounded structural opportunity dimensions.
 * Guarantees compile-time type agreement between JobProjection and DecisionPolicyEngine.
 */
export function buildGroundedDimensions(
  title: string,
  location: string,
  operatingLevel: string,
  trueExecutiveMandate: string,
  commercialScope: string,
  decisionAuthority: string,
  workModel: string,
  executiveIdentityValue: string,
  existingDimensions?: readonly GroundedOpportunityDimension[]
): GroundedOpportunityDimension[] {
  if (Array.isArray(existingDimensions) && existingDimensions.length > 0) {
    return [...existingDimensions];
  }
  return [
    { key: "operatingLevel", label: "Operating Level", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: operatingLevel, evidence: [{ quote: title, provenance: "extractor" }] } },
    { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: trueExecutiveMandate, evidence: [{ quote: title, provenance: "extractor" }] } },
    { key: "commercialScope", label: "Commercial Scope", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: commercialScope, evidence: [{ quote: title, provenance: "extractor" }] } },
    { key: "decisionAuthority", label: "Decision Authority", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: decisionAuthority, evidence: [{ quote: title, provenance: "extractor" }] } },
    { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched", jdEvidence: { status: "Explicit", value: workModel, evidence: [{ quote: location || workModel, provenance: "extractor" }] } },
    { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched", jdEvidence: { status: "Explicit", value: executiveIdentityValue, evidence: [{ quote: title, provenance: "extractor" }] } },
  ];
}
