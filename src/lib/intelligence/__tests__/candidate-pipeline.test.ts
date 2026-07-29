import { IdentityEngine } from "../identity-engine";
import { 
  type ExtractedFact, 
  type UserSession, 
  type CareerIntentSession, 
  type EvidenceSource 
} from "../../types/candidate";
import fs from "fs";
import path from "path";

describe("Candidate Intelligence Pipeline (CIP) - Unit Test", () => {
  const testSession: UserSession = {
    userId: "test-user-id",
    email: "test@example.com",
    name: "Dr. Rachel Green",
    onboarded: true
  };

  const testIntent: CareerIntentSession = {
    sessionId: "test-intent-1",
    targetRoles: [
      { title: "VP Product", priorityMultiplier: 1.0 },
      { title: "Chief Growth Officer", priorityMultiplier: 0.9 }
    ],
    locations: ["New York", "Remote"],
    workModel: "Remote",
    maxMonthlyPursuits: 5,
    isActive: true
  };

  const testSources: EvidenceSource[] = [
    {
      id: "source-test-resume",
      type: "Resume",
      name: "Rachel_Green_CV.txt",
      verbatimText: "Rachel Green led a 30-member growth team and scaling salesforce across APAC markets.",
      uploadedAt: new Date().toISOString()
    }
  ];

  const testFacts: ExtractedFact[] = [
    {
      id: "fact-test-1",
      evidenceId: "source-test-resume",
      verbatimQuote: "led a 30-member growth team",
      subject: "People Leadership",
      predicate: "Led a cross-functional 30-member global growth team",
      confidence: 0.98
    },
    {
      id: "fact-test-2",
      evidenceId: "source-test-resume",
      verbatimQuote: "scaling salesforce across APAC",
      subject: "CRM Transformation",
      predicate: "Migrated legacy CRMs to Salesforce APAC, improving efficiency by 40%",
      confidence: 0.95
    }
  ];

  it("should compile raw facts into structured claims and emergent identity", () => {
    const compiled = IdentityEngine.compile(
      testSession,
      testSources,
      testFacts,
      testIntent
    );

    // Verify structure
    expect(compiled.session?.name).toBe("Dr. Rachel Green");
    expect(compiled.version).toBe("1.0.0");
    expect(compiled.facts.length).toBe(2);
    expect(compiled.claims.length).toBe(2);
    
    // Verify emergent themes and archetype synthesis
    expect(compiled.identity.identity.archetype).toBe("Commercial Growth Leader");
    expect(compiled.identity.leadership.largestTeam).toBe(30);
    expect(compiled.identity.leadership.boardExposure).toBe(false);
    expect(compiled.identity.identityConfidence).toBeGreaterThan(70);

    // Verify backward compatibility evidence format
    expect(compiled.identity.evidence.length).toBe(2);
    expect(compiled.identity.evidence[0].type).toBeDefined();
    expect(compiled.identity.evidence[0].proof).toBeDefined();
  });

});
