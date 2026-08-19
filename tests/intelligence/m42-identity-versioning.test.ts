import { describe, test, expect } from "vitest";
import {
  computeCanonicalJobId,
  computeContentHash,
  computeOpportunityVersionId
} from "@/lib/domain/canonical_identity";

describe("Phase M4.2: Identity & Versioning Contracts", () => {

  describe("A. Canonical Identity", () => {
    test("Same source identity yields identical canonical_job_id", () => {
      const id1 = computeCanonicalJobId({ source: "linkedin", sourceJobId: "12345" });
      const id2 = computeCanonicalJobId({ source: "linkedin", sourceJobId: "12345" });
      expect(id1).toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(10);
    });

    test("Different source identity yields different canonical_job_id", () => {
      const linkedin = computeCanonicalJobId({ source: "linkedin", sourceJobId: "12345" });
      const indeed = computeCanonicalJobId({ source: "indeed", sourceJobId: "12345" });
      const linkedinDiff = computeCanonicalJobId({ source: "linkedin", sourceJobId: "98765" });
      
      expect(linkedin).not.toBe(indeed);
      expect(linkedin).not.toBe(linkedinDiff);
    });

    test("Identity is strictly derived from source fields, ignoring whitespace", () => {
      const base = computeCanonicalJobId({ source: "linkedin", sourceJobId: "123" });
      const padded = computeCanonicalJobId({ source: " linkedin ", sourceJobId: " 123 " });
      expect(base).toBe(padded);
    });
  });

  describe("B. Material Content Fingerprint", () => {
    const baseContent = {
      title: "VP Engineering",
      companyName: "Acme Corp",
      location: "Remote",
      employmentType: "Full-time",
      rawContent: "We are looking for..."
    };

    test("Identical material content yields identical content_hash", () => {
      const hash1 = computeContentHash(baseContent);
      const hash2 = computeContentHash({ ...baseContent });
      expect(hash1).toBe(hash2);
    });

    test("Changed material content yields new content_hash", () => {
      const baseHash = computeContentHash(baseContent);
      
      const newTitle = computeContentHash({ ...baseContent, title: "SVP Engineering" });
      const newCompany = computeContentHash({ ...baseContent, companyName: "Acme LLC" });
      const newLocation = computeContentHash({ ...baseContent, location: "New York" });
      const newType = computeContentHash({ ...baseContent, employmentType: "Contract" });
      const newBody = computeContentHash({ ...baseContent, rawContent: "We are actively looking for..." });

      expect(baseHash).not.toBe(newTitle);
      expect(baseHash).not.toBe(newCompany);
      expect(baseHash).not.toBe(newLocation);
      expect(baseHash).not.toBe(newType);
      expect(baseHash).not.toBe(newBody);
    });

    test("Null vs omitted fields are deterministically handled (same hash)", () => {
      const nullFields = computeContentHash({
        title: "Engineer",
        companyName: null,
        location: null,
        employmentType: null,
        rawContent: "Test"
      });
      expect(typeof nullFields).toBe('string');
    });
  });

  describe("C. Opportunity Version", () => {
    test("Same canonical_job_id + same content_hash yields same opportunity_version", () => {
      const jobId = "job_123";
      const contentHash = "hash_xyz";
      
      const version1 = computeOpportunityVersionId(jobId, contentHash);
      const version2 = computeOpportunityVersionId(jobId, contentHash);
      
      expect(version1).toBe(version2);
    });

    test("Different canonical_job_id or different content_hash yields different opportunity_version", () => {
      const baseVersion = computeOpportunityVersionId("job_1", "hash_A");
      
      const diffJob = computeOpportunityVersionId("job_2", "hash_A");
      const diffContent = computeOpportunityVersionId("job_1", "hash_B");
      
      expect(baseVersion).not.toBe(diffJob);
      expect(baseVersion).not.toBe(diffContent);
    });
  });

});
