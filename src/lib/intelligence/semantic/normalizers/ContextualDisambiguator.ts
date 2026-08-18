/**
 * src/lib/intelligence/semantic/normalizers/ContextualDisambiguator.ts
 *
 * Contextual disambiguator for polysemous executive acronyms and brand/noun collisions.
 *
 * Handles:
 * - MD: Managing Director vs Medical Doctor vs Market Development
 * - GM: General Manager vs Gross Margin vs General Medicine
 * - Target: Target Corp vs Target audience / revenue target
 * - Apple: Apple Inc vs Apple podcast / Apple app store listing
 * - Amazon: Amazon Inc vs Amazon seller / Amazon marketplace merchant
 * - Shell: Shell Plc vs Shell scripting / Bash shell
 * - Growth: Revenue/Commercial Growth vs Growth mindset (behavioral)
 * - Consulting: Management Consulting (McKinsey/Bain) vs Consulting with internal peers
 */

export interface DisambiguationResult {
  readonly canonicalConcept: string | null;
  readonly category: "EXECUTIVE_ROLE" | "FINANCIAL_METRIC" | "CLINICAL" | "BRAND" | "BEHAVIORAL" | "TECHNICAL" | "COLLOQUIAL" | "UNRESOLVED";
  readonly confidence: number;
  readonly isFalsePositive: boolean;
  readonly rationale: string;
}

export class ContextualDisambiguator {
  /**
   * Disambiguates "MD"
   */
  public static disambiguateMD(context: string): DisambiguationResult {
    const textLower = context.toLowerCase();

    // Clinical markers
    if (/\b(?:medical|doctor|physician|clinical|hospital|patient|surgery|medicine|pharma|healthcare|mbbs|md\s+in\s+medicine)\b/i.test(textLower)) {
      return {
        canonicalConcept: "CLINICAL_PHYSICIAN",
        category: "CLINICAL",
        confidence: 0.98,
        isFalsePositive: true,
        rationale: "MD resolved to Medical Doctor / Clinical Physician from medical context"
      };
    }

    // Managing Director markers
    if (/\b(?:managing\s+director|board|business|p&l|country|region|enterprise|revenue|executive|c-suite|leadership|md\s+&\s+ceo|india|apac|emea)\b/i.test(textLower) ||
        /\bmd\b/i.test(textLower)) {
      return {
        canonicalConcept: "MANAGING_DIRECTOR",
        category: "EXECUTIVE_ROLE",
        confidence: 0.95,
        isFalsePositive: false,
        rationale: "MD resolved to Managing Director from commercial / executive context"
      };
    }

    return {
      canonicalConcept: null,
      category: "UNRESOLVED",
      confidence: 0.50,
      isFalsePositive: true,
      rationale: "MD context ambiguous"
    };
  }

  /**
   * Disambiguates "GM"
   */
  public static disambiguateGM(context: string): DisambiguationResult {
    const textLower = context.toLowerCase();

    // Gross Margin markers
    if (/\b(?:gross\s+margin|margin|bps|basis\s+points|ebitda|percentage|improved|expanded|gm%|gm\s+expansion)\b/i.test(textLower) ||
        /\bgm\s+by\s+\d+/i.test(textLower) ||
        /\d+%\s+gm\b/i.test(textLower)) {
      return {
        canonicalConcept: "GROSS_MARGIN",
        category: "FINANCIAL_METRIC",
        confidence: 0.98,
        isFalsePositive: true,
        rationale: "GM resolved to Gross Margin financial metric"
      };
    }

    // General Manager markers
    if (/\b(?:general\s+manager|business\s+unit|bu|region|country|served\s+as|hired\s+as|role\s+of|reporting\s+to|division|consumer\s+business)\b/i.test(textLower) ||
        /\bgm\s*[-–,]\s*[a-z]/i.test(textLower)) {
      return {
        canonicalConcept: "GENERAL_MANAGER",
        category: "EXECUTIVE_ROLE",
        confidence: 0.96,
        isFalsePositive: false,
        rationale: "GM resolved to General Manager executive title"
      };
    }

    return {
      canonicalConcept: null,
      category: "UNRESOLVED",
      confidence: 0.50,
      isFalsePositive: true,
      rationale: "GM context ambiguous"
    };
  }

  /**
   * Disambiguates Organization mentions (Apple, Amazon, Target, Shell, Bain/Consulting)
   */
  public static disambiguateOrganization(orgName: string, context: string): DisambiguationResult {
    const nameLower = orgName.toLowerCase().trim();
    const textLower = context.toLowerCase();

    if (nameLower === "target") {
      // False positive checks: "target audience", "revenue target", "target market", "sales target"
      if (/\btarget\s+(?:audience|market|segment|demographic|revenue|sales|account|customer|kpi|metric|goal|date)\b/i.test(textLower) ||
          /\b(?:hit|exceeded|delivered|achieved|missed)\s+(?:the\s+)?target\b/i.test(textLower)) {
        return {
          canonicalConcept: null,
          category: "COLLOQUIAL",
          confidence: 0.99,
          isFalsePositive: true,
          rationale: "Target detected as common noun (target audience / performance goal), not Target Corp"
        };
      }
      // True positive: "Target Corp", "Target India", "Retailer Target", "employed at Target"
      if (/\b(?:at|with|by)\s+target\b/i.test(textLower) || /\btarget\s+(?:corp|corporation|india|retail|stores)\b/i.test(textLower)) {
        return {
          canonicalConcept: "TARGET_CORP",
          category: "BRAND",
          confidence: 0.95,
          isFalsePositive: false,
          rationale: "Target resolved to Target Corporation retail entity"
        };
      }
      return {
        canonicalConcept: null,
        category: "UNRESOLVED",
        confidence: 0.40,
        isFalsePositive: true,
        rationale: "Bare target token without clear corporate context"
      };
    }

    if (nameLower === "apple") {
      // False positives: "Apple podcast", "Apple app store listing", "apple-to-apple comparison"
      if (/\bapple\s+(?:podcast|music\s+playlist|app\s+store|developer\s+account)\b/i.test(textLower) ||
          /\bapples?\s+to\s+apples?\b/i.test(textLower)) {
        return {
          canonicalConcept: null,
          category: "COLLOQUIAL",
          confidence: 0.98,
          isFalsePositive: true,
          rationale: "Apple detected as platform directory or idiom, not Apple Inc corporate employer"
        };
      }
      if (/\b(?:at|with)\s+apple\b/i.test(textLower) || /\bapple\s+(?:inc|corporate|cupertino|hq|engineering)\b/i.test(textLower)) {
        return {
          canonicalConcept: "APPLE_INC",
          category: "BRAND",
          confidence: 0.98,
          isFalsePositive: false,
          rationale: "Apple resolved to Apple Inc Tier 1 Brand"
        };
      }
    }

    if (nameLower === "amazon") {
      // False positives: "Amazon seller", "Amazon merchant", "Amazon store management", "selling on Amazon"
      if (/\bamazon\s+(?:seller|merchant|store|listing|dsp|ppc|fba|affiliate|marketplace\s+vendor)\b/i.test(textLower) ||
          /\bselling\s+on\s+amazon\b/i.test(textLower)) {
        return {
          canonicalConcept: null,
          category: "COLLOQUIAL",
          confidence: 0.98,
          isFalsePositive: true,
          rationale: "Amazon detected as 3P seller/merchant ecosystem, not Amazon Inc corporate leadership"
        };
      }
      if (/\b(?:at|with)\s+amazon\b/i.test(textLower) || /\bamazon\s+(?:web\s+services|corp|corporate|india|seattle|hq)\b/i.test(textLower)) {
        return {
          canonicalConcept: "AMAZON_INC",
          category: "BRAND",
          confidence: 0.98,
          isFalsePositive: false,
          rationale: "Amazon resolved to Amazon Inc corporate entity"
        };
      }
    }

    if (nameLower === "shell") {
      // False positives: "shell scripting", "bash shell", "shell script"
      if (/\bshell\s+(?:script(?:ing|s)?|command|prompt|executor)\b/i.test(textLower) || /\bbash\s+shell\b/i.test(textLower)) {
        return {
          canonicalConcept: null,
          category: "TECHNICAL",
          confidence: 0.99,
          isFalsePositive: true,
          rationale: "Shell detected as Unix/Bash shell scripting technical term, not Shell Plc energy company"
        };
      }
      if (/\b(?:at|with)\s+shell\b/i.test(textLower) || /\bshell\s+(?:oil|petroleum|energy|refinery|plc|india)\b/i.test(textLower)) {
        return {
          canonicalConcept: "SHELL_PLC",
          category: "BRAND",
          confidence: 0.96,
          isFalsePositive: false,
          rationale: "Shell resolved to Shell Plc energy corporate entity"
        };
      }
    }

    if (nameLower === "consulting") {
      // False positives: "consulting with internal stakeholders", "consulting peers"
      if (/\bconsulting\s+(?:with|internal|peers|cross-functional|stakeholders|teams)\b/i.test(textLower)) {
        return {
          canonicalConcept: null,
          category: "BEHAVIORAL",
          confidence: 0.98,
          isFalsePositive: true,
          rationale: "Consulting detected as internal communication verb, not Top-Tier Management Consulting firm"
        };
      }
    }

    return {
      canonicalConcept: orgName.toUpperCase().replace(/\s+/g, "_"),
      category: "BRAND",
      confidence: 0.85,
      isFalsePositive: false,
      rationale: "Standard organization match"
    };
  }

  /**
   * Disambiguates "Growth"
   */
  public static disambiguateGrowth(context: string): DisambiguationResult {
    const textLower = context.toLowerCase();

    // Behavioral: "growth mindset"
    if (/\bgrowth\s+mindset\b/i.test(textLower) || /\bculture\s+of\s+growth\b/i.test(textLower)) {
      return {
        canonicalConcept: "BEHAVIORAL_GROWTH_MINDSET",
        category: "BEHAVIORAL",
        confidence: 0.99,
        isFalsePositive: true,
        rationale: "Growth detected as behavioral attribute (growth mindset), not commercial revenue growth leadership"
      };
    }

    // Commercial Growth leadership
    if (/\b(?:revenue|commercial|business|topline|user|customer|arr|mrr|market)\s+growth\b/i.test(textLower) ||
        /\b(?:drove|led|scaled|delivered)\s+growth\b/i.test(textLower) ||
        /\bgrowth\s+(?:marketing|strategy|leader|head|vp|director|team)\b/i.test(textLower)) {
      return {
        canonicalConcept: "GROWTH_LEADERSHIP",
        category: "EXECUTIVE_ROLE",
        confidence: 0.96,
        isFalsePositive: false,
        rationale: "Growth resolved to commercial / revenue growth capability"
      };
    }

    return {
      canonicalConcept: "GROWTH_GENERAL",
      category: "EXECUTIVE_ROLE",
      confidence: 0.80,
      isFalsePositive: false,
      rationale: "General growth context"
    };
  }
}
