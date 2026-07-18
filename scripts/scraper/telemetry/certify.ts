import type { PageExecutionRecord } from "../types";

export type Severity = "Fatal" | "Warning" | "Info";

export interface CertificationViolation {
  law: string;
  severity: Severity;
  message: string;
  recordTimestamp?: string;
  runId?: string;
}

export interface CertificationResult {
  passed: boolean;
  violations: CertificationViolation[];
}

export class CertificationEngine {
  violations: CertificationViolation[] = [];

  constructor() {}

  public certify(records: PageExecutionRecord[]): CertificationResult {
    this.violations = [];

    if (records.length === 0) {
      this.violations.push({
        law: "NoTelemetry",
        severity: "Fatal",
        message: "No PageExecutionRecord events found for this run.",
      });
      return { passed: false, violations: this.violations };
    }

    for (const record of records) {
      this.checkProvenance(record);
      this.checkConservation(record);
      this.checkYield(record);
    }

    const fatalCount = this.violations.filter(v => v.severity === "Fatal").length;

    return {
      passed: fatalCount === 0,
      violations: this.violations
    };
  }

  private checkProvenance(r: PageExecutionRecord) {
    const required = [
      "runId", "executionPlanId", "definitionId", "familyId", 
      "portal", "keyword", "page", "plannerVersion", 
      "ruleVersion", "extractorVersion", "promptVersion", "telemetrySchemaVersion"
    ];

    for (const field of required) {
      const val = (r as any)[field];
      if (val === undefined || val === null || val === "unknown") {
        this.addViolation("ProvenanceLaw", "Fatal", `Missing or unknown provenance field: ${field}`, r);
      }
    }

    if (r.page < 1) {
      this.addViolation("ProvenanceLaw", "Fatal", `Invalid page number: ${r.page}`, r);
    }
  }

  private checkConservation(r: PageExecutionRecord) {
    // Law 1: cardsParsed = duplicates + rejected + opportunities
    const derivedParsed = r.duplicates + r.rejected + r.opportunities;
    if (r.cardsParsed !== derivedParsed) {
      this.addViolation("ConservationLaw", "Fatal", `Law 1 failed: cardsParsed (${r.cardsParsed}) != duplicates (${r.duplicates}) + rejected (${r.rejected}) + opportunities (${r.opportunities})`, r);
    }

    // Law 2: cardsSeen >= cardsParsed
    if (r.cardsSeen < r.cardsParsed) {
      this.addViolation("ConservationLaw", "Fatal", `Law 2 failed: cardsSeen (${r.cardsSeen}) < cardsParsed (${r.cardsParsed})`, r);
    }

    // Law 3: saved <= opportunities
    if (r.saved > r.opportunities) {
      this.addViolation("ConservationLaw", "Fatal", `Law 3 failed: saved (${r.saved}) > opportunities (${r.opportunities})`, r);
    }

    // Law 4: duplicates <= cardsParsed
    if (r.duplicates > r.cardsParsed) {
      this.addViolation("ConservationLaw", "Fatal", `Law 4 failed: duplicates (${r.duplicates}) > cardsParsed (${r.cardsParsed})`, r);
    }

    // Law 5: No negative counts
    const counts = ["cardsSeen", "cardsParsed", "duplicates", "rejected", "opportunities", "saved"];
    for (const field of counts) {
      if ((r as any)[field] < 0) {
        this.addViolation("ConservationLaw", "Fatal", `Law 5 failed: ${field} cannot be negative (${(r as any)[field]})`, r);
      }
    }

    // Law 6: cardsSeen >= duplicates + opportunities
    if (r.cardsSeen < r.duplicates + r.opportunities) {
      this.addViolation("ConservationLaw", "Fatal", `Law 6 failed: cardsSeen (${r.cardsSeen}) < duplicates (${r.duplicates}) + opportunities (${r.opportunities})`, r);
    }
  }

  private checkYield(r: PageExecutionRecord) {
    const health = r.failureReason === null ? 100 : 0;
    if (health < 50) {
      this.addViolation("HealthRule", "Warning", `Portal navigation failed: ${r.failureReason}`, r);
    }

    if (r.cardsParsed > 0 && r.duplicates / r.cardsParsed > 0.8) {
      this.addViolation("YieldRule", "Warning", `High duplicate rate on page ${r.page} (${r.duplicates}/${r.cardsParsed})`, r);
    }
  }

  private addViolation(law: string, severity: Severity, message: string, record: PageExecutionRecord) {
    this.violations.push({
      law,
      severity,
      message,
      recordTimestamp: record.timestamp,
      runId: record.runId
    });
  }
}
