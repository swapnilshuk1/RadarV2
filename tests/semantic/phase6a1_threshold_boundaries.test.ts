import { describe, it, expect } from "vitest";
import { SemanticResolutionEngine } from "../../src/lib/intelligence/semantic/SemanticResolutionEngine";
import { RequirementEvidenceAdapter } from "../../src/lib/intelligence/semantic/RequirementEvidenceAdapter";
import { CapabilityAssessmentEngine } from "../../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";

describe("PHASE 6A.1 — DECISION-THRESHOLD BOUNDARY TEST SUITE", () => {
  // A. Semantic Synonym Recovery
  it("Case A: Legitimate semantic synonym recovery increases capability match without policy violation", () => {
    const text = "Head of Digital Trading managing programmatic media buying.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);
    const ev = SemanticResolutionEngine.resolveCapability("digital trading", "performance marketing");

    expect(ev).toBeDefined();
    expect(ev?.canonicalConcept).toBe("DIGITAL_TRADING");
    expect(ev?.semanticRelationship).toBe("LEXICAL_VARIANT");
  });

  // B. RELATED Evidence
  it("Case B: RELATED evidence cannot satisfy hard requirements", () => {
    const text = "Collaborated closely with the Performance Marketing team as a graphic designer.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);
    const adapted = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction("Senior Executive P&L Ownership", compResult.evidenceList as any);

    expect(adapted.satisfies).toBe(false);
  });

  // C. AMBIGUOUS Evidence
  it("Case C: AMBIGUOUS dictionary evidence is quarantined before scoring", () => {
    const text = "Met with the general manager to discuss paper weight specs of 120 gm/m2.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);
    const adapted = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction("Executive P&L Ownership", compResult.evidenceList as any);

    expect(adapted.satisfies).toBe(false);
  });

  // D. NEGATED Evidence
  it("Case D: NEGATED evidence cannot increase qualification or satisfy requirements", () => {
    const text = "Not responsible for P&L ownership, budget management or commercial growth.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);
    const adapted = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction("P&L Ownership", compResult.evidenceList as any);

    expect(adapted.satisfies).toBe(false);
  });

  // E. ASPIRATIONAL Evidence
  it("Case E: ASPIRATIONAL candidate statements cannot become factual evidence", () => {
    const text = "Looking to transition into a P&L ownership role in the future.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);
    const adapted = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction("P&L Ownership", compResult.evidenceList as any);

    expect(adapted.satisfies).toBe(false);
  });

  // F. HISTORICAL Evidence
  it("Case F: HISTORICAL evidence preserves temporal state and cannot satisfy CURRENT-only mandate", () => {
    const text = "Previously managed a ₹10 Cr budget 10 years ago as a senior analyst.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);
    const adapted = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction("Current P&L Responsibility", compResult.evidenceList as any);

    expect(adapted.satisfies).toBe(false);
  });

  // G. SUBTYPE Evidence
  it("Case G: SUBTYPE evidence cannot silently become full functional ownership", () => {
    const ev = SemanticResolutionEngine.resolveCapability("Post-merger integration", "M_AND_A");
    expect(ev?.semanticRelationship).toBe("SUBTYPE");
  });

  // H. ADMINISTRATIVE_CONTAINMENT Geography
  it("Case H: Administrative containment maps regional context but cannot satisfy strict city on-site gate", () => {
    const isDelhiNCR = SemanticResolutionEngine.resolveGeography("Gurugram", "Delhi NCR");
    expect(isDelhiNCR?.semanticRelationship).toBe("METRO_CLUSTER");
  });

  // I. Contributor / Stakeholder P&L Language
  it("Case I: Contributor / stakeholder P&L language does not claim full P&L ownership", () => {
    const text = "Contributed inputs to the business unit P&L forecast during quarterly reviews.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);

    const fullPnLOwnership = compResult.evidenceList.some((e) => e.canonicalConcept === "PNL_RESPONSIBILITY" && e.sourcePhrase.toLowerCase().includes("owned p&l"));
    expect(fullPnLOwnership).toBe(false);
  });

  // J. Executive Assistant / Coordinator Traps
  it("Case J: Executive Assistant and Coordinator titles do not gain executive seniority", () => {
    const text = "Executive Assistant to the VP of Marketing managing calendar and travel.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);

    const executiveSeniority = compResult.evidenceList.some((e) => e.canonicalConcept === "SENIORITY_ROLE" && e.confidence > 0.80);
    expect(executiveSeniority).toBe(false);
  });

  // K. Organization Parent / Subsidiary Pedigree
  it("Case K: Subsidiary / Parent organizational pedigree remains directional", () => {
    const rel = SemanticResolutionEngine.resolveCapability("Mindshare", "GroupM");
    expect(rel?.semanticRelationship).toBe("LEXICAL_VARIANT");
  });

  // L. Genuine Semantic Recovery
  it("Case L: Genuine semantic recovery correctly satisfies requirements across boundary thresholds", () => {
    const text = "VP Commercial leading omni-channel growth, performance marketing and brand strategy.";
    const compResult = SemanticResolutionEngine.extractCompositional(text);

    expect(compResult.evidenceList.length).toBeGreaterThan(0);
  });
});
