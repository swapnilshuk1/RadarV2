import type { PortalName, AcquisitionVariant } from "./types";
import { DEFAULT_PORTALS, DEFAULT_KEYWORDS } from "./config";

export interface ScraperRuntimeOptions {
  mode: "GLOBAL_MARKET" | "SCOPED";
  tenantId?: string;
  personId?: string;
  searchPlanId?: string;
  headless: boolean;
  autoConfirm: boolean;
  requireConfirmation: boolean;
  portals: PortalName[];
  keywords?: string[];
  variants?: AcquisitionVariant[];
  maxPages?: number;
  maxCardsPerPage?: number;
  resume?: boolean;
  fresh?: boolean;
}

/**
 * Resolves scraper runtime options once with deterministic CLI and environment precedence.
 */
export function resolveScraperRuntimeOptions(
  cliArgs: string[] = typeof process !== "undefined" ? process.argv.slice(2) : [],
  env: NodeJS.ProcessEnv = typeof process !== "undefined" ? process.env : {}
): ScraperRuntimeOptions {
  // 1. Parse CLI arguments
  let explicitMode: "GLOBAL_MARKET" | "SCOPED" | undefined;
  let cliTenantId: string | undefined;
  let cliPersonId: string | undefined;
  let cliSearchPlanId: string | undefined;
  let cliHeadless: boolean | undefined;
  let cliRequireConfirmation = false;
  let cliAutoConfirm: boolean | undefined;
  let cliPortals: PortalName[] | undefined;
  let cliKeywords: string[] | undefined;
  let cliMaxPages: number | undefined;
  let cliResume = false;
  let cliFresh = false;

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === "--scoped") {
      explicitMode = "SCOPED";
    } else if (arg === "--global" || arg === "--global-market") {
      explicitMode = "GLOBAL_MARKET";
    } else if (arg === "--mode" && cliArgs[i + 1]) {
      const m = cliArgs[++i].toUpperCase();
      explicitMode = m.includes("SCOPE") ? "SCOPED" : "GLOBAL_MARKET";
    } else if ((arg === "--tenant-id" || arg === "--tenant") && cliArgs[i + 1]) {
      cliTenantId = cliArgs[++i];
    } else if ((arg === "--person-id" || arg === "--person") && cliArgs[i + 1]) {
      cliPersonId = cliArgs[++i];
    } else if ((arg === "--plan" || arg === "--search-plan-id") && cliArgs[i + 1]) {
      cliSearchPlanId = cliArgs[++i];
    } else if (arg === "--headless") {
      cliHeadless = true;
    } else if (arg === "--no-headless" || arg === "--headful") {
      cliHeadless = false;
    } else if (arg === "--require-confirmation") {
      cliRequireConfirmation = true;
      cliAutoConfirm = false;
    } else if (arg === "--auto-confirm" || arg === "--yes" || arg === "-y") {
      cliAutoConfirm = true;
    } else if (arg === "--no-auto-confirm") {
      cliAutoConfirm = false;
    } else if ((arg === "--portals" || arg === "--portal") && cliArgs[i + 1]) {
      const raw = cliArgs[++i];
      cliPortals = raw.split(",").map((p) => {
        const norm = p.trim().toLowerCase();
        if (norm === "linkedin") return "LinkedIn" as PortalName;
        if (norm === "indeed") return "Indeed" as PortalName;
        if (norm === "naukri") return "Naukri" as PortalName;
        return (p.trim().charAt(0).toUpperCase() + p.trim().slice(1).toLowerCase()) as PortalName;
      });
    } else if ((arg === "--keywords" || arg === "--keyword") && cliArgs[i + 1]) {
      cliKeywords = cliArgs[++i].split(",").map((k) => k.trim()).filter(Boolean);
    } else if (arg === "--pages" && cliArgs[i + 1]) {
      cliMaxPages = parseInt(cliArgs[++i], 10);
    } else if (arg === "--resume") {
      cliResume = true;
    } else if (arg === "--fresh") {
      cliFresh = true;
    }
  }

  // 2. Identity resolution (CLI > env)
  const tenantId = cliTenantId || env.RADAR_TENANT_ID || env.TENANT_ID;
  const personId = cliPersonId || env.RADAR_PERSON_ID || env.PERSON_ID;
  const searchPlanId = cliSearchPlanId || env.RADAR_SEARCH_PLAN_ID || env.SEARCH_PLAN_ID;

  // 3. Mode resolution
  let mode: "GLOBAL_MARKET" | "SCOPED";
  if (explicitMode) {
    mode = explicitMode;
  } else if (tenantId || personId) {
    mode = "SCOPED";
  } else {
    mode = "GLOBAL_MARKET";
  }

  // 4. Headless resolution:
  // CLI flag > explicit env HEADLESS > CI / serverless env > default false (headful local)
  let headless: boolean;
  if (cliHeadless !== undefined) {
    headless = cliHeadless;
  } else if (env.HEADLESS !== undefined) {
    headless = env.HEADLESS === "true" || env.HEADLESS === "1";
  } else if (env.CI === "true" || env.VERCEL === "1" || env.RENDER === "true" || env.AWS_LAMBDA_FUNCTION_NAME) {
    headless = true;
  } else {
    headless = false;
  }

  // 5. Confirmation resolution:
  // CLI require confirmation > CLI auto-confirm > env AUTO_CONFIRM > default true
  let autoConfirm: boolean;
  let requireConfirmation: boolean;
  if (cliRequireConfirmation) {
    requireConfirmation = true;
    autoConfirm = false;
  } else if (cliAutoConfirm !== undefined) {
    autoConfirm = cliAutoConfirm;
    requireConfirmation = !cliAutoConfirm;
  } else if (env.AUTO_CONFIRM !== undefined) {
    autoConfirm = env.AUTO_CONFIRM !== "false" && env.AUTO_CONFIRM !== "0";
    requireConfirmation = !autoConfirm;
  } else {
    autoConfirm = true;
    requireConfirmation = false;
  }

  // 6. Portals resolution
  const portals = cliPortals && cliPortals.length > 0 ? cliPortals : DEFAULT_PORTALS;

  return {
    mode,
    tenantId,
    personId,
    searchPlanId,
    headless,
    autoConfirm,
    requireConfirmation,
    portals,
    keywords: cliKeywords,
    maxPages: cliMaxPages,
    resume: cliResume,
    fresh: cliFresh,
  };
}
