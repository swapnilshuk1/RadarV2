// src/lib/intelligence/editorial/NarrativeModel.ts

import type { SectionId } from "./BriefModel";

export interface EditorialFragment {
  identity: string;
  expression: string;
  decisionBridge?: string;
}

export type NarrativeSections = Record<SectionId, EditorialFragment>;

export interface NarrativeModel {
  sections: NarrativeSections;
}
