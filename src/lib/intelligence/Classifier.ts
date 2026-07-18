/**
 * Classifier.ts
 *
 * Generalised orchestration framework for classifiers in RADAR.
 * Manages executing pluggable providers, computing consensus, and writing to the ExtractionEvidence schema.
 */

import type { ExtractionEvidence } from "./extraction-evidence";
import { RegexProvider } from "./providers/RegexProvider";

export interface ClassifierProvider {
  name: string;
  classify(inputs: {
    title: string;
    company: string;
    location: string;
    text?: string;
  }): Promise<{
    value: any;
    confidence: number;
    alternatives?: Array<{ category: string; confidence: number }>;
    evidence: Array<{ quote: string; provenance: string }>;
  }>;
}

export abstract class Classifier {
  protected abstract providers: ClassifierProvider[];
  protected abstract dimensionName: string;
  protected abstract version: string;

  /**
   * Orchestrates provider execution, resolves consensus, and returns unified ExtractionEvidence.
   */
  public async classify(inputs: {
    title: string;
    company: string;
    location: string;
    text?: string;
  }): Promise<ExtractionEvidence> {
    const startTime = Date.now();
    const results: Array<{
      provider: string;
      value: any;
      confidence: number;
      alternatives?: Array<{ category: string; confidence: number }>;
      evidence: Array<{ quote: string; provenance: string }>;
    }> = [];

    for (const provider of this.providers) {
      try {
        const res = await provider.classify(inputs);
        results.push({
          provider: provider.name,
          value: res.value,
          confidence: res.confidence,
          alternatives: res.alternatives,
          evidence: res.evidence,
        });
      } catch (err) {
        // Silently tolerate single provider failures to ensure fallback / high availability
      }
    }

    if (results.length === 0) {
      return {
        dimension: this.dimensionName,
        value: null,
        confidence: 0,
        provider: "None",
        version: this.version,
        timestamp: new Date().toISOString(),
        lifecycle: "ACTIVE",
        evidence: [],
      };
    }

    // Sort by confidence descending to establish the consensus champion
    const sorted = [...results].sort((a, b) => b.confidence - a.confidence);
    const champion = sorted[0];

    // Compute simple consensus confidence based on champion vote
    const consensusConfidence = champion.confidence;

    return {
      dimension: this.dimensionName,
      value: champion.value,
      confidence: consensusConfidence,
      provider: champion.provider,
      version: this.version,
      timestamp: new Date().toISOString(),
      lifecycle: "ACTIVE",
      evidence: champion.evidence,
      metadata: {
        providers: results.map((r) => ({
          name: r.provider,
          confidence: r.confidence,
        })),
        alternatives: champion.alternatives,
        latencyMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Synchronous fallback for runtime execution in standard (non-async) pipelines.
   * Leverages RegexProvider to perform instantaneous in-memory classification.
   */
  public classifySync(inputs: {
    title: string;
    company: string;
    location: string;
    text?: string;
  }): ExtractionEvidence {
    const startTime = Date.now();
    
    const provider = new RegexProvider();
    const res = provider.classifySync(inputs);

    return {
      dimension: this.dimensionName,
      value: res.value,
      confidence: res.confidence,
      provider: provider.name,
      version: this.version,
      timestamp: new Date().toISOString(),
      lifecycle: "ACTIVE",
      evidence: res.evidence,
      metadata: {
        providers: [{ name: provider.name, confidence: res.confidence }],
        alternatives: res.alternatives,
        latencyMs: Date.now() - startTime
      }
    };
  }
}
