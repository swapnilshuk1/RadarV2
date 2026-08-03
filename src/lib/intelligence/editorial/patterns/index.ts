import type { EditorialPattern } from "../EditorialPattern";

// Sprint 1: Growth Patterns
import {
  growthCommercialOwnershipPattern,
  growthCategoryLeadershipPattern,
  growthRevenueEnginePattern,
  growthPerformanceCoePattern,
  growthDigitalExpansionPattern,
  growthGlobalMarketEntryPattern,
  growthCommercialVelocityPattern,
  growthCustomerLifetimeValuePattern,
  growthScalableUnitEconomicsPattern,
  growthEnterpriseGtmPattern,
  growthOmnichannelRetailPattern,
  growthBrandEquityScalePattern,
  growthStrategicPartnershipsPattern,
  growthProductLedExpansionPattern,
  growthRegionalPnlOwnershipPattern,
  growthAgileCommercialTurnaroundPattern,
  growthCommercialCapabilityMoatPattern,
  growthDataDrivenFunnelPattern,
  growthHighMarginProductMixPattern,
  growthCommercialLeadershipAltitudePattern
} from "./growth";

// Sprint 2: Scale & Transformation Patterns
import {
  transformationTurnaroundPattern,
  transformationLegacyDecouplingPattern,
  transformationDigitalEcosystemPattern,
  transformationOperatingModelPattern,
  transformationCulturalChangePattern,
  transformationCostOptimizationPattern,
  transformationMandAIntegrationPattern,
  transformationAgileScalingPattern,
  transformationDataArchitecturePattern,
  transformationSupplyChainPattern,
  transformationOmnichannelResetPattern,
  transformationPostMergerPnlPattern,
  transformationGovernanceResetPattern,
  transformationCustomerExpPattern,
  transformationCommercialRetoolingPattern,
  transformationCloudNativePattern,
  transformationSecurityResiliencePattern,
  transformationSharedServicesPattern,
  transformationBusinessProcessPattern,
  transformationBoardMandatePattern
} from "./transformation";

// Sprint 3: Archetype Patterns
import {
  archetypeFounderTransitionPattern,
  archetypePeValueCreationPattern,
  archetypePeExitReadinessPattern,
  archetypePeCarveoutPattern,
  archetypeGlobalHqLiaisonPattern,
  archetypeGlobalMatrixLeadPattern,
  archetypeRegionalHubPattern,
  archetypeFamilyOfficePattern
} from "./archetypes";
import { founderAccessPattern } from "./founder";

// Sprint 4: CXO Role Patterns
import {
  roleBoardDirectorPattern,
  roleCdoPattern,
  roleCroPattern,
  roleCcoPattern,
  roleCmoPattern,
  roleCgoPattern,
  roleCtoPattern,
  roleCpoPattern,
  roleCooPattern,
  roleVpExpansionPattern
} from "./roles";

// Fallback Guard
import { fallbackPattern } from "./fallback";

export const allEditorialPatterns: EditorialPattern[] = [
  // Sprint 1: 20 Growth Patterns
  growthCommercialOwnershipPattern,
  growthCategoryLeadershipPattern,
  growthRevenueEnginePattern,
  growthPerformanceCoePattern,
  growthDigitalExpansionPattern,
  growthGlobalMarketEntryPattern,
  growthCommercialVelocityPattern,
  growthCustomerLifetimeValuePattern,
  growthScalableUnitEconomicsPattern,
  growthEnterpriseGtmPattern,
  growthOmnichannelRetailPattern,
  growthBrandEquityScalePattern,
  growthStrategicPartnershipsPattern,
  growthProductLedExpansionPattern,
  growthRegionalPnlOwnershipPattern,
  growthAgileCommercialTurnaroundPattern,
  growthCommercialCapabilityMoatPattern,
  growthDataDrivenFunnelPattern,
  growthHighMarginProductMixPattern,
  growthCommercialLeadershipAltitudePattern,

  // Sprint 2: 20 Scale & Transformation Patterns
  transformationTurnaroundPattern,
  transformationLegacyDecouplingPattern,
  transformationDigitalEcosystemPattern,
  transformationOperatingModelPattern,
  transformationCulturalChangePattern,
  transformationCostOptimizationPattern,
  transformationMandAIntegrationPattern,
  transformationAgileScalingPattern,
  transformationDataArchitecturePattern,
  transformationSupplyChainPattern,
  transformationOmnichannelResetPattern,
  transformationPostMergerPnlPattern,
  transformationGovernanceResetPattern,
  transformationCustomerExpPattern,
  transformationCommercialRetoolingPattern,
  transformationCloudNativePattern,
  transformationSecurityResiliencePattern,
  transformationSharedServicesPattern,
  transformationBusinessProcessPattern,
  transformationBoardMandatePattern,

  // Sprint 3: Company Archetype Patterns
  founderAccessPattern,
  archetypeFounderTransitionPattern,
  archetypePeValueCreationPattern,
  archetypePeExitReadinessPattern,
  archetypePeCarveoutPattern,
  archetypeGlobalHqLiaisonPattern,
  archetypeGlobalMatrixLeadPattern,
  archetypeRegionalHubPattern,
  archetypeFamilyOfficePattern,

  // Sprint 4: CXO Role Patterns
  roleBoardDirectorPattern,
  roleCdoPattern,
  roleCroPattern,
  roleCcoPattern,
  roleCmoPattern,
  roleCgoPattern,
  roleCtoPattern,
  roleCpoPattern,
  roleCooPattern,
  roleVpExpansionPattern,

  // Fallback Guard
  fallbackPattern
];

export { fallbackPattern };
