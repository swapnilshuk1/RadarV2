import { JobProjection, ProjectedCapability, ExecutiveIdentity, OperatingContext } from "../../domain/job_projection";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import executiveOntology from "@/data/ontology/executive_ontology.json";

export class JobProjectionBuilder {
  
  private static segmentDocument(opportunity: any): Record<string, string> {
    const text = opportunity.description || opportunity.normalizedText || "";
    return {
      TITLE: opportunity.role || "",
      SUMMARY: "",
      RESPONSIBILITIES: text,
      REQUIREMENTS: "",
      COMPANY: opportunity.company || "",
      BENEFITS: ""
    };
  }

  private static testKeyword(text: string, kw: string): boolean {
    if (!kw) return false;
    return new RegExp("\\b" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text);
  }

  public static build(opportunity: any): JobProjection {
    const title = opportunity.role || "";
    const fullText = (opportunity.description || opportunity.normalizedText || "").toLowerCase();
    const fullContext = (title + "\n" + fullText);
    const titleLower = title.toLowerCase();

    // 1. Executive Identity Classification from ESG (Title + Body Signal Weighting)
    let primaryIdentity = "Commercial & Marketing Leadership";
    let identityConf = 0.85;

    // Technical / Product triggers in Title or Body
    const isTitleTech = this.testKeyword(titleLower, "technology") || 
                        this.testKeyword(titleLower, "cto") || 
                        this.testKeyword(titleLower, "engineering") || 
                        this.testKeyword(titleLower, "architect") || 
                        this.testKeyword(titleLower, "product manager") || 
                        this.testKeyword(titleLower, "group product manager") || 
                        this.testKeyword(titleLower, "gpm") || 
                        this.testKeyword(titleLower, "gen ai") || 
                        this.testKeyword(titleLower, "agentic");

    const isBodyTech = this.testKeyword(fullText, "salesforce architect") || 
                       this.testKeyword(fullText, "software architect") || 
                       this.testKeyword(fullText, "quote-to-cash") || 
                       (this.testKeyword(fullText, "apex") && this.testKeyword(fullText, "lwc"));

    const isTitleOps = this.testKeyword(titleLower, "operations") || 
                       this.testKeyword(titleLower, "delivery") || 
                       this.testKeyword(titleLower, "coo");

    const isBodyOps = this.testKeyword(fullText, "substations") || 
                      this.testKeyword(fullText, "transmission business") || 
                      this.testKeyword(fullText, "epc projects") || 
                      this.testKeyword(fullText, "power transmission");

    if (isTitleTech || isBodyTech) {
      primaryIdentity = "Technology & Engineering Leadership";
      identityConf = 0.90;
    } else if (isTitleOps || isBodyOps) {
      primaryIdentity = "Operations & Delivery Leadership";
      identityConf = 0.90;
    } else if (this.testKeyword(titleLower, "clinical") || this.testKeyword(titleLower, "medical")) {
      primaryIdentity = "Clinical & Medical Leadership";
      identityConf = 0.95;
    } else if (this.testKeyword(titleLower, "marketing") || this.testKeyword(titleLower, "cmo") || this.testKeyword(titleLower, "sales") || this.testKeyword(titleLower, "commercial")) {
      primaryIdentity = "Commercial & Marketing Leadership";
      identityConf = 0.90;
    }

    const executiveIdentity: ExecutiveIdentity = {
      value: primaryIdentity,
      confidence: identityConf,
      evidence: [`Primary classification from title/body and ESG graph`]
    };

    // 2. Deterministic Capability & Platform Extraction from ESG
    const capabilitiesMap = new Map<string, ProjectedCapability>();

    // Structured scraper metadata extraction
    if (Array.isArray(opportunity.dimensions)) {
      opportunity.dimensions.forEach((dim: any) => {
        if (dim.key === "technologyStack" || dim.key === "functionalScope" || dim.key === "mandate" || dim.key === "requiredCapabilities") {
          const val = dim.jdEvidence?.value;
          if (typeof val === "string" && val.trim().length > 0 && val.trim().length < 80) {
            capabilitiesMap.set(val.trim(), {
              name: val.trim(),
              source: "explicit",
              confidence: 0.95,
              evidence: ["Structured scraper evidence"]
            });
          }
        }
      });
    }

    // Traverse Executive Semantic Graph for deterministic keyword extraction
    const esg = executiveOntology as any;
    if (Array.isArray(esg.domains)) {
      esg.domains.forEach((dom: any) => {
        if (Array.isArray(dom.disciplines)) {
          dom.disciplines.forEach((disc: any) => {
            // Capabilities
            if (Array.isArray(disc.capabilities)) {
              disc.capabilities.forEach((cap: any) => {
                if (Array.isArray(cap.keywords) && cap.keywords.some((kw: string) => this.testKeyword(fullContext, kw))) {
                  if (!capabilitiesMap.has(cap.name)) {
                    capabilitiesMap.set(cap.name, {
                      name: cap.name,
                      source: "explicit",
                      confidence: 0.90,
                      evidence: ["Explicitly observed in JD text match"]
                    });
                  }
                }
              });
            }
            // Disambiguated Platforms
            if (Array.isArray(disc.platforms)) {
              disc.platforms.forEach((plat: any) => {
                if (Array.isArray(plat.keywords) && plat.keywords.some((kw: string) => this.testKeyword(fullContext, kw))) {
                  if (!capabilitiesMap.has(plat.product)) {
                    capabilitiesMap.set(plat.product, {
                      name: plat.product,
                      source: "explicit",
                      confidence: 0.95,
                      evidence: [`Observed product platform: ${plat.vendor} ${plat.product}`]
                    });
                  }
                }
              });
            }
          });
        }
      });
    }

    const capabilities = Array.from(capabilitiesMap.values());
    const capabilityExtractionStatus = capabilities.length === 0 ? "FAILED" : "COMPLETE";

    // 3. Theme Dimensions
    const executiveFunction = new Set<string>();
    const businessObjectives = new Set<string>();
    const executionStyle = new Set<string>();

    if (this.testKeyword(titleLower, "marketing") || this.testKeyword(titleLower, "sales") || this.testKeyword(titleLower, "commercial")) {
      executiveFunction.add("Commercial & Marketing");
    } else if (this.testKeyword(titleLower, "technology") || this.testKeyword(titleLower, "it") || this.testKeyword(titleLower, "architect") || isTitleTech) {
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

    // 4. Factual Operating Context & Structural Metadata
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

    // Standard Semantic Classifiers
    const operatingLevel = OperatingLevelClassifier.classify(fullContext, title);
    const workNature = WorkNatureClassifier.classify(fullContext, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(fullContext, title);
    const commercialScope = CommercialScopeClassifier.classify(fullContext, title);

    return {
      jobHash: opportunity.jobHash || "",
      role: title,
      company: opportunity.company || "",
      executiveIdentity,
      operatingLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      capabilities,
      executiveFunction: Array.from(executiveFunction),
      businessObjectives: Array.from(businessObjectives),
      executionStyle: Array.from(executionStyle),
      operatingContext,
      location: opportunity.location || "",
      workModel,
      capabilityExtractionStatus,
      originalOpportunity: opportunity
    };
  }
}
