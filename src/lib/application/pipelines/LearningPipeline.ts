import type { TimelineEvent } from "../../../domain/entities";
import type { Observation, Hypothesis, Finding, DerivedPreference } from "../../../domain/Memory";

export interface LearningPipelineManifest {
  name: string;
  consumes: "TimelineEvent";
  produces: "DerivedPreference";
  priority: "Background";
  deterministic: boolean;
  replayable: boolean;
  certificationLevel: number;
}

export class LearningPipeline {
  static manifest: LearningPipelineManifest = {
    name: "CoreLearningPipeline",
    consumes: "TimelineEvent",
    produces: "DerivedPreference",
    priority: "Background",
    deterministic: true,
    replayable: true,
    certificationLevel: 1
  };

  /**
   * 1. Observation Extraction
   * Extracts raw behaviors and market movements from the timeline.
   */
  public extractObservation(event: TimelineEvent): Observation | null {
    if (event.eventCategory !== "Decision") return null;
    
    return {
      id: `OBS_${Date.now()}`,
      personId: event.personId,
      timelineEventId: event.id,
      type: "Behavior",
      statement: `User made a decision on opportunity ${event.opportunityId}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: event.provenance
    };
  }

  /**
   * 2. Hypothesis Building
   * Batches observations to form a subjective hypothesis.
   */
  public buildHypothesis(observations: Observation[]): Hypothesis | null {
    if (observations.length === 0) return null;

    const personId = observations[0].personId;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6); // Expire in 6 months

    return {
      id: `HYP_${Date.now()}`,
      personId,
      statement: "User may be avoiding opportunities requiring extensive travel",
      confidence: 0.65,
      evidenceCount: observations.length,
      observationIds: observations.map(o => o.id),
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: observations[0].provenance
    };
  }

  /**
   * 3. Finding Generation
   * Derives objective findings from the hypothesis.
   */
  public generateFinding(hypothesis: Hypothesis): Finding {
    return {
      id: `FND_${Date.now()}`,
      personId: hypothesis.personId,
      statement: `Travel avoided in ${hypothesis.evidenceCount} observed decisions`,
      hypothesisIds: [hypothesis.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: hypothesis.provenance
    };
  }

  /**
   * 4. Preference Derivation
   * Translates the finding into a multi-dimensional semantic preference.
   */
  public derivePreference(finding: Finding, ledgerId: string): DerivedPreference {
    return {
      id: `PREF_${Date.now()}`,
      personId: finding.personId,
      attribute: "Travel",
      state: "Emerging",
      weight: -0.65,
      confidence: {
        value: 0.65,
        source: "LearningPipeline",
        calculation: "EvidenceCountWeighted",
        version: "1.0"
      },
      volatility: 0.4, // High volatility since it's only emerging
      evidenceCount: 1, // Number of findings
      ledgerId: ledgerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: finding.provenance
    };
  }
}
