/**
 * EvidenceNormalizer.ts
 *
 * Deterministically cleanses, expands acronyms, and standardizes values in an EvidenceGraph.
 * Does NOT perform internal ontology mappings or drop low-confidence facts.
 */

import type { EvidenceGraph, ExtractedFact } from "../../../domain/evidence";

const ACRONYM_MAP: Record<string, string> = {
  SFMC: "Salesforce Marketing Cloud",
  SFDC: "Salesforce",
  GA4: "Google Analytics 4",
  CDP: "Customer Data Platform",
  VP: "Vice President",
  SVP: "Senior Vice President",
  AVP: "Assistant Vice President",
  CMO: "Chief Marketing Officer",
  CGO: "Chief Growth Officer",
  CCO: "Chief Commercial Officer",
  COO: "Chief Operating Officer",
  CTO: "Chief Technology Officer",
  CPO: "Chief Product Officer",
  CFO: "Chief Financial Officer",
  "P&L": "Profit and Loss",
  GCC: "Global Capability Center",
  MENA: "Middle East and North Africa",
  APAC: "Asia-Pacific",
  EMEA: "Europe, Middle East, and Africa"
};

export class EvidenceNormalizer {
  public static normalize(graph: EvidenceGraph): EvidenceGraph {
    const normalizedFacts: ExtractedFact[] = graph.facts.map((fact) => {
      let val = fact.value.trim();

      // Replace standalone acronyms
      for (const [acronym, expansion] of Object.entries(ACRONYM_MAP)) {
        const regex = new RegExp(`\\b${acronym}\\b`, "g");
        if (regex.test(val)) {
          // If the string is solely the acronym, expand it directly
          if (val.toUpperCase() === acronym) {
            val = expansion;
          } else {
            // Include expansion in parentheses if not already present
            if (!val.toLowerCase().includes(expansion.toLowerCase())) {
              val = val.replace(regex, `${expansion} (${acronym})`);
            }
          }
        }
      }

      return {
        ...fact,
        value: val
      };
    });

    return {
      ...graph,
      facts: normalizedFacts
    };
  }
}
