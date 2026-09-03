import type { 
  AcquisitionBudget, 
  SearchDefinition, 
  AcquisitionStrategy,
  CatalogVersion
} from "../../../src/lib/domain/acquisition";
import { v4 as uuidv4 } from "uuid";

export interface PlannerConfiguration {
  duplicateThresholdPct: number;
  expectedValueThreshold: number;
  maxPageAgeDays: number;
  minYieldPct: number;
  minConfidence: number;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfiguration = {
  duplicateThresholdPct: 80,
  expectedValueThreshold: 0.5,
  maxPageAgeDays: 30,
  minYieldPct: 5,
  minConfidence: 0.8,
};

export interface WorkUnit {
  id: string; // e.g. "LinkedIn:CMO:India:1"
  portal: string;
  keyword: string;
  location?: string;
  page: number;
  definitionId: string;
  priority: number;
  estimatedBrowserSeconds: number;
  estimatedLLMTokens: number;
  expectedYield: number;
  variant?: import("../types").AcquisitionVariant;
}

export interface ExecutionPlan {
  planId: string;
  strategyId: string;
  plannerVersion: string;
  catalogVersion: string;
  ruleVersion: string;
  generatedAt: string;
  budget: AcquisitionBudget;
  plannedUnitsCount: number;
  workUnits: WorkUnit[];
}

import fs from "fs";
import path from "path";

export class CrawlPlanner {
  constructor(
    private config: PlannerConfiguration = DEFAULT_PLANNER_CONFIG,
    private plannerVersion: string = "1.1.0",
    private ruleVersion: string = "1.0.0"
  ) {}

  generateOfflinePlan(
    strategy: AcquisitionStrategy,
    catalogVersionString: string,
    budget: AcquisitionBudget,
    definitions: SearchDefinition[],
    maxPagesPerDefinition: number = 10,
    outputDir: string = path.join(process.cwd(), ".radar", "runs")
  ): string {
    const units: WorkUnit[] = [];

    // Sort by priority DESC so most important definitions are queued first
    const sortedDefs = [...definitions].sort((a, b) => b.priority - a.priority);

    for (const def of sortedDefs) {
      if (def.status === "RETIRED" || def.status === "PAUSED") continue;

      for (let p = 1; p <= maxPagesPerDefinition; p++) {
        // Simple estimations for now
        const expectedYield = p === 1 ? 15 : p === 2 ? 8 : p === 3 ? 3 : 1;
        const estimatedTokens = expectedYield * 500;
        const browserSeconds = 15; // 15s per page

        units.push({
          id: `${def.portal}:${def.query}:${def.location || "global"}:${p}`,
          portal: def.portal,
          keyword: def.query,
          location: def.location,
          page: p,
          definitionId: def.id,
          priority: def.priority,
          estimatedBrowserSeconds: browserSeconds,
          estimatedLLMTokens: estimatedTokens,
          expectedYield
        });
      }
    }

    const plan: ExecutionPlan = {
      planId: `plan-${uuidv4()}`,
      strategyId: strategy.id,
      plannerVersion: this.plannerVersion,
      catalogVersion: catalogVersionString,
      ruleVersion: this.ruleVersion,
      generatedAt: new Date().toISOString(),
      budget,
      plannedUnitsCount: units.length,
      workUnits: units
    };

    fs.mkdirSync(outputDir, { recursive: true });
    const planPath = path.join(outputDir, "ExecutionPlan.json");
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");
    
    console.log(`Generated ExecutionPlan with ${units.length} work units at ${planPath}`);
    return planPath;
  }
}
