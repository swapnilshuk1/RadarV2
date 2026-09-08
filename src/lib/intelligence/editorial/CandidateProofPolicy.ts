export type GroundedCandidateProof = {
  headline: string;
  detail: string;
};

const ACTION_VERB =
  /\b(?:led|built|launched|scaled|grew|drove|delivered|owned|managed|created|established|expanded|improved|increased|reduced|transformed|executed|developed|directed|achieved|generated|orchestrated|implemented|ran|headed|pioneered)\b/i;

const KNOWN_LABEL_ONLY =
  /^(?:marketing|marketing strategy|strategy|growth|commercial leadership|commercial strategy|enterprise|enterprise p&l ownership|board decision authority|decision authority|operations|client services|influencer marketing|performance marketing)$/i;

export function substantiveCandidateEvidence(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;

  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const tokens = text.split(/\s+/).filter(Boolean);

  // A proof point is a candidate experience statement, not a taxonomy label.
  if (text.length < 28) return null;
  if (tokens.length < 4) return null;
  if (KNOWN_LABEL_ONLY.test(text)) return null;

  // Reject known classifier/taxonomy composites when they are not expressed
  // as an actual candidate action or achievement.
  if (
    /\b(?:ENTERPRISE|GLOBAL_PNL|BUSINESS_UNIT|AUTONOMOUS|Board Decision Authority)\b/.test(text)
    && !ACTION_VERB.test(text)
  ) {
    return null;
  }

  const sentenceLike = /[.!?]$/.test(text);

  if (!ACTION_VERB.test(text) && !sentenceLike) {
    return null;
  }

  return text;
}

export function candidateProofHeadline(
  capability: unknown,
): string {
  if (typeof capability !== "string") {
    return "Relevant candidate precedent";
  }

  const cleaned = capability.replace(/\s+/g, " ").trim();

  if (
    cleaned.length < 3
    || cleaned.length > 80
    || /^(?:UNKNOWN|ENTERPRISE|AUTONOMOUS)$/i.test(cleaned)
  ) {
    return "Relevant candidate precedent";
  }

  return `Candidate precedent: ${cleaned}`;
}
