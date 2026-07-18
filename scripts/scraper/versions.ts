// Version stamps written into every JobSnapshot, ExtractionResult and Recommendation.
// Bump the relevant constant whenever its schema/behaviour changes; the run manager
// uses these to invalidate cached artifacts.
export const SCRAPER_VERSION = "1.0.0";
export const SNAPSHOT_SCHEMA_VERSION = "1.0.0";
export const EXTRACTOR_VERSION = "1.0.0";
export const EXTRACTOR_PROMPT_VERSION = "1.0.0";
export const RECOMMENDATION_SCHEMA_VERSION = "1.0.0";
export const TELEMETRY_SCHEMA_VERSION = "1.0.0";
export const MANIFEST_VERSION = "1.0.0";
export const CATALOG_VERSION = "1.0.0";
export const PLANNER_VERSION = "4.5.0";
export const RULE_VERSION = "4.5.0";
