// src/lib/intelligence/editorial/NarrativeModel.ts

export interface EditorialFragment {
  identity: string;
  expression: string;
  decisionBridge?: string;
}

export interface NarrativeModel {
  sections: {
    CAREER: EditorialFragment;
    DELIVERABLES: EditorialFragment;
    FIT: EditorialFragment;
    UNKNOWNS: EditorialFragment;
    EVIDENCE: EditorialFragment;
  };
}
