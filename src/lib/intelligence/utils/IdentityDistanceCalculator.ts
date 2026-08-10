import executiveOntology from "@/data/ontology/executive_ontology.json";

export class IdentityDistanceCalculator {
  public static calculate(candidateIdentity: string, jobIdentity: string, jobText?: string): number {
    const candLower = (candidateIdentity || "").toLowerCase();
    const jobLower = (jobIdentity || "").toLowerCase();
    const fullTextLower = (jobText || "").toLowerCase();

    // Map candidate string to ontology domain ID
    let candDomain = "commercial_marketing";
    if (candLower.includes("technology") || candLower.includes("engineering")) {
      candDomain = "technology_engineering";
    } else if (candLower.includes("operations") || candLower.includes("delivery")) {
      candDomain = "operations_delivery";
    } else if (candLower.includes("clinical") || candLower.includes("medical")) {
      candDomain = "clinical_medical";
    }

    // Map job string to ontology domain ID
    let jobDomain = "commercial_marketing";
    if (
      jobLower.includes("technology") || 
      jobLower.includes("information technology") || 
      jobLower.includes("it head") || 
      jobLower.includes("head of it") || 
      jobLower.includes("head - it") || 
      jobLower.includes("it director") || 
      jobLower.includes("cio") || 
      jobLower.includes("cto") || 
      jobLower.includes("engineering") || 
      fullTextLower.includes("salesforce architect") || 
      fullTextLower.includes("quote-to-cash")
    ) {
      jobDomain = "technology_engineering";
    } else if (jobLower.includes("operational excellence") || jobLower.includes("delivery management") || fullTextLower.includes("programme delivery") || fullTextLower.includes("shared services")) {
      jobDomain = "operations_delivery";
    } else if (jobLower.includes("clinical") || jobLower.includes("medical")) {
      jobDomain = "clinical_medical";
    }

    // Cross-Domain Hard Distance
    if (candDomain !== jobDomain) {
      // Check Hybrid Bridges in ESG
      const bridges = (executiveOntology as any).hybridBridges || [];
      const bridge = bridges.find((b: any) => b.domains.includes(candDomain) && b.domains.includes(jobDomain));
      if (bridge && (fullTextLower.includes("martech") || fullTextLower.includes("digital marketing") || fullTextLower.includes("customer experience"))) {
        return bridge.effectiveDistanceOffset || 0.40;
      }
      return 0.85;
    }

    // Intra-Domain Shortest Path Discipline Distance
    if (candLower.includes("brand") && jobLower.includes("performance")) {
      return 0.18; // Discipline path cost between Brand & Performance Marketing
    }
    if (candLower.includes("performance") && jobLower.includes("crm")) {
      return 0.12; // Discipline path cost between Performance & CRM
    }

    return 0.00;
  }
}
