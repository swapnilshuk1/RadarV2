/**
 * CapabilityOntology.ts
 *
 * Singleton loader for the declarative capability mappings.
 * Parses the self-contained knowledge definitions inside capabilities.json browser-safely.
 */
import capabilitiesJson from "../../../config/ontologies/capabilities.json";

export interface RuleCondition {
  dimension: "technologyStack" | "mandate" | "commercialAccountability" | "reportingLine";
  anyOf?: string[];
  allOf?: string[];
  noneOf?: string[];
  categories?: string[]; // Specifically for technology Stack category filtering
}

export interface CompositionalRules {
  allOf?: RuleCondition[];
  anyOf?: RuleCondition[];
  noneOf?: RuleCondition[];
}

export interface OntologyCapability {
  id: string;
  name: string;
  description: string;
  evaluation: CompositionalRules;
  strengthPolicy: {
    weak: [number, number];
    moderate: [number, number];
    strong: [number, number];
  };
  explanationTemplate: string;
}

export interface CapabilityOntologyConfig {
  version: string;
  capabilities: OntologyCapability[];
}

export class CapabilityOntology {
  private static instance: CapabilityOntology | null = null;

  private readonly capabilities: Map<string, OntologyCapability> = new Map();
  private readonly version: string;

  private constructor() {
    const t0 = Date.now();

    const config = capabilitiesJson as CapabilityOntologyConfig;
    this.version = config.version || "1.0.0";

    for (const cap of config.capabilities) {
      this.capabilities.set(cap.id, cap);
    }

    const loadMs = Date.now() - t0;
    console.log("  Capability Ontology Loaded:");
    console.log(`    Version:           ${this.version}`);
    console.log(`    Capabilities:      ${this.capabilities.size}`);
    console.log(`    Load time:         ${loadMs}ms\n`);
  }

  public static getInstance(): CapabilityOntology {
    if (!CapabilityOntology.instance) {
      CapabilityOntology.instance = new CapabilityOntology();
    }
    return CapabilityOntology.instance;
  }

  public static resetInstance(): void {
    CapabilityOntology.instance = null;
  }

  public getVersion(): string {
    return this.version;
  }

  public getCapabilities(): OntologyCapability[] {
    return Array.from(this.capabilities.values());
  }

  public getCapability(id: string): OntologyCapability | undefined {
    return this.capabilities.get(id);
  }
}
