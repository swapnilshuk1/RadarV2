/**
 * src/lib/intelligence/semantic/resolvers/GeographyResolver.ts
 *
 * Directional Geography Resolver with strict administrative hierarchy invariants.
 *
 * Invariant Rules:
 * - Administrative containment must NEVER become city equivalence (e.g. Pune, Maharashtra != Mumbai on-site).
 * - Distinguishes CITY_ALIAS (Bangalore ↔ Bengaluru) from METRO_CLUSTER (Gurugram -> MEMBER_OF -> DELHI_NCR).
 * - Exposes directional relationships: MEMBER_OF, CONTAINS, BIDIRECTIONAL_EQUIVALENT.
 * - Cleans micro-location noise (e.g. "Mumbai (Sakinaka)", "Bengaluru, Karnataka, India (On-site)").
 */

import type { CanonicalSemanticEvidence, Directionality, EvidenceRelationship, GeographyResolutionResult, SemanticRelationship } from "../types";

interface CityAliasMapping {
  readonly canonicalCity: string;
  readonly aliases: readonly string[];
  readonly metroCluster?: string;
  readonly state: string;
  readonly country: string;
}

const CANONICAL_CITIES: readonly CityAliasMapping[] = [
  {
    canonicalCity: "BENGALURU",
    aliases: ["bangalore", "bengaluru", "electronic city", "whitefield", "koramangala", "indiranagar", "marathahalli", "bellandur", "outer ring road", "hebbal"],
    metroCluster: "BENGALURU_METRO",
    state: "KARNATAKA",
    country: "INDIA",
  },
  {
    canonicalCity: "MUMBAI",
    aliases: ["mumbai", "bombay", "sakinaka", "andheri", "bandra", "bkc", "bandra kurla complex", "lower parel", "nariman point", "powai", "worli", "mumbai suburban"],
    metroCluster: "MMR_METRO",
    state: "MAHARASHTRA",
    country: "INDIA",
  },
  {
    canonicalCity: "DELHI",
    aliases: ["delhi", "new delhi", "connaught place", "nehru place", "south delhi"],
    metroCluster: "DELHI_NCR",
    state: "DELHI",
    country: "INDIA",
  },
  {
    canonicalCity: "GURUGRAM",
    aliases: ["gurugram", "gurgaon", "cyber city", "dlf phase", "golf course road", "sohna road", "udyog vihar"],
    metroCluster: "DELHI_NCR",
    state: "HARYANA",
    country: "INDIA",
  },
  {
    canonicalCity: "NOIDA",
    aliases: ["noida", "greater noida", "noida expressway", "sector 62", "sector 125"],
    metroCluster: "DELHI_NCR",
    state: "UTTAR_PRADESH",
    country: "INDIA",
  },
  {
    canonicalCity: "FARIDABAD",
    aliases: ["faridabad"],
    metroCluster: "DELHI_NCR",
    state: "HARYANA",
    country: "INDIA",
  },
  {
    canonicalCity: "PUNE",
    aliases: ["pune", "poona", "hinjewadi", "magarpatta", "kharadi", "baner", "vimannagar"],
    metroCluster: "PUNE_METRO",
    state: "MAHARASHTRA",
    country: "INDIA",
  },
  {
    canonicalCity: "HYDERABAD",
    aliases: ["hyderabad", "secunderabad", "hitec city", "gachibowli", "madhapur", "kondapur"],
    metroCluster: "HYDERABAD_METRO",
    state: "TELANGANA",
    country: "INDIA",
  },
  {
    canonicalCity: "CHENNAI",
    aliases: ["chennai", "madras", "omr", "old mahabalipuram road", "guindy", "t nagar", "velachery"],
    metroCluster: "CHENNAI_METRO",
    state: "TAMIL_NADU",
    country: "INDIA",
  },
  {
    canonicalCity: "KOLKATA",
    aliases: ["kolkata", "calcutta", "salt lake", "new town", "sector v", "bbd bag"],
    metroCluster: "KOLKATA_METRO",
    state: "WEST_BENGAL",
    country: "INDIA",
  },
  {
    canonicalCity: "NEW_YORK_CITY",
    aliases: ["new york", "new york city", "nyc", "manhattan", "brooklyn"],
    metroCluster: "TRI_STATE_METRO",
    state: "NEW_YORK",
    country: "USA",
  },
  {
    canonicalCity: "SAN_FRANCISCO",
    aliases: ["san francisco", "sf", "sf bay area", "bay area", "silicon valley", "palo alto", "mountain view", "sunnyvale", "san jose"],
    metroCluster: "SAN_FRANCISCO_BAY_AREA",
    state: "CALIFORNIA",
    country: "USA",
  }
];

export class GeographyResolver {
  /**
   * Normalizes raw location string removing boilerplate (On-site, Hybrid, State, Country).
   */
  public static normalizeRawLocation(raw: string): string {
    return raw
      .replace(/\((?:on-site|onsite|hybrid|remote|all\s+areas)\)/gi, "")
      .replace(/,\s*(?:india|usa|united\s+states|karnataka|maharashtra|haryana|uttar\s+pradesh|tamil\s+nadu|telangana|west\s+bengal|california|new\s+york)\b/gi, "")
      .replace(/[()]/g, " ")
      .trim();
  }

  /**
   * Resolves a source location against an optional target location requirement.
   */
  public static resolve(
    sourceLocation: string,
    targetLocation?: string,
    context: string = ""
  ): GeographyResolutionResult {
    const rawSource = sourceLocation.trim();
    const rawTarget = (targetLocation || "").trim();
    const fullContext = context ? `${context} ${rawSource}` : rawSource;

    const cleanSource = this.normalizeRawLocation(rawSource).toLowerCase();
    const cleanTarget = rawTarget ? this.normalizeRawLocation(rawTarget).toLowerCase() : "";

    // Remote Check
    if (/\bremote\b/i.test(rawSource)) {
      const isIndiaRemote = /\bindia\b/i.test(rawSource) || /\banywhere\s+in\s+india\b/i.test(rawSource);
      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: isIndiaRemote ? "INDIA_REMOTE" : "GLOBAL_REMOTE",
        semanticRelationship: "SUPERTYPE",
        evidenceRelationship: "DIRECT_EQUIVALENT", // Remote satisfies geographic requirements
        direction: "TARGET_TO_SOURCE",
        isCityEquivalent: false,
        isMetroCommuteCompatible: true,
        isAdministrativeContainmentOnly: false,
        confidence: 0.98,
        evidence: {
          canonicalConcept: isIndiaRemote ? "INDIA_REMOTE" : "GLOBAL_REMOTE",
          entityType: "GEOGRAPHY",
          semanticRelationship: "SUPERTYPE",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction: "TARGET_TO_SOURCE",
          confidence: 0.98,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "DIRECT_OWNERSHIP",
        }
      };
    }

    // Find Matching City Definition for Source
    let sourceMatch: CityAliasMapping | undefined;
    for (const city of CANONICAL_CITIES) {
      if (city.aliases.some(alias => cleanSource.includes(alias) || cleanSource === alias)) {
        sourceMatch = city;
        break;
      }
    }

    // Find Matching City Definition for Target
    let targetMatch: CityAliasMapping | undefined;
    if (cleanTarget) {
      for (const city of CANONICAL_CITIES) {
        if (city.aliases.some(alias => cleanTarget.includes(alias) || cleanTarget === alias)) {
          targetMatch = city;
          break;
        }
      }
    }

    // If source is a bare state name (e.g. Karnataka, Maharashtra)
    const isStateOnly = /\b(karnataka|maharashtra|haryana|uttar\s+pradesh|tamil\s+nadu|telangana|west\s+bengal)\b/i.test(rawSource.toLowerCase()) && !sourceMatch;
    if (isStateOnly) {
      const stateName = rawSource.toUpperCase().trim();
      const isTargetContained = targetMatch && rawSource.toLowerCase().includes(targetMatch.state.toLowerCase().replace(/_/g, " "));

      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: `${stateName}_STATE`,
        semanticRelationship: "ADMINISTRATIVE_CONTAINMENT",
        evidenceRelationship: "NON_SATISFYING", // State does NOT satisfy single-city on-site
        direction: "CONTAINS",
        isCityEquivalent: false,
        isMetroCommuteCompatible: false,
        isAdministrativeContainmentOnly: true,
        confidence: 0.99,
        evidence: {
          canonicalConcept: `${stateName}_STATE`,
          entityType: "GEOGRAPHY",
          semanticRelationship: "ADMINISTRATIVE_CONTAINMENT",
          evidenceRelationship: "NON_SATISFYING",
          direction: "CONTAINS",
          confidence: 0.99,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "EXCLUDED",
        }
      };
    }

    // If no city matched
    if (!sourceMatch) {
      const fallbackCanonical = rawSource.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: fallbackCanonical,
        semanticRelationship: "LEXICAL_VARIANT",
        evidenceRelationship: "CONTEXTUAL_SUPPORT",
        direction: "NONE",
        isCityEquivalent: false,
        isMetroCommuteCompatible: false,
        isAdministrativeContainmentOnly: false,
        confidence: 0.70,
        evidence: {
          canonicalConcept: fallbackCanonical,
          entityType: "GEOGRAPHY",
          semanticRelationship: "LEXICAL_VARIANT",
          evidenceRelationship: "CONTEXTUAL_SUPPORT",
          direction: "NONE",
          confidence: 0.70,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "EXCLUDED",
        }
      };
    }

    // If there is no target requirement to evaluate against, return canonical city resolution
    if (!targetMatch && !rawTarget) {
      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: sourceMatch.canonicalCity,
        semanticRelationship: "CITY_ALIAS",
        evidenceRelationship: "DIRECT_EQUIVALENT",
        direction: "BIDIRECTIONAL_EQUIVALENT",
        isCityEquivalent: true,
        isMetroCommuteCompatible: true,
        isAdministrativeContainmentOnly: false,
        confidence: 0.99,
        evidence: {
          canonicalConcept: sourceMatch.canonicalCity,
          entityType: "GEOGRAPHY",
          semanticRelationship: "CITY_ALIAS",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          confidence: 0.99,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "DIRECT_OWNERSHIP",
        }
      };
    }

    // Check relationship between sourceMatch and targetMatch/rawTarget
    const isTargetDelhiNCR = cleanTarget.includes("ncr") || cleanTarget.includes("delhi ncr");

    // Case 1: Same Canonical City (e.g. Bangalore ↔ Bengaluru, Bombay ↔ Mumbai)
    if (targetMatch && sourceMatch.canonicalCity === targetMatch.canonicalCity) {
      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: sourceMatch.canonicalCity,
        semanticRelationship: "CITY_ALIAS",
        evidenceRelationship: "DIRECT_EQUIVALENT",
        direction: "BIDIRECTIONAL_EQUIVALENT",
        isCityEquivalent: true,
        isMetroCommuteCompatible: true,
        isAdministrativeContainmentOnly: false,
        confidence: 0.99,
        evidence: {
          canonicalConcept: sourceMatch.canonicalCity,
          entityType: "GEOGRAPHY",
          semanticRelationship: "CITY_ALIAS",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          confidence: 0.99,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "DIRECT_OWNERSHIP",
        }
      };
    }

    // Case 2: Same Metro Cluster (e.g. Gurugram -> MEMBER_OF -> Delhi NCR, Noida -> MEMBER_OF -> Delhi NCR)
    if ((isTargetDelhiNCR && sourceMatch.metroCluster === "DELHI_NCR") ||
        (targetMatch && sourceMatch.metroCluster && sourceMatch.metroCluster === targetMatch.metroCluster)) {
      const isMemberOf = sourceMatch.canonicalCity !== "DELHI_NCR";
      const direction: Directionality = isMemberOf ? "MEMBER_OF" : "BIDIRECTIONAL_EQUIVALENT";

      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: sourceMatch.metroCluster || "DELHI_NCR",
        semanticRelationship: "METRO_CLUSTER",
        evidenceRelationship: "DIRECT_EQUIVALENT", // Metro cluster satisfies regional commute policy
        direction,
        isCityEquivalent: false,
        isMetroCommuteCompatible: true,
        isAdministrativeContainmentOnly: false,
        confidence: 0.98,
        evidence: {
          canonicalConcept: sourceMatch.metroCluster || "DELHI_NCR",
          entityType: "GEOGRAPHY",
          semanticRelationship: "METRO_CLUSTER",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction,
          confidence: 0.98,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "DIRECT_OWNERSHIP",
        }
      };
    }

    // Case 3: Same State but different cities (e.g. Pune, Maharashtra vs Mumbai)
    // CRITICAL INVARIANT: Pune != Mumbai on-site
    if (targetMatch && sourceMatch.state === targetMatch.state) {
      return {
        sourceLocation: rawSource,
        targetLocation: rawTarget,
        canonicalLocation: sourceMatch.canonicalCity,
        semanticRelationship: "ADMINISTRATIVE_CONTAINMENT",
        evidenceRelationship: "NON_SATISFYING", // Fails single-city on-site requirement
        direction: "MEMBER_OF",
        isCityEquivalent: false,
        isMetroCommuteCompatible: false,
        isAdministrativeContainmentOnly: true,
        confidence: 0.98,
        evidence: {
          canonicalConcept: sourceMatch.canonicalCity,
          entityType: "GEOGRAPHY",
          semanticRelationship: "ADMINISTRATIVE_CONTAINMENT",
          evidenceRelationship: "NON_SATISFYING",
          direction: "MEMBER_OF",
          confidence: 0.98,
          sourcePhrase: rawSource,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "EXCLUDED",
        }
      };
    }

    // Case 4: Completely different geographies
    return {
      sourceLocation: rawSource,
      targetLocation: rawTarget,
      canonicalLocation: sourceMatch.canonicalCity,
      semanticRelationship: "RELATED",
      evidenceRelationship: "NON_SATISFYING",
      direction: "NONE",
      isCityEquivalent: false,
      isMetroCommuteCompatible: false,
      isAdministrativeContainmentOnly: false,
      confidence: 0.95,
      evidence: {
        canonicalConcept: sourceMatch.canonicalCity,
        entityType: "GEOGRAPHY",
        semanticRelationship: "RELATED",
        evidenceRelationship: "NON_SATISFYING",
        direction: "NONE",
        confidence: 0.95,
        sourcePhrase: rawSource,
        context: fullContext,
        negated: false,
        temporalState: "CURRENT",
        evidenceStrength: "EXCLUDED",
      }
    };
  }
}
