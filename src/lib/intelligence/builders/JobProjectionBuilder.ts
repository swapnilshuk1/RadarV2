import { JobProjection, ExecutiveIdentity, OperatingContext, TrueExecutiveMandate, CapabilityTaxonomyTier, OrganizationalIntent, ExecutiveMission } from "../../domain/job_projection";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";

export class JobProjectionBuilder {

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
    if (this.testKeyword(text, "acquisition") || this.testKeyword(text, "merger") || this.testKeyword(text, "post-merger") || this.testKeyword(text, "m&a")) {
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
    intent: OrganizationalIntent
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
      successConditions: [
        `Deliver 24-month revenue & P&L targets under ${mandate} mandate`,
        `Establish operational governance and cross-functional leadership alignment at ${company}`,
        `Build scalable GTM & customer retention infrastructure`
      ]
    };
  }

  private static assignCapabilityTier(capName: string): CapabilityTaxonomyTier {
    const nameLower = capName.toLowerCase();
    const techKeywords = ["salesforce", "ga4", "cdp", "adobe", "sap", "braze", "segment", "mixpanel", "appsflyer", "adjust", "snowflake", "redshift", "databricks", "hubspot", "klaviyo", "shopify"];
    if (techKeywords.some(t => nameLower.includes(t))) {
      return "TECHNOLOGY_STACK";
    }
    const domainKeywords = ["b2b", "d2c", "retail", "beauty", "fintech", "5g", "broadband", "mobility", "automotive", "fmcg"];
    if (domainKeywords.some(d => nameLower.includes(d))) {
      return "DOMAIN_FAMILIARITY";
    }
    const coreKeywords = ["growth", "leadership", "transformation", "p&l", "cgo", "cmo", "head", "mandate", "commercial leadership"];
    if (coreKeywords.some(c => nameLower.includes(c))) {
      return "CORE_MANDATE";
    }
    return "EXECUTION_CAPABILITY";
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

  private static buildUncached(opportunity: any): JobProjection {
    this.actualBuildCount++;
    const title = opportunity.role || "";
    let fullText = (opportunity.description || opportunity.normalizedText || opportunity.rawText || opportunity.rawDescription || "").toLowerCase();
    const fullContext = (title + "\n" + fullText);
    const titleLower = title.toLowerCase();

    const resolvedCompany = this.resolveEmployerName(opportunity.company || "", fullText);
    const trueExecutiveMandate = this.inferTrueExecutiveMandate(fullText, title);
    const organizationalIntent = this.inferOrganizationalIntent(fullText, title);
    const executiveMission = this.buildExecutiveMission(title, resolvedCompany, trueExecutiveMandate, organizationalIntent);

    // 1. Executive Identity Classification (Positive Domain Validation)
    const isExecutiveTechLeader = /(head of|director|vp|vice president|cto|cio|chief)/i.test(titleLower);

    const isTitleTechIC = (!isExecutiveTechLeader && /(\bengineer\b|\bdeveloper\b|\bprogrammer\b|\bfull stack\b|\bfrontend\b|\bbackend\b|\bcoding\b|\barchitect\b)/i.test(titleLower)) ||
                          /(\bjava\b|\bpython\b|\bnode\.?js\b|\breact\b|\bangular\b|\bc\+\+\b|\bgolang\b|\bruby\b|\bdevops\b|\bcloud engineer\b|\bdata engineer\b|\bmachine learning engineer\b|\bai engineer\b|\bsoftware\b)/i.test(titleLower);

    const isTitleTechLeadership = isExecutiveTechLeader && /(\btechnology\b|\binformation technology\b|\bit\b|\bcio\b|\bcto\b|\bengineering\b|\bsoftware\b|\bdata\b|\bdigital\b|\bai\b)/i.test(titleLower);

    const isTitleOps = this.testKeyword(titleLower, "operations") || 
                       this.testKeyword(titleLower, "supply chain") || 
                       this.testKeyword(titleLower, "logistics") || 
                       this.testKeyword(titleLower, "site strategy");

    // Role-contextual high-confidence non-commercial professional-domain vetoes
    const companyLower = (opportunity.company || "").toLowerCase();
    const hasMedicalAffairsVeto = /(\bmedical\b|\bsuperintendent\b|\bhospital\b|\bphysician\b|\bsurgeon\b|\bdoctor\b|\bnursing\b)/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);
    const hasClinicalVeto = /\bclinical\b/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);
    const hasBimVeto = /\bbim\b/i.test(titleLower);
    const hasCivilStructuralVeto = /(\bcivil\b|\bstructural\b)/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);
    const hasQualityVeto = /\bquality\b/i.test(titleLower) && !/marketing|growth|commercial/i.test(titleLower);
    const hasRecruitmentStaffingVeto = /(\brecruitment\b|\bstaffing\b)/i.test(titleLower) || 
                                       ((/managing director/i.test(titleLower) || /director/i.test(titleLower)) && (/antal|staffing|recruitment/i.test(companyLower)));
    const hasSoftwareVeto = isTitleTechIC || /(\bsoftware engineer\b|\bfull stack\b|\bfrontend\b|\bbackend\b|\bjava\b|\bpython\b|\bdeveloper\b)/i.test(titleLower);
    const hasIndustrialResinVeto = /(\bresin\b|\bpolymer\b)/i.test(titleLower) && !/marketing|growth/i.test(titleLower);
    const hasTelecomEngVeto = /\btelecom\b/i.test(titleLower) && /(\bengineer\b|\bautomation\b)/i.test(titleLower);
    const hasHeavyElectronicsVeto = /\bpower electronics\b/i.test(titleLower) && !/marketing director|cmo/i.test(titleLower);
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
    if (opportunity.dimensions && Array.isArray(opportunity.dimensions)) {
      opportunity.dimensions.forEach((dim: any) => {
        if (dim.jdEvidence && dim.jdEvidence.value) {
          let capName = String(dim.jdEvidence.value).trim();
          if (capName.startsWith("{") && capName.includes('"')) {
            try {
              const parsed = JSON.parse(capName);
              capName = String(parsed.value || parsed.canonicalValue || parsed.rawValue || capName).trim();
            } catch {}
          }
          if (capName.length > 2) {
            capabilitiesMap.set(capName.toLowerCase(), {
              name: capName,
              source: "explicit",
              confidence: 0.90
            });
          }
        }
      });
    }

    if (capabilitiesMap.size === 0) {
      const descLower = fullText;
      const keyDomainTerms = [
        "CRM Governance", "Performance Marketing", "GTM Strategy", "Revenue Operations",
        "Customer Intelligence", "Digital Transformation", "D2C Growth", "Enterprise Sales",
        "Pipeline Governance", "Site Strategy", "Investment Analytics", "Solutions Architecture"
      ];
      keyDomainTerms.forEach(term => {
        if (descLower.includes(term.toLowerCase())) {
          capabilitiesMap.set(term.toLowerCase(), {
            name: term,
            source: "inferred",
            confidence: 0.80
          });
        }
      });
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
