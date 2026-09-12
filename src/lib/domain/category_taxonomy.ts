/**
 * src/lib/domain/category_taxonomy.ts
 *
 * RADAR V4 Canonical Category & Taxonomy Engine.
 * Single authoritative definition for executive opportunity categories.
 */

export type CategoryId =
  | "all"
  | "needs_more_signal"
  | "transformation"
  | "commercial_growth"
  | "country_leadership"
  | "platform_digital"
  | "founder_led"
  | "private_equity";

export interface CategoryDefinition {
  readonly id: CategoryId;
  readonly label: string;
  readonly description: string;
  readonly isSpecialFilter?: boolean;
}

export const CANONICAL_CATEGORIES: readonly CategoryDefinition[] = [
  { id: "all", label: "All", description: "All shortlisted executive mandates" },
  { id: "needs_more_signal", label: "Needs More Signal", description: "Opportunities with incomplete specification requiring additional signal", isSpecialFilter: true },
  { id: "transformation", label: "Transformation", description: "Digital, operational, and organizational transformation mandates" },
  { id: "commercial_growth", label: "Commercial Growth", description: "Revenue expansion, GTM scaling, and commercial leadership" },
  { id: "country_leadership", label: "Country Leadership", description: "Managing Director, Country Manager, and General Management roles" },
  { id: "platform_digital", label: "Platform & Digital", description: "Technology, digital products, and platform infrastructure" },
  { id: "founder_led", label: "Founder-led", description: "Promoter/founder-backed enterprises undergoing professionalization" },
  { id: "private_equity", label: "Private Equity", description: "PE-backed portfolio companies, M&A integrations, and IPO prep" },
] as const;

export type CategoryCountMap = Record<CategoryId, {
  total: number;
  unreviewed: number;
  shortlisted: number;
}>;

/**
 * Resolves any legacy display string, alias, or ID to a canonical CategoryId.
 */
export function resolveCanonicalCategoryId(input: string): CategoryId {
  if (!input) return "all";
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

  switch (normalized) {
    case "all":
      return "all";
    case "needs_more_signal":
    case "needs_signal":
    case "sparse_spec":
    case "sparse":
      return "needs_more_signal";
    case "transformation":
    case "turnaround":
      return "transformation";
    case "commercial_growth":
    case "commercial":
    case "high_growth":
    case "growth":
    case "commercial_expansion":
      return "commercial_growth";
    case "country_leadership":
    case "leadership":
    case "general_management":
    case "country_manager":
      return "country_leadership";
    case "platform___digital":
    case "platform_digital":
    case "digital___product":
    case "digital_product":
    case "digital":
    case "platform":
    case "technology":
      return "platform_digital";
    case "founder_led":
    case "founder":
    case "promoter":
      return "founder_led";
    case "private_equity":
    case "pe":
    case "pe_backed":
      return "private_equity";
    default:
      return "all";
  }
}

/**
 * Classifies an opportunity object into its matching canonical category IDs.
 */
export function classifyOpportunityCategories(o: {
  role?: string;
  description?: string;
  recommendation?: string;
  trueExecutiveMandate?: string;
  executiveMission?: { intent?: string };
  evaluationStatus?: string;
}): CategoryId[] {
  const categories: CategoryId[] = ["all"];

  const role = (o.role || "").toLowerCase();
  const desc = (o.description || "").toLowerCase();
  const rec = (o.recommendation || "").toLowerCase();
  const rawText = `${role} ${desc} ${rec}`;
  const mandate = (o.trueExecutiveMandate || "").toUpperCase();
  const intent = (o.executiveMission?.intent || "").toUpperCase();

  // 1. Needs More Signal
  if (o.evaluationStatus === "SPARSE_SPEC" || rec.includes("sparse") || mandate === "SPARSE_SPEC") {
    categories.push("needs_more_signal");
  }

  // 2. Transformation
  if (
    mandate === "TRANSFORMATION" ||
    mandate === "TURNAROUND" ||
    role.includes("transformation") ||
    rawText.includes("digital transformation") ||
    rawText.includes("operational restructuring") ||
    rawText.includes("turnaround") ||
    rawText.includes("overhaul")
  ) {
    categories.push("transformation");
  }

  // 3. Commercial Growth
  if (
    mandate === "COMMERCIAL_EXPANSION" ||
    mandate === "SCALE" ||
    mandate === "SCALE_UP" ||
    intent === "ACCELERATE_GROWTH" ||
    role.includes("commercial") ||
    role.includes("growth") ||
    role.includes("sales") ||
    role.includes("revenue") ||
    role.includes("cro") ||
    role.includes("business development") ||
    rawText.includes("commercial growth") ||
    rawText.includes("revenue expansion") ||
    rawText.includes("market expansion") ||
    rawText.includes("gtm")
  ) {
    categories.push("commercial_growth");
  }

  // 4. Country Leadership
  if (
    role.includes("country manager") ||
    role.includes("managing director") ||
    role.includes("general manager") ||
    role.includes("vp & gm") ||
    role.includes("president") ||
    mandate === "GOVERNANCE"
  ) {
    categories.push("country_leadership");
  }

  // 5. Platform & Digital
  if (
    role.includes("digital") ||
    role.includes("platform") ||
    role.includes("product") ||
    role.includes("technology") ||
    role.includes("cto") ||
    role.includes("cio") ||
    role.includes("cpo") ||
    rawText.includes("platform infrastructure") ||
    rawText.includes("digital products")
  ) {
    categories.push("platform_digital");
  }

  // 6. Founder-led
  if (
    intent === "PROFESSIONALIZE_FOUNDER_COMPANY" ||
    rawText.includes("founder") ||
    rawText.includes("bootstrapped") ||
    rawText.includes("promoter")
  ) {
    categories.push("founder_led");
  }

  // 7. Private Equity
  if (
    intent === "PREPARE_IPO" ||
    intent === "INTEGRATE_ACQUISITION" ||
    rawText.includes("private equity") ||
    rawText.includes("pe-backed") ||
    rawText.includes("portfolio company")
  ) {
    categories.push("private_equity");
  }

  return categories;
}
