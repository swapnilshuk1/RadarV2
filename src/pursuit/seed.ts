/**
 * src/pursuit/seed.ts
 *
 * Starter positioning archetypes. These are *suggestions*, not system truth:
 * the product contract is that the candidate defines their own lenses. We seed
 * them once, only when the vault is empty, so the cockpit is usable on the very
 * first pursuit instead of demanding setup before it can show value.
 */

import type { ArchetypeInput } from "./types";

export const STARTER_ARCHETYPES: ArchetypeInput[] = [
  {
    name: "Automotive Focused",
    positioningStatement:
      "An automotive marketing leader who understands dealer networks, launch cycles and the long consideration funnel that defines vehicle purchase.",
    emphasize: ["automotive", "dealer", "launch", "OEM", "vehicle", "aftersales", "showroom"],
    deEmphasize: [],
    targetRoles: ["Marketing Head", "CMO", "Brand Director", "Marketing Director"],
    tone: "Authoritative, category-fluent",
    pinnedClaimIds: [],
    anchorDocumentIds: [],
    isDefault: true,
  },
  {
    name: "General Marketing",
    positioningStatement:
      "A broad marketing leader accountable for brand, demand and revenue contribution across categories.",
    emphasize: ["brand", "demand generation", "market share", "campaign", "go-to-market", "revenue"],
    deEmphasize: [],
    targetRoles: ["VP Marketing", "Head of Marketing", "CMO"],
    tone: "Commercial, outcome-led",
    pinnedClaimIds: [],
    anchorDocumentIds: [],
    isDefault: false,
  },
  {
    name: "Advertising Agency",
    positioningStatement:
      "An agency-side leader who has owned client P&L, pitch conversion and multidisciplinary delivery teams.",
    emphasize: ["agency", "client", "pitch", "P&L", "account", "creative", "retention"],
    deEmphasize: [],
    targetRoles: ["Business Head", "Managing Partner", "Client Services Director"],
    tone: "Persuasive, commercially sharp",
    pinnedClaimIds: [],
    anchorDocumentIds: [],
    isDefault: false,
  },
  {
    name: "GCC Scope",
    positioningStatement:
      "A global capability centre leader who has built offshore functions, governed global stakeholders and scaled teams from a standing start.",
    emphasize: ["GCC", "global", "capability centre", "offshore", "build", "hire", "governance", "stakeholder"],
    deEmphasize: [],
    targetRoles: ["VP GCC", "Head of GCC", "Site Leader", "Head of Global Shared Services"],
    tone: "Structured, organisationally fluent",
    pinnedClaimIds: [],
    anchorDocumentIds: [],
    isDefault: false,
  },
  {
    name: "Digital Marketing",
    positioningStatement:
      "A performance and digital leader accountable for measurable acquisition efficiency across paid, owned and martech.",
    emphasize: ["digital", "performance", "paid media", "SEO", "martech", "CRM", "attribution", "ROAS", "funnel"],
    deEmphasize: [],
    targetRoles: ["Head of Digital", "Head of Growth", "Performance Marketing Director"],
    tone: "Analytical, precise",
    pinnedClaimIds: [],
    anchorDocumentIds: [],
    isDefault: false,
  },
];
