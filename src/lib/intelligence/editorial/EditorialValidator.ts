import type { EditorialPattern } from "./EditorialPattern";
import type { EditorialContext } from "./EditorialContext";

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

export class EditorialValidator {
  public static validate(pattern: EditorialPattern, ctx: EditorialContext): ValidationResult {
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

    return { isValid: true };
  }
}
