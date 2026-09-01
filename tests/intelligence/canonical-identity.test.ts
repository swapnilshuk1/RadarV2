import { describe, it, expect, beforeAll } from "vitest";
import { getRepositories } from "../../src/data/sqlite/provider";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { validateCandidateProjection } from "../../src/lib/domain/candidate_projection";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

const runLiveIdentityAudit = process.env.RADAR_RUN_LIVE_IDENTITY_TESTS === "true";

/**
 * This is an operator audit of a named live account, not a deterministic
 * certification test. It is opt-in because it reads production identity data
 * and runs migrations against the selected Turso database.
 */
describe.runIf(runLiveIdentityAudit)("Stage 2B: Canonical Identity & Candidate Projection Unification", () => {
  const repos = getRepositories();
  const db = (repos.opportunities as any).db;
  const CANONICAL_ID = "ms6i7e3y-4x0chy5fy";
  const LEGACY_ID = "swapnil-shukla";

  beforeAll(async () => {
    await runMigrations(db);
  });

  it("verifies canonical user exists with verified Google OAuth account", async () => {
    const canonicalPerson = await db.one(
      "SELECT id, email, name, email_verified, role FROM people WHERE id = ?",
      [CANONICAL_ID]
    );
    expect(canonicalPerson).not.toBeNull();
    expect(canonicalPerson.id).toBe(CANONICAL_ID);
    expect(canonicalPerson.email).toBe("swapnilshuk@gmail.com");
    expect(canonicalPerson.email_verified).toBe(1);

    const oauth = await db.many(
      "SELECT provider, provider_user_id, user_id FROM oauth_accounts WHERE user_id = ?",
      [CANONICAL_ID]
    );
    expect(oauth.length).toBe(1);
    expect(oauth[0].provider).toBe("google");
    expect(oauth[0].user_id).toBe(CANONICAL_ID);
  });

  it("verifies zero active decisions reference the legacy identity", async () => {
    const legacyDecisions = await db.many(
      "SELECT id FROM decisions WHERE person_id = ?",
      [LEGACY_ID]
    );
    expect(legacyDecisions.length).toBe(0);
  });

  it("verifies zero legacy decisions exist and canonical decisions belong strictly to canonical identity", async () => {
    const decisions = await db.many(
      "SELECT id, canonical_job_id, action FROM canonical_decisions WHERE person_id = ?",
      [CANONICAL_ID]
    );
    expect(Array.isArray(decisions)).toBe(true);

    const legacyDecisions = await db.many(
      "SELECT id FROM canonical_decisions WHERE person_id = ?",
      [LEGACY_ID]
    );
    expect(legacyDecisions.length).toBe(0);
  });

  it("verifies candidate documents and evidence graphs belong to canonical identity", async () => {
    const docs = await db.many(
      "SELECT id, filename, person_id FROM candidate_documents WHERE person_id = ?",
      [CANONICAL_ID]
    );
    expect(docs.length).toBe(2);
    for (const doc of docs) {
      expect(doc.person_id).toBe(CANONICAL_ID);
    }

    const egs = await db.many(
      "SELECT id, person_id, document_id FROM evidence_graphs WHERE person_id = ?",
      [CANONICAL_ID]
    );
    expect(egs.length).toBe(2);
    for (const eg of egs) {
      expect(eg.person_id).toBe(CANONICAL_ID);
    }
  });

  it("verifies career intent belongs to canonical identity", async () => {
    const intent = await db.one(
      "SELECT id, candidate_id, preferred_locations FROM intent WHERE candidate_id = ?",
      [CANONICAL_ID]
    );
    expect(intent).not.toBeNull();
    expect(intent.candidate_id).toBe(CANONICAL_ID);
  });

  it("verifies canonical career profile conforms 100% to V4 CandidateProjection schema", async () => {
    const profile = await db.one(
      "SELECT projection_json FROM career_profiles WHERE person_id = ?",
      [CANONICAL_ID]
    );
    expect(profile).not.toBeNull();

    const parsed = JSON.parse(profile.projection_json);
    const validation = validateCandidateProjection(parsed);
    expect(validation.valid).toBe(true);
    expect(validation.missingFields.length).toBe(0);
    expect(parsed.operatingLevel.value).toBe("STRATEGIC");
    expect(parsed.yearsOfExperience).toBe(20);
    expect(parsed.coreCapabilities.length).toBeGreaterThan(50);
  });

  it("verifies OpportunityService evaluates successfully for canonical identity", async () => {
    const opps = await OpportunityService.listForUser(CANONICAL_ID);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0]).toHaveProperty("jobHash");
    expect(opps[0]).toHaveProperty("engineRecommendation");
    expect(opps[0]).toHaveProperty("effectiveDecision");
    expect(opps[0]).toHaveProperty("decision");
  }, 30000);
});
