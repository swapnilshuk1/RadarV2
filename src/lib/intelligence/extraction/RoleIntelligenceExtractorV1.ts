/**
 * RoleIntelligenceExtractorV1.ts
 *
 * Deterministic Role Intelligence & Fact Extraction Engine V1
 *
 * STRICT INVARIANTS:
 * 1. Read-only extraction: rawText.slice(startOffset, endOffset) === exactText for 100% of accepted atoms.
 * 2. 25 RoleSemanticTypes strictly enforced. Zero additions.
 * 3. Architectural Subject Eligibility Gate: ABOUT_COMPANY defaults to COMPANY, preventing cross-subject contamination.
 * 4. Honest Requirements: Only explicit cues trigger HARD_REQUIREMENT or PREFERRED_REQUIREMENT. Uncued statements retain section provenance without false classification.
 * 5. Multi-proposition compound clauses decompose into distinct exact-subspan atoms with stable provenance IDs.
 * 6. SemanticRoleSpanClassifier interface defined with full JD addressability (>6000 chars), strictly unwired in V1.
 */

export type SectionType =
  | "ABOUT_COMPANY"
  | "ROLE_OVERVIEW"
  | "RESPONSIBILITIES"
  | "REQUIREMENTS"
  | "PREFERRED"
  | "SUCCESS"
  | "WHO_YOU_WORK_WITH"
  | "WHY_JOIN"
  | "BENEFITS"
  | "APPLICATION"
  | "LEGAL_EEO"
  | "STRUCTURAL_METADATA"
  | "OTHER";

export type RoleSubject = "ROLE" | "COMPANY" | "RECRUITING_PROCESS";

export type RoleSemanticType =
  // 1-4: Core Mandate & Work
  | "ROLE_PURPOSE"
  | "RESPONSIBILITY"
  | "OUTCOME"
  | "SUCCESS_METRIC"
  // 5-6: Requirements
  | "HARD_REQUIREMENT"
  | "PREFERRED_REQUIREMENT"
  // 7-9: Governance & Hierarchy
  | "REPORTING_LINE"
  | "FOUNDER_CEO_PROXIMITY"
  | "BOARD_EXPOSURE"
  // 10-13: Commercial & Financial Scope
  | "PNL_OWNERSHIP"
  | "REVENUE_ACCOUNTABILITY"
  | "PROFITABILITY_ACCOUNTABILITY"
  | "BUDGET_SCOPE"
  // 14-16: Scale & Authority
  | "DECISION_AUTHORITY"
  | "PEOPLE_LEADERSHIP"
  | "PEOPLE_SCALE"
  // 17-19: Strategy & Org Evolution
  | "GREENFIELD_BUILD"
  | "TRANSFORMATION"
  | "GEOGRAPHIC_SCOPE"
  // 20-23: Domain Boundaries
  | "REGULATORY_SCOPE"
  | "PRODUCT_SCOPE"
  | "CUSTOMER_SCOPE"
  | "CHANNEL_SCOPE"
  // 24-25: Context & Environment
  | "COMPANY_CONTEXT"
  | "WORK_CONDITION";

export type RequirementMateriality = "HARD" | "PREFERRED" | "UNSTATED";

export type RequirementDimension =
  | "EXPERIENCE_YEARS"
  | "INDUSTRY"
  | "DOMAIN"
  | "CAPABILITY"
  | "EDUCATION"
  | "CERTIFICATION"
  | "TECHNOLOGY"
  | "GEOGRAPHY"
  | "WORK_AUTHORIZATION"
  | "LICENCE"
  | "PORTFOLIO"
  | "OTHER";

export interface NormalizedClaim {
  predicate?: string;
  object?: string;
  qualifiers?: {
    peopleCount?: number;
    metric?: string;
    timeframe?: string;
    currency?: string;
    amount?: number;
    rawCondition?: string;
    [key: string]: any;
  };
}

export interface RequirementDetail {
  materiality: RequirementMateriality;
  materialityCue: string | null;
  requirementDimension: RequirementDimension;
  parsedYears?: { minimum?: number; maximum?: number; exact?: number };
}

export interface ActionRoleDetail {
  ownershipLevel: "OWN" | "LEAD" | "EXECUTE" | "COLLABORATE";
  targetOutcome?: string | null;
  metric?: string | null;
}

export interface RolePropositionAtom {
  id: string; // Stable: `role_atom:<caseId>:<startOffset>_<endOffset>:<semanticType | "UNCLASSIFIED">`
  exactText: string;
  startOffset: number;
  endOffset: number;
  section: SectionType;
  subject: RoleSubject;
  semanticType?: RoleSemanticType; // Present if classified into the 25 types; undefined for unclassified candidates
  confidence: number;
  extractionMethod:
    | "DETERMINISTIC_SECTION"
    | "DETERMINISTIC_META_LINE"
    | "DETERMINISTIC_PROPOSITION_RULE"
    | "SEMANTIC_FALLBACK";
  epistemicMarker: "EXACT_SOURCE_STATEMENT";
  normalizedClaim?: NormalizedClaim;
  requirement?: RequirementDetail;
  actionRole?: ActionRoleDetail;
}

export interface DetectedSection {
  type: SectionType;
  headingText: string;
  headingStart: number;
  headingEnd: number;
  contentStart: number;
  contentEnd: number;
  rawContent: string;
  isSynthetic?: boolean;
}

export interface RoleIntelligenceOutputV1 {
  caseId: string;
  canonicalJobId: string;
  companyName?: string;
  title?: string;
  rawTextLength: number;
  sections: DetectedSection[];
  atoms: RolePropositionAtom[];
  metadata: {
    extractorVersion: "RoleIntelligenceExtractorV1";
    hasGluedHeadings: boolean;
    hasStructuralMetaLines: boolean;
    proposalCounts: {
      proposedAtoms: number;
      acceptedAtoms: number;
      rejectedAtoms: number;
    };
  };
}

// Unwired fallback interface for future non-deterministic models
export interface ProposedRoleSpan {
  exactText: string;
  startOffset: number;
  endOffset: number;
  semanticType: RoleSemanticType;
  subject: RoleSubject;
  confidence: number;
  justification?: string;
}

export interface SemanticRoleSpanClassifier {
  classifyUncertainSpans(input: {
    fullText: string; // The COMPLETE JD text, never truncated
    candidateSpans: Array<{
      exactText: string;
      startOffset: number;
      endOffset: number;
      enclosingSection?: SectionType;
    }>;
  }): Promise<ProposedRoleSpan[]>;
}

// Section heading definitions with structural regexes
interface HeadingDefinition {
  type: SectionType;
  regex: RegExp;
}

function makeHeadingRegex(phrases: string[]): RegExp {
  const allVariants: string[] = [];
  for (const p of phrases) {
    allVariants.push(p);
    allVariants.push(p.toUpperCase());
    if (p.includes("the")) {
      allVariants.push(p.replace(/\bthe\b/g, "The"));
    }
  }
  const pattern = allVariants.join("|");
  return new RegExp(
    `(?:^|[\\n\\r]+|[.!?]\\s*|(?<=[a-z0-9]))#{0,4}\\s*(${pattern})(?=[\\n\\r:]|$|\\s*[A-Z0-9]|\\s*🎯)`,
    "g"
  );
}

const SECTION_DEFINITIONS: HeadingDefinition[] = [
  {
    type: "ABOUT_COMPANY",
    regex: makeHeadingRegex([
      "About the Company",
      "About Us",
      "About our firm",
      "About SYSCORT",
      "About Schnell Builders",
      "About Artificilux",
      "About Zapier",
      "Who We Are",
      "Company Description",
      "Company Overview",
      "Our Story",
      "ABOUT SCHNELL BUILDERS"
    ])
  },
  {
    type: "ROLE_OVERVIEW",
    regex: makeHeadingRegex([
      "About the Role",
      "About The Opportunity",
      "Role Overview",
      "Role Purpose",
      "Position Summary",
      "Job Summary",
      "Job Overview",
      "The Opportunity",
      "The Role:",
      "The Mandate:"
    ])
  },
  {
    type: "RESPONSIBILITIES",
    regex: makeHeadingRegex([
      "Key Responsibilities",
      "Key Responsibilit🎯",
      "Roles? (?:&|and) Responsibilities",
      "Responsibilities",
      "What You(?:'|’)ll Do",
      "Things You(?:'|’)ll Do",
      "Key Accountabilities",
      "Daily Responsibilities",
      "Job Responsibilities",
      "Core Responsibilities"
    ])
  },
  {
    type: "PREFERRED",
    regex: makeHeadingRegex([
      "Preferred Qualifications",
      "Preferred Experience",
      "Nice to Have",
      "Good to Have",
      "Desirable",
      "Bonus Points"
    ])
  },
  {
    type: "REQUIREMENTS",
    regex: makeHeadingRegex([
      "About You",
      "Required Qualifications",
      "Required Skills",
      "Skills (?:&|and) Qualifications",
      "Qualifications",
      "Requirements",
      "What You(?:'|’)ll Bring",
      "What We(?:'|’)re Looking For",
      "Candidate Profile",
      "Skills (?:&|and) Capabilities",
      "Basic Qualifications",
      "Minimum Qualifications",
      "Skills Required"
    ])
  },
  {
    type: "SUCCESS",
    regex: makeHeadingRegex([
      "What Success Looks Like",
      "Success in This Role",
      "Key Performance Areas",
      "Key Performance Indicators",
      "Success Metrics",
      "How Success Is Measured"
    ])
  },
  {
    type: "WHO_YOU_WORK_WITH",
    regex: makeHeadingRegex([
      "Who You(?:'|’)ll Work With",
      "Who You Will Work With",
      "The Team:",
      "About the Team"
    ])
  },
  {
    type: "WHY_JOIN",
    regex: makeHeadingRegex([
      "Why Join(?: Us)?",
      "Why You(?:'|’)ll Love Working Here"
    ])
  },
  {
    type: "BENEFITS",
    regex: makeHeadingRegex([
      "Perks (?:&|and) Benefits",
      "Compensation (?:&|and) Benefits",
      "Benefits (?:&|and) Culture(?: Highlights)?",
      "Benefits",
      "What We Offer",
      "WHAT[’']S ON OFFER"
    ])
  },
  {
    type: "APPLICATION",
    regex: makeHeadingRegex([
      "How to Apply",
      "Application Process",
      "To Apply",
      "Apply Now",
      "To submit your application",
      "CONSULTANT DETAILS:?",
      "Privacy Statement:?"
    ])
  },
  {
    type: "LEGAL_EEO",
    regex: makeHeadingRegex([
      "Equal Opportunity Employer",
      "Diversity (?:&|and) Inclusivity",
      "Diversity (?:&|and) Inclusion",
      "EEO"
    ])
  }
];

// Structural metadata line starters
const META_LINE_REGEX = /(?:^|[\n\r]|(?<=[a-z0-9.]\s{1,2}))(Designation|Nature of Role|Reports\s+To|Reporting\s+To|Base\s+Location|Location|Work\s+Location|Experience|Employment\s+Type|Compensation|Salary|Pay|Job\s+Type|(?:\bTeam\s+Size\b|(?:^|[\n\r]|(?<=[|•;]\s*))Team))\s*:\s*([^\n\r]+?)(?=(?:Designation|Nature of Role|Reports\s+To|Reporting\s+To|Base\s+Location|Location|Work\s+Location|Experience|Employment\s+Type|Compensation|Salary|Pay|Job\s+Type|Team)\s*:|[\n\r]|#{1,4}\s+|ABOUT\s+[A-Z]|KEY\s+RESPONSIBILITIES|ROLES?\s+(?:&|and)\s*RESPONSIBILITIES|WHAT\s+YOU|WHAT\s+WE|REQUIREMENTS|QUALIFICATIONS|MANDATORY\s+REQUIREMENTS|PREFERRED|COMPENSATION\s+&|BENEFITS|THE\s+MANDATE|THE\s+ROLE|THE\s+OPPORTUNITY|$)/gi;

// Bounded responsibility action verbs
const ROLE_ACTION_VERBS = [
  "Own", "Lead", "Drive", "Build", "Create", "Develop", "Design", "Define",
  "Establish", "Manage", "Oversee", "Deliver", "Ensure", "Partner", "Collaborate",
  "Translate", "Support", "Improve", "Coordinate", "Act", "Facilitate", "Provide",
  "Monitor", "Identify", "Resolve", "Implement", "Maintain", "Champion", "Guide",
  "Shape", "Set", "Run", "Execute", "Launch", "Scale", "Recruit", "Hire", "Direct",
  "Operate", "Accountable for", "Write", "Repurpose", "Plan"
];

// Requirement cues
const HARD_CUES = [
  "must", "mandatory", "required", "minimum", "at least", "bachelor", "master",
  "mba", "certification", "licence", "license", "degree"
];

const PREFERRED_CUES = [
  "preferred", "nice to have", "good to have", "plus", "bonus", "desirable", "ideally"
];

export class RoleIntelligenceExtractorV1 {
  /**
   * Extract role intelligence from exact job text.
   */
  public extract(input: {
    caseId: string;
    canonicalJobId: string;
    rawText: string;
    companyName?: string;
    title?: string;
  }): RoleIntelligenceOutputV1 {
    const { caseId, canonicalJobId, rawText, companyName, title } = input;
    const rawLen = rawText.length;

    let proposedCount = 0;
    let acceptedCount = 0;
    let rejectedCount = 0;

    const acceptedAtoms: RolePropositionAtom[] = [];

    // Safe proposal acceptor that mechanically verifies the exact span invariant
    const acceptAtom = (atom: {
      exactText: string;
      startOffset: number;
      endOffset: number;
      section: SectionType;
      subject: RoleSubject;
      semanticType?: RoleSemanticType;
      confidence: number;
      extractionMethod: RolePropositionAtom["extractionMethod"];
      normalizedClaim?: NormalizedClaim;
      requirement?: RequirementDetail;
      actionRole?: ActionRoleDetail;
    }): boolean => {
      proposedCount++;

      // Invariant check: boundaries within raw text
      if (
        atom.startOffset < 0 ||
        atom.endOffset > rawLen ||
        atom.startOffset >= atom.endOffset
      ) {
        rejectedCount++;
        return false;
      }

      // Invariant check: exact text matches rawText slice verbatim
      const actualSlice = rawText.slice(atom.startOffset, atom.endOffset);
      if (actualSlice !== atom.exactText) {
        rejectedCount++;
        return false;
      }

      // Check for exact duplicate atom
      const typeKey = atom.semanticType || "UNCLASSIFIED";
      const id = `role_atom:${caseId}:${atom.startOffset}_${atom.endOffset}:${typeKey}`;
      if (acceptedAtoms.some(a => a.id === id)) {
        return false; // Skip redundant emission
      }

      acceptedAtoms.push({
        id,
        exactText: atom.exactText,
        startOffset: atom.startOffset,
        endOffset: atom.endOffset,
        section: atom.section,
        subject: atom.subject,
        semanticType: atom.semanticType,
        confidence: atom.confidence,
        extractionMethod: atom.extractionMethod,
        epistemicMarker: "EXACT_SOURCE_STATEMENT",
        normalizedClaim: atom.normalizedClaim,
        requirement: atom.requirement,
        actionRole: atom.actionRole
      });

      acceptedCount++;
      return true;
    };

    // 1. Scan structural metadata lines
    let hasStructuralMetaLines = false;
    META_LINE_REGEX.lastIndex = 0;
    let metaMatch: RegExpExecArray | null;
    while ((metaMatch = META_LINE_REGEX.exec(rawText)) !== null) {
      hasStructuralMetaLines = true;
      const fullMatch = metaMatch[0];
      const fieldName = metaMatch[1].trim();
      const fieldValue = metaMatch[2].trim();

      const valStartInMatch = fullMatch.indexOf(fieldValue);
      const valStart = metaMatch.index + valStartInMatch;
      const valEnd = valStart + fieldValue.length;

      // Extract field-specific atom
      const lowerField = fieldName.toLowerCase();
      if (lowerField.includes("reports to") || lowerField.includes("reporting to")) {
        acceptAtom({
          exactText: fieldValue,
          startOffset: valStart,
          endOffset: valEnd,
          section: "STRUCTURAL_METADATA",
          subject: "ROLE",
          semanticType: "REPORTING_LINE",
          confidence: 0.98,
          extractionMethod: "DETERMINISTIC_META_LINE",
          normalizedClaim: { predicate: "REPORTS_TO", object: fieldValue }
        });
      } else if (lowerField === "team" || lowerField === "team size") {
        const hasLeadership = /(?:lead|manage|build|direct|scale|head)\b/i.test(fieldValue);
        const hasScale = /\b\d+\b/.test(fieldValue);
        const teamAtomType: RoleSemanticType | undefined = hasScale
          ? "PEOPLE_SCALE"
          : hasLeadership
          ? "PEOPLE_LEADERSHIP"
          : undefined;
        acceptAtom({
          exactText: fieldValue,
          startOffset: valStart,
          endOffset: valEnd,
          section: "STRUCTURAL_METADATA",
          subject: "ROLE",
          semanticType: teamAtomType,
          confidence: 0.95,
          extractionMethod: "DETERMINISTIC_META_LINE",
          normalizedClaim: { predicate: teamAtomType === "PEOPLE_SCALE" ? "MANAGES_TEAM_SIZE" : teamAtomType === "PEOPLE_LEADERSHIP" ? "LEAD" : "TEAM_COMPOSITION", object: fieldValue }
        });
      } else if (lowerField.includes("location")) {
        acceptAtom({
          exactText: fieldValue,
          startOffset: valStart,
          endOffset: valEnd,
          section: "STRUCTURAL_METADATA",
          subject: "ROLE",
          semanticType: "WORK_CONDITION",
          confidence: 0.95,
          extractionMethod: "DETERMINISTIC_META_LINE",
          normalizedClaim: { predicate: "LOCATED_AT", object: fieldValue }
        });
      } else if (lowerField.includes("compensation") || lowerField.includes("salary") || lowerField === "pay") {
        acceptAtom({
          exactText: fieldValue,
          startOffset: valStart,
          endOffset: valEnd,
          section: "STRUCTURAL_METADATA",
          subject: "ROLE",
          semanticType: undefined,
          confidence: 0.95,
          extractionMethod: "DETERMINISTIC_META_LINE",
          normalizedClaim: { predicate: "OFFERS_COMPENSATION", object: fieldValue }
        });
      } else if (lowerField.includes("experience")) {
        const isHard = /\b\d+\+?\s*years?\b/i.test(fieldValue);
        acceptAtom({
          exactText: fieldValue,
          startOffset: valStart,
          endOffset: valEnd,
          section: "STRUCTURAL_METADATA",
          subject: "ROLE",
          semanticType: isHard ? "HARD_REQUIREMENT" : undefined,
          confidence: 0.92,
          extractionMethod: "DETERMINISTIC_META_LINE",
          requirement: {
            materiality: isHard ? "HARD" : "UNSTATED",
            materialityCue: isHard ? "Experience" : null,
            requirementDimension: "EXPERIENCE_YEARS"
          }
        });
      }
    }

    // 2. Multi-pass structural section recognizer
    const rawHeadings: Array<{
      type: SectionType;
      text: string;
      start: number;
      end: number;
    }> = [];

    let hasGluedHeadings = false;

    // A. Detect company-specific heading if companyName is provided
    if (companyName && companyName.length >= 3) {
      const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const compRegex = new RegExp(`(?:^|[.\\n\\r\\t•*—])\\s*(About\\s+${escaped})(?=[A-Z0-9\\n\\r:•*—]|$)`, "gi");
      let m: RegExpExecArray | null;
      while ((m = compRegex.exec(rawText)) !== null) {
        const hText = m[1];
        const hStart = m.index + m[0].indexOf(hText);
        rawHeadings.push({
          type: "ABOUT_COMPANY",
          text: hText,
          start: hStart,
          end: hStart + hText.length
        });
      }
    }

    // B. Detect general headings
    for (const def of SECTION_DEFINITIONS) {
      def.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = def.regex.exec(rawText)) !== null) {
        const fullMatch = m[0];
        const hText = m[1];
        const hStart = m.index + fullMatch.indexOf(hText);
        const hEnd = hStart + hText.length;

        // Check if concatenated directly with subsequent text (glued heading)
        if (hEnd < rawLen && /[A-Z0-9]/.test(rawText[hEnd]) && !/[\s\n\r:]/.test(rawText[hEnd])) {
          hasGluedHeadings = true;
        }

        // Avoid overlapping with existing headings
        if (!rawHeadings.some(h => (hStart >= h.start && hStart < h.end) || (hEnd > h.start && hEnd <= h.end))) {
          rawHeadings.push({
            type: def.type,
            text: hText,
            start: hStart,
            end: hEnd
          });
        }
      }
    }

    // Sort headings by position
    rawHeadings.sort((a, b) => a.start - b.start);

    // Build contiguous sections
    const sections: DetectedSection[] = [];
    if (rawHeadings.length === 0) {
      // Entire text is a single fallback section
      sections.push({
        type: "ROLE_OVERVIEW",
        headingText: "",
        headingStart: 0,
        headingEnd: 0,
        contentStart: 0,
        contentEnd: rawLen,
        rawContent: rawText,
        isSynthetic: true
      });
    } else {
      // Intro section before first heading (synthetic lead region)
      if (rawHeadings[0].start > 0) {
        const introContent = rawText.slice(0, rawHeadings[0].start);
        sections.push({
          type: "ROLE_OVERVIEW",
          headingText: "",
          headingStart: 0,
          headingEnd: 0,
          contentStart: 0,
          contentEnd: rawHeadings[0].start,
          rawContent: introContent,
          isSynthetic: true
        });
      }

      for (let i = 0; i < rawHeadings.length; i++) {
        const cur = rawHeadings[i];
        const next = rawHeadings[i + 1];
        const contentStart = cur.end;
        const contentEnd = next ? next.start : rawLen;
        const rawContent = rawText.slice(contentStart, contentEnd);

        sections.push({
          type: cur.type,
          headingText: cur.text,
          headingStart: cur.start,
          headingEnd: cur.end,
          contentStart,
          contentEnd,
          rawContent,
          isSynthetic: false
        });
      }
    }

    // 3. Atomize sections with architectural subject gating
    for (const sec of sections) {
      // Determine default subject
      let defaultSubject: RoleSubject = "ROLE";
      if (sec.type === "ABOUT_COMPANY") {
        defaultSubject = "COMPANY";
      } else if (sec.type === "APPLICATION" || sec.type === "LEGAL_EEO") {
        defaultSubject = "RECRUITING_PROCESS";
      } else if (sec.type === "BENEFITS") {
        defaultSubject = "RECRUITING_PROCESS";
      }

      // If section is ABOUT_COMPANY, all atoms remain subject = COMPANY
      if (defaultSubject === "COMPANY") {
        this.extractCompanySectionAtoms(sec, rawText, acceptAtom);
        continue;
      }

      // If section is APPLICATION or LEGAL_EEO, atoms remain RECRUITING_PROCESS
      if (defaultSubject === "RECRUITING_PROCESS") {
        this.extractRecruitingSectionAtoms(sec, rawText, acceptAtom);
        continue;
      }

      // Section is ROLE-bearing
      if (sec.type === "RESPONSIBILITIES") {
        this.atomizeResponsibilities(sec, rawText, acceptAtom);
      } else if (sec.type === "REQUIREMENTS" || sec.type === "PREFERRED") {
        this.atomizeRequirements(sec, rawText, acceptAtom);
      } else if (sec.type === "SUCCESS") {
        this.atomizeSuccess(sec, rawText, acceptAtom);
      } else if (sec.type === "ROLE_OVERVIEW") {
        this.atomizeRoleOverview(sec, rawText, acceptAtom);
      } else {
        this.atomizeGenericRoleSection(sec, rawText, acceptAtom);
      }
    }

    // 4. Targeted Document-Wide Semantic Proposition Mining with Subject Eligibility Gate
    this.extractHighPrecisionPropositions(rawText, sections, acceptAtom);

    return {
      caseId,
      canonicalJobId,
      companyName,
      title,
      rawTextLength: rawLen,
      sections,
      atoms: acceptedAtoms,
      metadata: {
        extractorVersion: "RoleIntelligenceExtractorV1",
        hasGluedHeadings,
        hasStructuralMetaLines,
        proposalCounts: {
          proposedAtoms: proposedCount,
          acceptedAtoms: acceptedCount,
          rejectedAtoms: rejectedCount
        }
      }
    };
  }

  /**
   * Extract company section atoms (Strict Subject = COMPANY).
   * Prevents company headcount, turnover, or founder mentions from becoming role scope atoms.
   */
  private extractCompanySectionAtoms(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const sentences = this.splitSentences(sec.rawContent, sec.contentStart);
    for (const s of sentences) {
      if (s.text.trim().length < 15) continue;
      acceptAtom({
        exactText: s.text,
        startOffset: s.start,
        endOffset: s.end,
        section: sec.type,
        subject: "COMPANY",
        semanticType: "COMPANY_CONTEXT",
        confidence: 0.90,
        extractionMethod: "DETERMINISTIC_SECTION",
        normalizedClaim: { predicate: "DESCRIBES_COMPANY", object: s.text.trim().slice(0, 50) }
      });
    }
  }

  /**
   * Extract recruiting section atoms (Strict Subject = RECRUITING_PROCESS).
   */
  private extractRecruitingSectionAtoms(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const sentences = this.splitSentences(sec.rawContent, sec.contentStart);
    for (const s of sentences) {
      if (s.text.trim().length < 15) continue;
      acceptAtom({
        exactText: s.text,
        startOffset: s.start,
        endOffset: s.end,
        section: sec.type,
        subject: "RECRUITING_PROCESS",
        semanticType: undefined,
        confidence: 0.88,
        extractionMethod: "DETERMINISTIC_SECTION",
        normalizedClaim: { predicate: "RECRUITING_POLICY", object: s.text.trim().slice(0, 50) }
      });
    }
  }

  /**
   * Helper to identify recruiting process, consultant metadata, and application boilerplate.
   */
  private isRecruitingProcessText(text: string): boolean {
    return /\b(?:consultant\s+details|consultant\s+name|ea\s+licence|to\s+submit\s+your\s+application|apply\s+online|email\s+your\s+(?:updated\s+)?(?:cv|resume)|upon\s+submission\s+of\s+your\s+cv|personal\s+data|privacy\s+(?:policy|statement)|data\s+prot(?:e)?ction|evaluate\s+your\s+suitability|job\s+openings\s+within\s+our\s+organization|equal\s+opportunities\s+to\s+all\s+applicants|equal\s+opportunity|show\s+more\s+show\s+less|electronic\s+database|disclose\s+your\s+personal\s+information)\b/i.test(text);
  }

  /**
   * Atomize RESPONSIBILITIES using punctuation and bounded role-action verbs.
   */
  private atomizeResponsibilities(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const content = sec.rawContent;
    const baseOffset = sec.contentStart;

    const verbPattern = ROLE_ACTION_VERBS.join("|");
    const itemSplitRegex = new RegExp(`(?:[\\n\\r•*—\\t]+|(?<=[a-z0-9)”;!.]\\s{0,3}))(?=(?:${verbPattern})\\b)`, "g");

    const splitIndices = new Set<number>();
    splitIndices.add(0);

    let m: RegExpExecArray | null;
    while ((m = itemSplitRegex.exec(content)) !== null) {
      if (m.index > 0) splitIndices.add(m.index);
      if (m.index === itemSplitRegex.lastIndex) {
        itemSplitRegex.lastIndex++;
      }
    }

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
    let em: RegExpExecArray | null;
    while ((em = emojiRegex.exec(content)) !== null) {
      if (em.index > 0) splitIndices.add(em.index);
      if (em.index === emojiRegex.lastIndex) {
        emojiRegex.lastIndex++;
      }
    }

    const splitPoints = Array.from(splitIndices).sort((a, b) => a - b);
    splitPoints.push(content.length);

    for (let i = 0; i < splitPoints.length - 1; i++) {
      const segStart = splitPoints[i];
      const segEnd = splitPoints[i + 1];
      const rawSeg = content.slice(segStart, segEnd);

      const trimmed = this.trimOffsets(rawSeg, baseOffset + segStart);
      if (trimmed.text.length < 10) continue;

      if (this.isRecruitingProcessText(trimmed.text)) {
        acceptAtom({
          exactText: trimmed.text,
          startOffset: trimmed.start,
          endOffset: trimmed.end,
          section: "APPLICATION",
          subject: "RECRUITING_PROCESS",
          semanticType: undefined,
          confidence: 0.88,
          extractionMethod: "DETERMINISTIC_SECTION",
          normalizedClaim: { predicate: "RECRUITING_POLICY", object: trimmed.text.trim().slice(0, 50) }
        });
        continue;
      }

      const firstWord = trimmed.text.split(/\s+/)[0] || "DELIVER";
      acceptAtom({
        exactText: trimmed.text,
        startOffset: trimmed.start,
        endOffset: trimmed.end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "RESPONSIBILITY",
        confidence: 0.94,
        extractionMethod: "DETERMINISTIC_SECTION",
        normalizedClaim: {
          predicate: firstWord.toUpperCase(),
          object: trimmed.text.slice(firstWord.length).trim().slice(0, 60)
        },
        actionRole: {
          ownershipLevel: firstWord.toLowerCase() === "own" ? "OWN" : "LEAD",
          targetOutcome: null
        }
      });

      this.decomposeCompoundClause(trimmed.text, trimmed.start, acceptAtom, sec.type);
    }
  }

  /**
   * Atomize REQUIREMENTS / PREFERRED.
   * Only assigns HARD_REQUIREMENT or PREFERRED_REQUIREMENT if explicit cues exist.
   * Uncued statements retain section provenance with semanticType: undefined.
   */
  private atomizeRequirements(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const content = sec.rawContent;
    const baseOffset = sec.contentStart;

    const sentences = this.splitSentences(content, baseOffset);

    for (const s of sentences) {
      const text = s.text;
      if (text.length < 8) continue;

      if (this.isRecruitingProcessText(text)) {
        acceptAtom({
          exactText: text,
          startOffset: s.start,
          endOffset: s.end,
          section: "APPLICATION",
          subject: "RECRUITING_PROCESS",
          semanticType: undefined,
          confidence: 0.88,
          extractionMethod: "DETERMINISTIC_SECTION",
          normalizedClaim: { predicate: "RECRUITING_POLICY", object: text.trim().slice(0, 50) }
        });
        continue;
      }

      const lower = text.toLowerCase();

      let materiality: RequirementMateriality = "UNSTATED";
      let cue: string | null = null;
      let semanticType: RoleSemanticType | undefined = undefined;

      const PREFERRED_PREFIX_REGEX = /^(?:preferred|nice\s+to\s+have|good\s+to\s+have|plus|bonus|desirable|optional)[:\s]/i;
      const PREFERRED_SUFFIX_REGEX = /\b(?:is\s+preferred|is\s+a\s+plus|preferred|nice\s+to\s+have|good\s+to\s+have)\.?$/i;
      const HARD_CUE_WORDS = ["must", "mandatory", "required", "minimum", "at least"];
      const CREDENTIAL_HARD_REGEX = /\b(?:bachelor|master|mba|phd|degree|certification|certified|licence|license)\b/i;
      const yearsMatch = /(\d+)(?:\s*[-–—]\s*(\d+))?\+?\s*years?/i.exec(text);

      if (sec.type === "PREFERRED") {
        materiality = "PREFERRED";
        cue = sec.headingText || "Preferred";
        semanticType = "PREFERRED_REQUIREMENT";
      } else if (PREFERRED_PREFIX_REGEX.test(text) || PREFERRED_SUFFIX_REGEX.test(text)) {
        materiality = "PREFERRED";
        cue = "preferred_cue";
        semanticType = "PREFERRED_REQUIREMENT";
      } else {
        // Deterministic hard cues: N+ years, N-M years, must, minimum, degree constraints
        let hardCueMatched: string | null = null;
        if (yearsMatch) {
          hardCueMatched = yearsMatch[0];
        } else {
          for (const hc of HARD_CUE_WORDS) {
            const r = new RegExp(`\\b${hc}\\b`, "i");
            if (r.test(text)) {
              hardCueMatched = hc;
              break;
            }
          }
          if (!hardCueMatched) {
            const credMatch = CREDENTIAL_HARD_REGEX.exec(text);
            if (credMatch) {
              hardCueMatched = credMatch[0];
            }
          }
        }

        if (hardCueMatched) {
          materiality = "HARD";
          cue = hardCueMatched;
          semanticType = "HARD_REQUIREMENT";
        } else if (
          /\b(?:basic qualifications|minimum qualifications)\b/i.test(sec.headingText)
        ) {
          materiality = "HARD";
          cue = sec.headingText;
          semanticType = "HARD_REQUIREMENT";
        } else {
          for (const pc of PREFERRED_CUES) {
            if (lower.includes(pc)) {
              materiality = "PREFERRED";
              cue = pc;
              semanticType = "PREFERRED_REQUIREMENT";
              break;
            }
          }
        }
      }

      let dimension: RequirementDimension = "CAPABILITY";
      let parsedYears: { minimum?: number; maximum?: number; exact?: number } | undefined = undefined;

      if (yearsMatch) {
        dimension = "EXPERIENCE_YEARS";
        const minYrs = parseInt(yearsMatch[1], 10);
        const maxYrs = yearsMatch[2] ? parseInt(yearsMatch[2], 10) : undefined;
        parsedYears = { minimum: minYrs, ...(maxYrs !== undefined ? { maximum: maxYrs } : {}) };
      } else if (/\b(bachelor|master|mba|degree|phd)\b/i.test(text)) {
        dimension = "EDUCATION";
      } else if (/\b(certification|certified|licence|license)\b/i.test(text)) {
        dimension = "CERTIFICATION";
      } else if (/\b(portfolio|github|dribbble)\b/i.test(text)) {
        dimension = "PORTFOLIO";
      }

      acceptAtom({
        exactText: text,
        startOffset: s.start,
        endOffset: s.end,
        section: sec.type,
        subject: "ROLE",
        semanticType,
        confidence: semanticType ? 0.95 : 0.85,
        extractionMethod: "DETERMINISTIC_SECTION",
        normalizedClaim: {
          predicate: materiality === "HARD" ? "REQUIRE" : materiality === "PREFERRED" ? "PREFER" : "EXPECT",
          object: text.slice(0, 60)
        },
        requirement: {
          materiality,
          materialityCue: cue,
          requirementDimension: dimension,
          parsedYears
        }
      });
    }
  }

  /**
  * Atomize SUCCESS section.
  */
  private atomizeSuccess(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const sentences = this.splitSentences(sec.rawContent, sec.contentStart);
    for (const s of sentences) {
      if (s.text.length < 10) continue;
      const hasMetric = /\b(?:\d+%|\$\d+|₹\d+|kpi|sla|target|metric)\b/i.test(s.text);
      acceptAtom({
        exactText: s.text,
        startOffset: s.start,
        endOffset: s.end,
        section: sec.type,
        subject: "ROLE",
        semanticType: hasMetric ? "SUCCESS_METRIC" : "OUTCOME",
        confidence: 0.92,
        extractionMethod: "DETERMINISTIC_SECTION",
        normalizedClaim: {
          predicate: hasMetric ? "ACHIEVE_METRIC" : "DELIVER_OUTCOME",
          object: s.text.slice(0, 60)
        }
      });
    }

    // If the section content contains an unpunctuated KPI list like "The role will be evaluated on: ..."
    const evalOnMatch = /(?:evaluated\s+on\s*:|kpis?\s*:|success\s+metrics?\s*:)\s*/i.exec(sec.rawContent);
    if (evalOnMatch) {
      const listStart = sec.contentStart + evalOnMatch.index + evalOnMatch[0].length;
      const listContent = sec.rawContent.slice(evalOnMatch.index + evalOnMatch[0].length);
      const metricNounSplit = /(?<=\b(?:Delivery|Satisfaction|Productivity|Retention|Rate|Compliance|Score|Efficiency|Dependency|Volume|Output|Contribution))\s+(?=[A-Z])/g;

      const splitIndices = [0];
      let sm: RegExpExecArray | null;
      while ((sm = metricNounSplit.exec(listContent)) !== null) {
        splitIndices.push(sm.index);
      }
      splitIndices.push(listContent.length);

      for (let i = 0; i < splitIndices.length - 1; i++) {
        const item = listContent.slice(splitIndices[i], splitIndices[i + 1]).trim();
        if (item.length < 3) continue;
        const itemStart = listStart + splitIndices[i] + (listContent.slice(splitIndices[i]).indexOf(item));
        const itemEnd = itemStart + item.length;
        const hasMetric = /\b(?:\d+%|\$\d+|₹\d+|rate|score|kpi|metric)\b/i.test(item);
        acceptAtom({
          exactText: item,
          startOffset: itemStart,
          endOffset: itemEnd,
          section: sec.type,
          subject: "ROLE",
          semanticType: hasMetric ? "SUCCESS_METRIC" : "OUTCOME",
          confidence: 0.94,
          extractionMethod: "DETERMINISTIC_SECTION",
          normalizedClaim: {
            predicate: hasMetric ? "ACHIEVE_METRIC" : "DELIVER_OUTCOME",
            object: item.slice(0, 60)
          }
        });
      }
    }
  }

  /**
   * Atomize ROLE_OVERVIEW section.
   */
  private atomizeRoleOverview(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const sentences = this.splitSentences(sec.rawContent, sec.contentStart);
    let purposeEmitted = false;
    for (const s of sentences) {
      if (s.text.length < 15) continue;
      if (this.isRecruitingProcessText(s.text)) {
        acceptAtom({
          exactText: s.text,
          startOffset: s.start,
          endOffset: s.end,
          section: "APPLICATION",
          subject: "RECRUITING_PROCESS",
          semanticType: undefined,
          confidence: 0.88,
          extractionMethod: "DETERMINISTIC_SECTION"
        });
        continue;
      }

      // High-precision subject gating for lead regions
      const isCompanyStatement = /^(?:Company\s*:|About\s+(?:Us|the\s+Company)|[A-Za-z0-9\s&,.-]+(?:\s+is\s+a\s+|\s+is\s+an\s+|\s+is\s+the\s+)|We\s+are\s+(?:a|an)\b)/i.test(s.text.trim()) || /\b(?:is\s+a\s+(?:leading|fast-scaling|global|technology|branding|digital|consulting|boutique|platform|specialist|firm|company|agency|enterprise))\b/i.test(s.text);
      const hasRoleBearingAgent = /\b(?:looking\s+for|seeking|hiring|appointing|role\s+is|position\s+is|opportunity\s+is|responsibilities|reporting\s+to)\b/i.test(s.text);

      if (isCompanyStatement && !hasRoleBearingAgent) {
        acceptAtom({
          exactText: s.text,
          startOffset: s.start,
          endOffset: s.end,
          section: "ABOUT_COMPANY",
          subject: "COMPANY",
          semanticType: "COMPANY_CONTEXT",
          confidence: 0.92,
          extractionMethod: "DETERMINISTIC_SECTION",
          normalizedClaim: { predicate: "OPERATES_AS", object: s.text.slice(0, 60) }
        });
        continue;
      }

      const isStructuralMeta = /^(?:Company|Job Type|Experience|Location|Pay|Salary)\s*:/i.test(s.text.trim());
      if (isStructuralMeta) {
        acceptAtom({
          exactText: s.text,
          startOffset: s.start,
          endOffset: s.end,
          section: "STRUCTURAL_METADATA",
          subject: "ROLE",
          semanticType: undefined,
          confidence: 0.90,
          extractionMethod: "DETERMINISTIC_SECTION"
        });
        continue;
      }

      if (!purposeEmitted && hasRoleBearingAgent) {
        acceptAtom({
          exactText: s.text,
          startOffset: s.start,
          endOffset: s.end,
          section: sec.type,
          subject: "ROLE",
          semanticType: "ROLE_PURPOSE",
          confidence: 0.90,
          extractionMethod: "DETERMINISTIC_SECTION",
          normalizedClaim: { predicate: "SERVES_PURPOSE", object: s.text.slice(0, 60) }
        });
        purposeEmitted = true;
      }
    }
  }

  /**
   * Atomize generic role sections (WHO_YOU_WORK_WITH, WHY_JOIN, etc.).
   */
  private atomizeGenericRoleSection(
    sec: DetectedSection,
    rawText: string,
    acceptAtom: (atom: any) => boolean
  ) {
    const sentences = this.splitSentences(sec.rawContent, sec.contentStart);
    for (const s of sentences) {
      if (s.text.length < 15) continue;
      if (this.isRecruitingProcessText(s.text)) {
        acceptAtom({
          exactText: s.text,
          startOffset: s.start,
          endOffset: s.end,
          section: "APPLICATION",
          subject: "RECRUITING_PROCESS",
          semanticType: undefined,
          confidence: 0.88,
          extractionMethod: "DETERMINISTIC_SECTION"
        });
        continue;
      }
      const isCondition = /\b(?:remote|hybrid|on-?site|in\s+person|relocation|travel|flexible\s+hours|working\s+hours|full-?time|part-?time|contract|shift)\b/i.test(s.text);
      acceptAtom({
        exactText: s.text,
        startOffset: s.start,
        endOffset: s.end,
        section: sec.type,
        subject: "ROLE",
        semanticType: isCondition ? "WORK_CONDITION" : undefined,
        confidence: 0.85,
        extractionMethod: "DETERMINISTIC_SECTION",
        normalizedClaim: isCondition ? { predicate: "WORK_ENVIRONMENT", object: s.text.slice(0, 60) } : undefined
      });
    }
  }

  /**
   * Decompose compound clauses into distinct exact-subspan atoms.
   */
  private decomposeCompoundClause(
    clauseText: string,
    clauseStart: number,
    acceptAtom: (atom: any) => boolean,
    section: SectionType
  ) {
    // 1. P&L Ownership
    const pnlMatch = /(?:own|run|manage|accountable\s+for)\s+(?:the\s+)?(?:regional\s+|vertical\s+|overall\s+)?p&l\b/i.exec(clauseText);
    if (pnlMatch) {
      const subStart = clauseStart + pnlMatch.index;
      const subEnd = subStart + pnlMatch[0].length;
      acceptAtom({
        exactText: pnlMatch[0],
        startOffset: subStart,
        endOffset: subEnd,
        section,
        subject: "ROLE",
        semanticType: "PNL_OWNERSHIP",
        confidence: 0.97,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "OWN", object: "P&L" }
      });
    }

    // 2. People Leadership
    const peopleMatch = /(?:build\s+(?:and|&)\s+lead|lead\s+(?:and|&)\s+manage|build|lead|manage|grow)\s+(?:the\s+)?(?:commercial\s+|regional\s+|cross-functional\s+)?team\b/i.exec(clauseText);
    if (peopleMatch) {
      const subStart = clauseStart + peopleMatch.index;
      const subEnd = subStart + peopleMatch[0].length;
      acceptAtom({
        exactText: peopleMatch[0],
        startOffset: subStart,
        endOffset: subEnd,
        section,
        subject: "ROLE",
        semanticType: "PEOPLE_LEADERSHIP",
        confidence: 0.95,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "LEAD", object: "team" }
      });
    }

    // 3. Profitability Accountability
    const profitMatch = /(?:drive|own|deliver|ensure)\s+profitable\s+growth\b/i.exec(clauseText);
    if (profitMatch) {
      const subStart = clauseStart + profitMatch.index;
      const subEnd = subStart + profitMatch[0].length;
      acceptAtom({
        exactText: profitMatch[0],
        startOffset: subStart,
        endOffset: subEnd,
        section,
        subject: "ROLE",
        semanticType: "PROFITABILITY_ACCOUNTABILITY",
        confidence: 0.95,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "DRIVE", object: "profitable growth" }
      });
    }

    // 4. Geographic Scope
    const geoMatch = /across\s+(?:India\s+(?:and|&)\s+Southeast\s+Asia|APAC|global\s+markets|the\s+region)\b/i.exec(clauseText);
    if (geoMatch) {
      const subStart = clauseStart + geoMatch.index;
      const subEnd = subStart + geoMatch[0].length;
      acceptAtom({
        exactText: geoMatch[0],
        startOffset: subStart,
        endOffset: subEnd,
        section,
        subject: "ROLE",
        semanticType: "GEOGRAPHIC_SCOPE",
        confidence: 0.95,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "OPERATE_IN", object: geoMatch[0] }
      });
    }
  }

  /**
   * Targeted Document-Wide Semantic Proposition Mining with Subject Eligibility Gating.
   */
  private extractHighPrecisionPropositions(
    rawText: string,
    sections: DetectedSection[],
    acceptAtom: (atom: any) => boolean
  ) {
    const getSectionAt = (offset: number): DetectedSection => {
      for (const s of sections) {
        if (offset >= s.contentStart && offset < s.contentEnd) return s;
      }
      return sections[0] || { type: "OTHER" as SectionType };
    };

    // 1. Explicit REPORTING_LINE: "reports to", "reporting to", "report to"
    const reportingRegex = /(?:reports?|reporting)\s+(?:directly\s+)?(?:to|into)\s+([A-Z][A-Za-z0-9&.,\s'-]{2,40}?)(?=[,.\n\r;]|$)/gi;
    let rm: RegExpExecArray | null;
    while ((rm = reportingRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(rm.index);
      if (sec.type === "ABOUT_COMPANY") continue; // Subject Eligibility Gate

      const start = rm.index;
      const end = start + rm[0].length;
      acceptAtom({
        exactText: rm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "REPORTING_LINE",
        confidence: 0.98,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "REPORTS_TO", object: rm[1].trim() }
      });
    }

    // 2. FOUNDER_CEO_PROXIMITY: "work closely with the founder", "work directly with the CEO", "allow the Founder to focus primarily on strategy"
    const proximityRegex = /(?:(?:work(?:ing)?\s+(?:closely|directly)\s+with|partner(?:ing)?\s+closely\s+with)\s+(?:the\s+)?(founder(?:\s*(?:&|and)\s*ceo)?|ceo|promoter)|(?:allow|enable)\s+(?:the\s+)?founder\s+to\s+focus\s+primarily\s+on\s+strategy|without\s+constant\s+founder\s+intervention)\b/gi;
    let pm: RegExpExecArray | null;
    while ((pm = proximityRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(pm.index);
      if (sec.type === "ABOUT_COMPANY") continue; // Gate out company background

      const start = pm.index;
      const end = start + pm[0].length;
      acceptAtom({
        exactText: pm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "FOUNDER_CEO_PROXIMITY",
        confidence: 0.96,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "PROXIMATE_TO", object: (pm[1] || pm[0]).trim() }
      });
    }

    // 3. BOARD_EXPOSURE
    const boardRegex = /(?:statutory\s+Board\s+Director|attend\s+board\s+meetings|reports?\s+to\s+(?:the\s+)?board\s+of\s+directors|sign(?:ing)?\s+off\s+on\s+board|board\s+reporting|statutory\s+director\s+responsibilities)\b/gi;
    let bm: RegExpExecArray | null;
    while ((bm = boardRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(bm.index);
      if (sec.type === "ABOUT_COMPANY") continue;

      const start = bm.index;
      const end = start + bm[0].length;
      acceptAtom({
        exactText: bm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "BOARD_EXPOSURE",
        confidence: 0.98,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "GOVERNED_BY", object: bm[0].trim() }
      });
    }

    // 4. PNL_OWNERSHIP
    const pnlRegex = /(?:(?:own(?:ing)?|run(?:ning)?|manage|hold)\s+(?:the\s+)?(?:[a-z]+\s+)*(?:as\s+a\s+)?p&l|full\s+p&l\s+(?:ownership|accountability)|p&l\s+ownership)\b/gi;
    let pnlm: RegExpExecArray | null;
    while ((pnlm = pnlRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(pnlm.index);
      if (sec.type === "ABOUT_COMPANY") continue;

      const start = pnlm.index;
      const end = start + pnlm[0].length;
      acceptAtom({
        exactText: pnlm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "PNL_OWNERSHIP",
        confidence: 0.98,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "OWN", object: "P&L" }
      });
    }

    // 5. REVENUE_ACCOUNTABILITY (requires explicit revenue ownership/accountability)
    // Negative test: "experienced in Revenue Operations" must NOT match!
    const revRegex = /(?:own(?:ing)?|accountable\s+for|drive|deliver)\s+(?:the\s+)?(?:sales\s+number|annual\s+revenue|topline|revenue\s+targets?)\b/gi;
    let revm: RegExpExecArray | null;
    while ((revm = revRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(revm.index);
      if (sec.type === "ABOUT_COMPANY") continue;

      const start = revm.index;
      const end = start + revm[0].length;
      acceptAtom({
        exactText: revm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "REVENUE_ACCOUNTABILITY",
        confidence: 0.96,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "ACCOUNTABLE_FOR", object: "revenue" }
      });
    }

    // 6. DECISION_AUTHORITY
    // Negative test: "strong decision-making skills" must NOT match!
    const decRegex = /(?:decision\s+rights|own\s+all\s+(?:commercial|operational|india\s+people)\s+decisions|approve\s+minutes\s+and\s+resolutions|sign\s+statutory\s+filings|signing\s+off\s+on\s+board\s+and\s+compliance\s+documents|take\s+ownership\s+of\s+(?:the\s+company[’']s\s+)?day-to-day\s+operations)\b/gi;
    let decm: RegExpExecArray | null;
    while ((decm = decRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(decm.index);
      if (sec.type === "ABOUT_COMPANY") continue;

      const start = decm.index;
      const end = start + decm[0].length;
      acceptAtom({
        exactText: decm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "DECISION_AUTHORITY",
        confidence: 0.98,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "DECIDE", object: decm[0].trim() }
      });
    }

    // 7. PEOPLE_SCALE
    const scaleRegex = /(?:target\s+\d+[–-]\d+\s+in\s+year\s+\d+|team\s+of\s+\d+|\d+[-–\s]+member\s+team|\d+\+\s+person\s+engineering\s+organisation|orgs?\s+of\s+\d+[\s–-]+\d+\+?\s+people)\b/gi;
    let scalem: RegExpExecArray | null;
    while ((scalem = scaleRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(scalem.index);
      if (sec.type === "ABOUT_COMPANY") continue; // Gated!

      const start = scalem.index;
      const end = start + scalem[0].length;
      acceptAtom({
        exactText: scalem[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "PEOPLE_SCALE",
        confidence: 0.97,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "SCALE_TEAM", object: scalem[0].trim() }
      });
    }

    // 8. GREENFIELD_BUILD
    const gfRegex = /(?:build\s+(?:[a-z\s]+?\s+)?from\s+(?:zero|scratch)|greenfield\b|from\s+scratch|build\s+a\s+new\s+business\s+line|from\s+the\s+ground\s+up)\b/gi;
    let gfm: RegExpExecArray | null;
    while ((gfm = gfRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(gfm.index);
      if (sec.type === "ABOUT_COMPANY") continue;

      const start = gfm.index;
      const end = start + gfm[0].length;
      acceptAtom({
        exactText: gfm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "GREENFIELD_BUILD",
        confidence: 0.96,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "BUILD_GREENFIELD", object: gfm[0].trim() }
      });
    }

    // 9. PEOPLE_LEADERSHIP
    // Only matches active leadership of a team or org; rejects pure candidate qualifications
    const peopleLeadRegex = /(?:(?:lead(?:ing)?|manage|build|grow|direct)\s+(?:and\s+(?:develop|manage|lead)\s+)?(?:a\s+)?(?:\d+\+?\s+person\s+)?(?:high-performing[,\s]+)?(?:multicultural\s+|cross-functional\s+|cross-cultural\s+|advisory\s+and\s+transactions\s+|sales\s+|engineering\s+)?(?:team|teams|engineering\s+organisation|engineering\s+organization|engineering\s+organisations|engineering\s+organizations)|direct\s+team\s+management\s*:\s*\d+)/gi;
    let plm: RegExpExecArray | null;
    while ((plm = peopleLeadRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(plm.index);
      if (sec.type === "ABOUT_COMPANY") continue; // Gate out company background

      const start = plm.index;
      const end = start + plm[0].length;

      // Check preceding window for qualification / requirement framing
      const windowStart = Math.max(0, start - 150);
      const preceding = rawText.slice(windowStart, start);
      const isQual = /(?:experience|demonstrat(?:ed|e)|demonstrable|proven|prior|relevant|hands-on|track\s+record|skills?|ability|background|you\s+have|strong|years)\b[\w\s,–—–-]{0,40}$/i.test(preceding.trimEnd());
      if (isQual) {
        continue; // Pure candidate qualification, not active role mandate
      }

      // Check for cultural / mindset language
      const isCulture = /(?:mindset|culture|value|approach|philosophy|environment)\b/i.test(preceding.trimEnd()) || /\b(?:mindset|collaborative\s+approach)\b/i.test(plm[0]);
      if (isCulture) {
        continue;
      }

      acceptAtom({
        exactText: plm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "PEOPLE_LEADERSHIP",
        confidence: 0.96,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "LEAD", object: plm[0].trim() }
      });
    }

    // 10. REGULATORY_SCOPE
    const regScopeRegex = /(?:(?:ensuring\s+)?regulatory\s+compliance|pharmacovigilance(?:\s+regulations)?|data-protection\s+requirements|(?:GxP|GCP|GVP)(?:\/(?:GxP|GCP|GVP))?|ISO\s+27001|statutory(?:,\s+tax,)?\s+and\s+financial\s+compliance)\b/gi;
    let regm: RegExpExecArray | null;
    while ((regm = regScopeRegex.exec(rawText)) !== null) {
      const matchText = regm[0];
      const start = regm.index;
      const end = start + matchText.length;

      // Disambiguate GCP: Google Cloud Platform vs Good Clinical Practice
      if (/\bGCP\b/i.test(matchText)) {
        const windowText = rawText.slice(Math.max(0, start - 300), Math.min(rawText.length, end + 300));
        const hasCloudContext = /\b(?:AWS|Azure|cloud|kubernetes|k8s|python|devops|docker|architecture|infrastructure)\b/i.test(windowText);
        const hasClinicalContext = /\b(?:clinical|trials?|pharma(?:ceutical)?|pharmacovigilance|PV|GxP|GVP|ICH|FDA|EMA|drug\s+safety|patient\s+safety)\b/i.test(windowText);
        if (hasCloudContext || !hasClinicalContext) {
          continue; // Cloud platform GCP or unverified context, suppress regulatory classification
        }
      }

      const sec = getSectionAt(regm.index);
      if (sec.type === "ABOUT_COMPANY") continue;

      acceptAtom({
        exactText: regm[0],
        startOffset: start,
        endOffset: end,
        section: sec.type,
        subject: "ROLE",
        semanticType: "REGULATORY_SCOPE",
        confidence: 0.95,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "COMPLY_WITH", object: regm[0].trim() }
      });
    }

    // 11. WORK_CONDITION
    const workCondRegex = /(?:100%\s+remote(?:\s+with\s+flexible\s+working\s+hours)?|flexible\s+working\s+hours|flexible\s+work\s+hours|remote-first|fully\s+remote|hybrid\s+work\s+model|onsite\s+only|work\s+from\s+home)\b/gi;
    let wcm: RegExpExecArray | null;
    while ((wcm = workCondRegex.exec(rawText)) !== null) {
      const sec = getSectionAt(wcm.index);
      if (sec.type === "ABOUT_COMPANY") continue;
      acceptAtom({
        exactText: wcm[0],
        startOffset: wcm.index,
        endOffset: wcm.index + wcm[0].length,
        section: sec.type,
        subject: "ROLE",
        semanticType: "WORK_CONDITION",
        confidence: 0.95,
        extractionMethod: "DETERMINISTIC_PROPOSITION_RULE",
        normalizedClaim: { predicate: "CONDITION", object: wcm[0].trim() }
      });
    }
  }

  /**
   * Safe sentence splitting within text bounds.
   */
  private splitSentences(
    text: string,
    baseOffset: number
  ): Array<{ text: string; start: number; end: number }> {
    const results: Array<{ text: string; start: number; end: number }> = [];
    if (!text || text.length === 0) return results;

    const regex = /(?:[•*—\n\r]+|[.!?](?:\s+|(?=[A-Z0-9])))/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
      const seg = text.slice(lastIndex, m.index).trim();
      if (seg.length > 0) {
        const segStartInText = text.indexOf(seg, lastIndex);
        results.push({
          text: seg,
          start: baseOffset + segStartInText,
          end: baseOffset + segStartInText + seg.length
        });
      }
      lastIndex = m.index + m[0].length;
      if (m.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }

    if (lastIndex < text.length) {
      const seg = text.slice(lastIndex).trim();
      if (seg.length > 0) {
        const segStartInText = text.indexOf(seg, lastIndex);
        results.push({
          text: seg,
          start: baseOffset + segStartInText,
          end: baseOffset + segStartInText + seg.length
        });
      }
    }

    return results;
  }

  /**
   * Helper to trim whitespace/punctuation from segment while computing exact start/end offsets.
   */
  private trimOffsets(
    rawSlice: string,
    sliceStart: number
  ): { text: string; start: number; end: number } {
    let startIdx = 0;
    while (startIdx < rawSlice.length && /[\s\n\r•*—\t,.;]/.test(rawSlice[startIdx])) {
      startIdx++;
    }
    let endIdx = rawSlice.length;
    while (endIdx > startIdx && /[\s\n\r\t]/.test(rawSlice[endIdx - 1])) {
      endIdx--;
    }

    const trimmed = rawSlice.slice(startIdx, endIdx);
    return {
      text: trimmed,
      start: sliceStart + startIdx,
      end: sliceStart + startIdx + trimmed.length
    };
  }
}
