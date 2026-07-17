export interface RawExtraction {
  rawValue: string;
  evidenceSnippet: string;
  latencyMs: number;
  matches: string[];
  ambiguity: boolean;
}

export interface NormalizedFact<T> {
  canonicalValue: T;
  confidence: number;
  rawValue: string;
  metadata?: any;
}

export interface DimensionExtractor<T> {
  name: string;
  extractorVersion: string;
  normalizerVersion: string;
  extract(input: { title: string; snippet: string; detailText: string }): RawExtraction | null;
  normalize(raw: RawExtraction): NormalizedFact<T> | null;
}
