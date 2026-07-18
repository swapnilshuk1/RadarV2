/**
 * CapabilityEngine.ts
 *
 * Orchestrator for evaluating capability mappings.
 * Projects structured opportunity evidence into abstract business capabilities.
 *
 * Invariants:
 * 1. Capabilities are derived, never inferred without evidence.
 * 2. Emits multiple parallel projections (Capability[]) instead of single classification.
 */
import type { Capability, EvidenceReference, SourceDimension } from "../../domain/entities";
import { CapabilityOntology, type OntologyCapability } from "../ontology/CapabilityOntology";
import { RuleEvaluator } from "./RuleEvaluator";

export interface JobSlice {
  jobId: string;
  jobHash: string;
  graphVersion: string;
  dimensions: Record<string, {
    value: string | number | boolean | null;
    confidence?: number;
    evidence?: string;
  }>;
}

export interface EvaluatedCapability extends Capability {
  score: number;
}

export class CapabilityEngine {
  private ontology = CapabilityOntology.getInstance();
  private evaluator = new RuleEvaluator();

  /**
   * Evaluate a JobSlice and project it into active Capabilities.
   */
  public evaluate(job: JobSlice): EvaluatedCapability[] {
    const matchedCapabilities: EvaluatedCapability[] = [];
    const configs = this.ontology.getCapabilities();

    for (const config of configs) {
      const evaluationResult = this.evaluator.evaluate(config.evaluation, job);
      if (evaluationResult.matched) {
        // Resolve strength based on policy range tuples
        const score = evaluationResult.score;
        let strength: "Strong" | "Moderate" | "Weak" = "Weak";

        const { weak, moderate, strong } = config.strengthPolicy;
        if (score >= strong[0] && score < strong[1]) {
          strength = "Strong";
        } else if (score >= moderate[0] && score < moderate[1]) {
          strength = "Moderate";
        } else if (score >= weak[0] && score < weak[1]) {
          strength = "Weak";
        }

        // Aggregate average confidence of matched dimensions
        let confidenceSum = 0;
        for (const ev of evaluationResult.evidence) {
          confidenceSum += ev.confidence ?? 1.0;
        }
        const confidence = evaluationResult.evidence.length > 0
          ? Math.round((confidenceSum / evaluationResult.evidence.length) * 100) / 100
          : 1.0;

        // Resolve source dimensions
        const sourceDimensionsSet = new Set<SourceDimension>();
        for (const ev of evaluationResult.evidence) {
          sourceDimensionsSet.add(ev.dimension);
        }

        matchedCapabilities.push({
          id: config.id,
          name: config.name,
          strength,
          confidence,
          supportingEvidence: evaluationResult.evidence,
          sourceDimensions: Array.from(sourceDimensionsSet),
          score,
        });
      }
    }

    return matchedCapabilities;
  }

  /**
   * Deterministically generates dynamic summaries from templates.
   */
  public generateSummary(config: OntologyCapability, capability: Capability): string {
    let summary = config.explanationTemplate;

    const matchedValuesList: string[] = [];
    const dimensionsList: string[] = [];

    for (const ev of capability.supportingEvidence) {
      if (ev.matchedValue) matchedValuesList.push(ev.matchedValue);
      dimensionsList.push(ev.dimension);
    }

    const uniqueValues = Array.from(new Set(matchedValuesList));
    const uniqueDimensions = Array.from(new Set(dimensionsList));

    summary = summary.replace(/{name}/g, config.name);
    summary = summary.replace(/{matchedValues}/g, uniqueValues.join(", "));
    summary = summary.replace(/{dimensions}/g, uniqueDimensions.join(", "));

    // Replace specific dimension placeholders if present
    for (const ev of capability.supportingEvidence) {
      const pattern = new RegExp(`{${ev.dimension}}`, "g");
      summary = summary.replace(pattern, ev.matchedValue ?? "");
    }

    return summary;
  }
}
