import type { ChangeSet, Signal, ReasoningGraph, EventCategory, SignalSeverity, SignalDirection } from "../../../domain/entities";

export interface SignalPipelineManifest {
  name: string;
  consumes: "ChangeSet";
  produces: "Signal";
  priority: "High";
  deterministic: boolean;
  replayable: boolean;
  certificationLevel: number;
}

export class SignalPipeline {
  static manifest: SignalPipelineManifest = {
    name: "CoreSignalPipeline",
    consumes: "ChangeSet",
    produces: "Signal",
    priority: "High",
    deterministic: true,
    replayable: true,
    certificationLevel: 1
  };

  /**
   * 1. Detection
   * Evaluates if the ChangeSet contains anything worth signaling.
   */
  public detect(changeSet: ChangeSet): boolean {
    return changeSet.semanticChanges.length > 0 || changeSet.structuralChanges.length > 0;
  }

  /**
   * 2. Classification
   * Categorizes the raw changes into domain events.
   */
  public classify(changeSet: ChangeSet): { category: EventCategory, severity: SignalSeverity, direction: SignalDirection, evidenceId: string, description: string }[] {
    const rawSignals: any[] = [];
    
    // Stub: In reality, we'd inspect changeSet.semanticChanges 
    // and map them to Company, Market, or Recommendation signals.
    for (const change of changeSet.semanticChanges) {
       rawSignals.push({
         category: "Opportunity",
         severity: "Major",
         direction: "Neutral",
         evidenceId: "EVID_123", // Stub
         description: `Semantic change detected: ${JSON.stringify(change)}`
       });
    }

    return rawSignals;
  }

  /**
   * 3. Prioritization
   * Determines priority (Low, Medium, High, Immediate) based on the user's context.
   */
  public prioritize(rawSignal: any): "Low" | "Medium" | "High" | "Immediate" {
    if (rawSignal.severity === "Critical") return "Immediate";
    if (rawSignal.severity === "Major") return "High";
    return "Medium";
  }

  /**
   * 4. Publication
   * Executes the entire pipeline and returns strictly traceable Signals.
   */
  public execute(changeSet: ChangeSet, ledgerId: string): Signal[] {
    if (!this.detect(changeSet)) {
      return [];
    }

    const rawSignals = this.classify(changeSet);
    const publishedSignals: Signal[] = [];

    for (const rs of rawSignals) {
      publishedSignals.push({
        id: `SIG_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        category: rs.category,
        severity: rs.severity,
        priority: this.prioritize(rs),
        direction: rs.direction,
        evidenceId: rs.evidenceId,
        description: rs.description,
        ledgerId: ledgerId, // Intelligence Ledger traces this Signal back to the Pipeline
        provenance: {
           schemaVersion: "1.0",
           timestamp: new Date().toISOString()
        }
      });
    }

    return publishedSignals;
  }
}
