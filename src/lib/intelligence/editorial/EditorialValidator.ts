import type { EditorialPattern } from "./EditorialPattern";
import type { EditorialContext } from "./EditorialContext";

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

export class EditorialValidator {
  private static readonly BANNED_GRADES = [
    "high strategic fit",
    "recommended for review",
    "strong recommendation",
    "highest strategic fit",
    "excellent career acceleration role"
  ];

  /** Static QA audit of a pattern definition against Version 2.1 Editorial Standards */
  public static validatePatternDefinition(pattern: EditorialPattern): ValidationResult {
    const dummyMap = { role: "VP Growth", company: "Acme Corp", location: "Bengaluru" };
    const headline = pattern.slots.headline(dummyMap).trim();

    // 1. Headline must end with a full stop
    if (!headline.endsWith(".")) {
      return { isValid: false, reason: `Headline in pattern '${pattern.id}' does not end with a full stop.` };
    }

    // 2. Headline skeleton must be valid
    const validSkeletons = ["fact-first", "comparison-first", "consequence-first", "observation-first"];
    if (!pattern.skeleton || !validSkeletons.includes(pattern.skeleton)) {
      return { isValid: false, reason: `Pattern '${pattern.id}' lacks a valid skeleton metadata declaration.` };
    }

    // 3. Must not use banned grading adjectives in closing
    const closing = pattern.slots.decisionGuidance.closing?.(dummyMap)?.toLowerCase() || "";
    for (const banned of this.BANNED_GRADES) {
      if (closing.includes(banned)) {
        return { isValid: false, reason: `Closing in pattern '${pattern.id}' contains banned score language: '${banned}'.` };
      }
    }

    // 4. Invariant VII: Must contain at least one concrete anchor
    const fullText = (
      headline + " " +
      (pattern.slots.opening?.(dummyMap) || "") + " " +
      (pattern.slots.editorialBridge?.(dummyMap) || "") + " " +
      pattern.slots.decisionGuidance.proceedIf(dummyMap) + " " +
      pattern.slots.decisionGuidance.pauseIf(dummyMap) + " " +
      closing
    );

    const hasAnchor =
      /\b[0-9]+\b/.test(fullText) ||
      fullText.includes("Acme Corp") ||
      fullText.includes("VP Growth") ||
      /\b(EBITDA|P&L|CAC|D&O|R&D|AI|CRO|CTO|PE|100-day|12 months|8 quarters|24 months|36 months)\b/i.test(fullText);

    if (!hasAnchor) {
      return { isValid: false, reason: `Pattern '${pattern.id}' fails Invariant VII: Lacks concrete anchor.` };
    }

    return { isValid: true };
  }

  /** Runtime context matching validation */
  public static validate(pattern: EditorialPattern, ctx: EditorialContext): ValidationResult {
    // Perform static QA validation first
    const staticRes = this.validatePatternDefinition(pattern);
    if (!staticRes.isValid) return staticRes;

    const { requires, avoids } = pattern.constraints;

    // Check avoids
    if (avoids) {
      if (avoids.organizationType && avoids.organizationType.includes(ctx.organizationType)) {
        return { isValid: false, reason: `Pattern avoids organizationType '${ctx.organizationType}'` };
      }
      if (avoids.maxScore !== undefined && ctx.rawScore > avoids.maxScore) {
        return { isValid: false, reason: `Score ${ctx.rawScore} exceeds pattern maxScore ${avoids.maxScore}` };
      }
    }

    // Check requires
    if (requires) {
      if (requires.organizationType && !requires.organizationType.includes(ctx.organizationType)) {
        return { isValid: false, reason: `Pattern requires organizationType in [${requires.organizationType.join(", ")}], got '${ctx.organizationType}'` };
      }
      if (requires.transformationStage && !requires.transformationStage.includes(ctx.transformationStage)) {
        return { isValid: false, reason: `Pattern requires transformationStage in [${requires.transformationStage.join(", ")}], got '${ctx.transformationStage}'` };
      }
      if (requires.hasPnlOwnership && !ctx.hasPnlOwnership) {
        return { isValid: false, reason: `Pattern requires hasPnlOwnership = true, but context lacks P&L signals` };
      }
      if (requires.minScore !== undefined && ctx.rawScore < requires.minScore) {
        return { isValid: false, reason: `Score ${ctx.rawScore} below pattern minScore ${requires.minScore}` };
      }
    }

    // Check specific role pattern constraints
    if (pattern.id === "role-board-director-4a") {
      const isBoardRole = /board|governance|fiduciary|non-executive|advisory board/i.test(ctx.executiveIdentity || "");
      if (!isBoardRole) {
        return { isValid: false, reason: `Board pattern 'role-board-director-4a' requires board/governance identity` };
      }
    }

    return { isValid: true };
  }
}
