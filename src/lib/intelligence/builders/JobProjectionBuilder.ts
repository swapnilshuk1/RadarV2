// src/lib/intelligence/builders/JobProjectionBuilder.ts

import { JobProjection } from "../../domain/job_projection";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import capabilityRules from '@/data/ontology/capability_rules.json';

export class JobProjectionBuilder {
  private static extractTextFromOpportunity(opportunity: any): string {
    const parts: string[] = [];
    
    if (opportunity.role) parts.push(opportunity.role);
    if (opportunity.company) parts.push(opportunity.company);
    if (opportunity.location) parts.push(opportunity.location);
    if (opportunity.normalizedText) parts.push(opportunity.normalizedText);
    if (opportunity.description) parts.push(opportunity.description);
    if (opportunity.primaryConcern?.jdQuote) parts.push(opportunity.primaryConcern.jdQuote);

    if (Array.isArray(opportunity.dimensions)) {
      opportunity.dimensions.forEach((dim: any) => {
        if (dim.jdEvidence) {
          if (dim.jdEvidence.value) parts.push(dim.jdEvidence.value);
          if (Array.isArray(dim.jdEvidence.evidence)) {
            dim.jdEvidence.evidence.forEach((ev: any) => {
              if (ev.quote) parts.push(ev.quote);
            });
          }
        }
      });
    }

    return parts.join("\n");
  }

  public static build(opportunity: any): JobProjection {
    const title = opportunity.role || "";
    const desc = this.extractTextFromOpportunity(opportunity);

    // Run our classifiers
    const operatingLevel = OperatingLevelClassifier.classify(desc, title);
    const workNature = WorkNatureClassifier.classify(desc, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(desc, title);
    const commercialScope = CommercialScopeClassifier.classify(desc, title);

    // Extract required capabilities
    const rawCapabilities: string[] = [];
    if (Array.isArray(opportunity.dimensions)) {
      opportunity.dimensions.forEach((dim: any) => {
        if (dim.key === "technologyStack" || dim.key === "functionalScope" || dim.key === "mandate" || dim.key === "requiredCapabilities") {
          const val = dim.jdEvidence?.value;
          if (val) rawCapabilities.push(val);
          if (Array.isArray(dim.jdEvidence?.evidence)) {
            dim.jdEvidence.evidence.forEach((ev: any) => {
              if (ev.quote) rawCapabilities.push(ev.quote);
            });
          }
        }
      });
    }

    // Sanitize stringified JSON leaks and extract clean capability names
    const requiredCapabilities: string[] = [];
    rawCapabilities.forEach((item) => {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            const parsed = JSON.parse(trimmed);
            const clean = parsed.rawValue || parsed.value || parsed.canonicalValue?.products?.[0];
            if (clean && typeof clean === "string") requiredCapabilities.push(clean);
          } catch {
            // Ignore malformed JSON string
          }
        } else if (trimmed.length > 0 && trimmed.length < 80) {
          requiredCapabilities.push(trimmed);
        }
      }
    });

    // Extract keyword-based capabilities dynamically from capability_rules.json
    const fullTextForCaps = (title + "\n" + desc).toLowerCase();
    if (Array.isArray(capabilityRules)) {
      capabilityRules.forEach((rule: any) => {
        if (Array.isArray(rule.keywords) && rule.keywords.some((kw: string) => fullTextForCaps.includes(kw.toLowerCase()))) {
          requiredCapabilities.push(rule.canonicalCapability);
        }
      });
    }

    const capabilityExtractionStatus = requiredCapabilities.length === 0 ? "FAILED" : "COMPLETE";

    // Extract canonical theme IDs using robust, deterministic keyword matching
    const executiveThemes: string[] = [];
    const fullText = (title + "\n" + desc).toLowerCase();

    if (
      fullText.includes("marketing") ||
      fullText.includes("growth") ||
      fullText.includes("demand") ||
      fullText.includes("sales") ||
      fullText.includes("acquisition") ||
      fullText.includes("brand") ||
      fullText.includes("cmo") ||
      fullText.includes("revenue") ||
      fullText.includes("commercial")
    ) {
      executiveThemes.push("theme_growth", "theme_commercial", "theme_customer");
    }

    if (
      fullText.includes("transformation") ||
      fullText.includes("digital") ||
      fullText.includes("strategy") ||
      fullText.includes("coe") ||
      fullText.includes("gcc") ||
      fullText.includes("platforms") ||
      fullText.includes("cloud")
    ) {
      executiveThemes.push("theme_transformation", "theme_digital");
    }

    if (
      fullText.includes("cio") ||
      fullText.includes("it") ||
      fullText.includes("infrastructure") ||
      fullText.includes("risk") ||
      fullText.includes("governance") ||
      fullText.includes("security") ||
      fullText.includes("architecture") ||
      fullText.includes("cybersecurity") ||
      fullText.includes("cto") ||
      fullText.includes("tech")
    ) {
      executiveThemes.push("theme_technology", "theme_operations");
    }

    if (
      fullText.includes("finance") ||
      fullText.includes("cfo") ||
      fullText.includes("budget") ||
      fullText.includes("p&l") ||
      fullText.includes("accounts") ||
      fullText.includes("treasury")
    ) {
      executiveThemes.push("theme_finance");
    }

    if (
      fullText.includes("hr") ||
      fullText.includes("people") ||
      fullText.includes("talent") ||
      fullText.includes("culture") ||
      fullText.includes("recruitment") ||
      fullText.includes("human resources")
    ) {
      executiveThemes.push("theme_hr");
    }

    // Determine work model
    let workModel: "HYBRID" | "REMOTE" | "ON_SITE" | "UNKNOWN" = "UNKNOWN";
    if (Array.isArray(opportunity.dimensions)) {
      const wmDim = opportunity.dimensions.find((dim: any) => dim.key === "workModel");
      const wmVal = (wmDim?.jdEvidence?.value || "").toLowerCase();
      if (wmVal.includes("hybrid") || wmVal.includes("flexible")) {
        workModel = "HYBRID";
      } else if (wmVal.includes("remote")) {
        workModel = "REMOTE";
      } else if (wmVal.includes("on-site") || wmVal.includes("office")) {
        workModel = "ON_SITE";
      }
    }

    return {
      jobHash: opportunity.jobHash || "",
      role: opportunity.role || "",
      company: opportunity.company || "",
      operatingLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      requiredCapabilities: Array.from(new Set(requiredCapabilities)),
      location: opportunity.location || "",
      workModel,
      executiveThemes: Array.from(new Set(executiveThemes)),
      capabilityExtractionStatus,
      originalOpportunity: opportunity
    };
  }
}
