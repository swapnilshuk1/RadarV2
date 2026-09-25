import { describe, expect, it } from "vitest";
import { syncCanonicalCandidateProjection } from "../../src/lib/intelligence/candidate-sync";

describe("static candidate profile authority boundary", () => {
  it("refuses to create an authoritative projection from the implicit static profile", async () => {
    await expect(syncCanonicalCandidateProjection("person-1")).rejects.toThrow(
      "STATIC_CANDIDATE_PROFILE_SYNC_DISABLED",
    );
  });
});
