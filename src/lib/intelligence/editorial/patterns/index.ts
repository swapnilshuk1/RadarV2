import type { EditorialPattern } from "../EditorialPattern";

// Publication-Grade Curation (14 Exceptional Patterns)
import {
  growthCommercialBuilderPattern,
  growthScaleOperatorPattern,
  growthCategoryLeaderPattern
} from "./growth";

import {
  transformationTurnaroundLeaderPattern,
  transformationSystemsArchitectPattern,
  transformationOrgArchitectPattern
} from "./transformation";

import {
  founderPartnerPattern,
  founderGovernanceAnchorPattern
} from "./founder";

import {
  archetypePeOperatorPattern,
  archetypeGlobalExecutivePattern
} from "./archetypes";

import {
  roleBoardAdvisorPattern,
  roleRevenueOwnerPattern,
  roleTechnologyStrategistPattern,
  roleCsuiteSuccessorPattern
} from "./roles";

import { fallbackPattern } from "./fallback";

export const allEditorialPatterns: EditorialPattern[] = [
  // Growth
  growthCommercialBuilderPattern,
  growthScaleOperatorPattern,
  growthCategoryLeaderPattern,

  // Transformation
  transformationTurnaroundLeaderPattern,
  transformationSystemsArchitectPattern,
  transformationOrgArchitectPattern,

  // Founder
  founderPartnerPattern,
  founderGovernanceAnchorPattern,

  // Archetypes
  archetypePeOperatorPattern,
  archetypeGlobalExecutivePattern,

  // Roles
  roleBoardAdvisorPattern,
  roleRevenueOwnerPattern,
  roleTechnologyStrategistPattern,
  roleCsuiteSuccessorPattern,

  // Fallback Guard
  fallbackPattern
];

export { fallbackPattern };
