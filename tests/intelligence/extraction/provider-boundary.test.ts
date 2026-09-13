import { describe, expect, it } from "vitest";
import {
  DeterministicCandidateProofProvider,
  DeterministicRoleIntelligenceProvider,
} from "../../../src/lib/intelligence/extraction/DeterministicExtractionProviderAdapters";
import {
  createProviderCacheIdentity,
  type LlmRoleIntelligenceExtractionProvider,
} from "../../../src/lib/intelligence/extraction/ExtractionProvider";
import {
  MechanicalExtractionVerificationError,
  MechanicalExtractionVerifier,
} from "../../../src/lib/intelligence/extraction/MechanicalExtractionVerifier";
import { VerifiedExtractionProviderRunner } from "../../../src/lib/intelligence/extraction/VerifiedExtractionProviderRunner";
import { CandidateProofExtractorV1 } from "../../../src/lib/intelligence/extraction/CandidateProofExtractorV1";
import { RoleIntelligenceExtractorV1 } from "../../../src/lib/intelligence/extraction/RoleIntelligenceExtractorV1";
import { computeContentHash } from "../../../src/lib/domain/canonical_identity";
import type {
  CandidateDocumentSourceRef,
  OpportunityVersionSourceRef,
} from "../../../src/lib/domain/source_provenance";
import type { DatabaseAdapter } from "../../../src/data/database/adapter";
import {
  SourceSnapshotIdentityMismatchError,
  SourceSnapshotResolver,
  type ResolvedSourceSnapshot,
} from "../../../src/lib/provenance/SourceSnapshotResolver";

const roleText = "Key Responsibilities\nOwn pricing governance across channel expansion.";
const candidateText = [
  "# Candidate",
  "## PROFESSIONAL EXPERIENCE",
  "### Commercial Director | Acme | 2020–Present",
  "- Led pricing governance across regional markets.",
].join("\n");

const roleSource: OpportunityVersionSourceRef = {
  kind: "OPPORTUNITY_VERSION",
  canonicalJobId: "job-canonical-1",
  opportunityVersion: "opp-version-1",
  contentHash: "canonical-content-hash",
  sourcePayloadKey: null,
  sourcePayloadSha256: null,
};
const candidateSource: CandidateDocumentSourceRef = {
  kind: "CANDIDATE_DOCUMENT_TEXT",
  personId: "person-1",
  documentId: "candidate-document-1",
  documentHash: "document-hash",
  textHash: "text-hash",
};

function textSnapshot(
  ref: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
  text: string,
): ResolvedSourceSnapshot {
  return {
    ref,
    storage: "DATABASE_TEXT",
    mediaType: "text/plain; charset=utf-8",
    bytes: Buffer.from(text, "utf8"),
    text,
  };
}

describe("extraction provider boundary and mechanical verifier", () => {
  const verifier = new MechanicalExtractionVerifier();

  it("reproduces the frozen deterministic role extractor without semantic drift", async () => {
    const direct = new RoleIntelligenceExtractorV1().extract({
      caseId: "case-1",
      canonicalJobId: roleSource.canonicalJobId,
      rawText: roleText,
    });
    const adapted = await new DeterministicRoleIntelligenceProvider().extract({
      source: roleSource,
      sourceText: roleText,
      caseId: "case-1",
    });

    expect(adapted.output).toEqual(direct);
    expect(verifier.verifyRole(roleSource, textSnapshot(roleSource, roleText), adapted.output)).toBe(adapted.output);
  });

  it("reproduces the frozen deterministic candidate extractor without semantic drift", async () => {
    const direct = new CandidateProofExtractorV1().extract({
      sourceDocumentId: candidateSource.documentId,
      rawText: candidateText,
    });
    const adapted = await new DeterministicCandidateProofProvider().extract({
      source: candidateSource,
      sourceText: candidateText,
    });

    expect(adapted.output).toEqual(direct);
    expect(verifier.verifyCandidate(candidateSource, textSnapshot(candidateSource, candidateText), adapted.output)).toBe(adapted.output);
  });

  it("binds cache identity to immutable source identity and provider configuration", () => {
    const stable = createProviderCacheIdentity(roleSource, {
      family: "DETERMINISTIC",
      providerId: "provider-a",
      schemaVersion: "role-intelligence/v1",
      configurationFingerprint: "config-a",
    });
    const changedConfig = createProviderCacheIdentity(roleSource, {
      family: "DETERMINISTIC",
      providerId: "provider-a",
      schemaVersion: "role-intelligence/v1",
      configurationFingerprint: "config-b",
    });
    const changedVersion = createProviderCacheIdentity(
      { ...roleSource, opportunityVersion: "opp-version-2" },
      {
        family: "DETERMINISTIC",
        providerId: "provider-a",
        schemaVersion: "role-intelligence/v1",
        configurationFingerprint: "config-a",
      },
    );

    expect(stable.key).not.toBe(changedConfig.key);
    expect(stable.key).not.toBe(changedVersion.key);
  });

  it("cannot execute a provider through the shared runner after Batch 01 source identity changes", async () => {
    let rawContent = roleText;
    const canonicalJobId = "job-canonical-runner";
    const opportunityVersion = "opp-version-runner";
    const contentHash = computeContentHash({
      title: "Commercial Director",
      companyName: "Acme",
      location: "Delhi",
      employmentType: "FULL_TIME",
      rawContent,
    });
    const db = {
      one: async () => ({
        id: opportunityVersion,
        canonical_job_id: canonicalJobId,
        content_hash: contentHash,
        job_title: "Commercial Director",
        company_name: "Acme",
        location: "Delhi",
        employment_type: "FULL_TIME",
        raw_content: rawContent,
        source_payload_key: null,
        source_media_type: null,
      }),
    } as unknown as DatabaseAdapter;
    const resolver = new SourceSnapshotResolver(db);
    const source = await resolver.captureOpportunityVersionRef(canonicalJobId, opportunityVersion);
    const runner = new VerifiedExtractionProviderRunner(resolver);

    await expect(runner.runRole(new DeterministicRoleIntelligenceProvider(), {
      source,
      caseId: "runner-case",
    })).resolves.toMatchObject({ source });

    rawContent = rawContent.replace("Own", "Lead");
    await expect(runner.runRole(new DeterministicRoleIntelligenceProvider(), {
      source,
      caseId: "runner-case",
    })).rejects.toBeInstanceOf(SourceSnapshotIdentityMismatchError);
  });

  it("fails closed for a source reference or exact span that cannot resolve against the immutable snapshot", () => {
    const output = new RoleIntelligenceExtractorV1().extract({
      caseId: "case-1",
      canonicalJobId: roleSource.canonicalJobId,
      rawText: roleText,
    });
    expect(() => verifier.verifyRole(roleSource, textSnapshot({ ...roleSource, contentHash: "other" }, roleText), output))
      .toThrow(MechanicalExtractionVerificationError);
    const alteredText = roleText.replace("Own", "Lead");
    expect(() => verifier.verifyRole(roleSource, textSnapshot(roleSource, alteredText), {
      ...output,
      rawTextLength: alteredText.length,
    })).toThrow(MechanicalExtractionVerificationError);
  });

  it("fails closed for invalid ontology values and duplicate provider output", () => {
    const output = new RoleIntelligenceExtractorV1().extract({
      caseId: "case-1",
      canonicalJobId: roleSource.canonicalJobId,
      rawText: roleText,
    });
    const atom = output.atoms[0]!;
    expect(() => verifier.verifyRole(roleSource, textSnapshot(roleSource, roleText), {
      ...output,
      atoms: [{ ...atom, semanticType: "NOT_A_ROLE_TYPE" as never }],
    })).toThrow(MechanicalExtractionVerificationError);
    expect(() => verifier.verifyRole(roleSource, textSnapshot(roleSource, roleText), {
      ...output,
      atoms: [atom, { ...atom, id: `${atom.id}:duplicate` }],
    })).toThrow(MechanicalExtractionVerificationError);
  });

  it("rejects malformed deterministic metric normalization instead of repairing it", () => {
    const text = "Led pricing governance and grew revenue by 20%.";
    const claim = {
      claimId: "claim:candidate-document-1:0_45:OUTCOME",
      sourceDocumentId: candidateSource.documentId,
      parentBulletExactText: text,
      parentBulletStartOffset: 0,
      parentBulletEndOffset: text.length,
      exactText: text,
      startOffset: 0,
      endOffset: text.length,
      evidenceClass: "WORK_HISTORY" as const,
      proofTypes: ["OUTCOME" as const],
      groundedEntities: [],
      metrics: [{
        exactText: "20%",
        startOffset: text.indexOf("20%"),
        endOffset: text.indexOf("20%") + 3,
        metricType: "PERCENTAGE_CHANGE" as const,
        rawValue: "20%",
        normalizedValue: Number.NaN,
        comparator: "EXACT" as const,
      }],
    };
    const output = {
      sourceDocumentId: candidateSource.documentId,
      rawDocumentLength: text.length,
      positions: [],
      selfSummaries: [],
      capabilityLabels: [],
      education: [],
      allBullets: [{
        bulletId: "bullet:synthetic:0_45",
        exactText: text,
        startOffset: 0,
        endOffset: text.length,
        claims: [claim],
      }],
      allClaims: [claim],
      metadata: {
        extractorVersion: "CandidateProofExtractorV1" as const,
        totalProfessionalExperienceBullets: 1,
        bulletsRetained: 1,
        bulletsWithSpecializedClaims: 1,
        bulletsWithoutSpecializedClaims: 0,
        proposalCounts: { proposedClaims: 1, acceptedClaims: 1, rejectedClaims: 0 },
      },
    };

    expect(() => verifier.verifyCandidate(candidateSource, textSnapshot(candidateSource, text), output))
      .toThrow(MechanicalExtractionVerificationError);
  });

  it("requires allClaims to be the exact unique union of child, summary, and capability claims", () => {
    const output = new CandidateProofExtractorV1().extract({
      sourceDocumentId: candidateSource.documentId,
      rawText: candidateText,
    });
    const claim = output.allClaims[0];
    expect(claim).toBeDefined();
    expect(() => verifier.verifyCandidate(candidateSource, textSnapshot(candidateSource, candidateText), {
      ...output,
      allClaims: [claim!, claim!],
    })).toThrow(MechanicalExtractionVerificationError);
  });

  it("requires proposal accounting to reconcile exactly", () => {
    const output = new RoleIntelligenceExtractorV1().extract({
      caseId: "case-1",
      canonicalJobId: roleSource.canonicalJobId,
      rawText: roleText,
    });
    expect(() => verifier.verifyRole(roleSource, textSnapshot(roleSource, roleText), {
      ...output,
      metadata: {
        ...output.metadata,
        proposalCounts: {
          ...output.metadata.proposalCounts,
          proposedAtoms: output.metadata.proposalCounts.proposedAtoms + 1,
        },
      },
    })).toThrow(MechanicalExtractionVerificationError);
  });

  it("keeps the LLM path as a contract only, not a Batch 02 implementation", () => {
    const consumesContract = (_provider: LlmRoleIntelligenceExtractionProvider): void => undefined;
    expect(consumesContract).toBeTypeOf("function");
  });
});
