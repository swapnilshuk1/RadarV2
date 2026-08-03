import type { EditorialPattern } from "./EditorialPattern";
import type { EditorialContext } from "./EditorialContext";
import { EditorialValidator } from "./EditorialValidator";
import { allEditorialPatterns, fallbackPattern } from "./patterns";

export class EditorialPatternSelector {
  private static recentPatternIds: string[] = [];

  public static select(ctx: EditorialContext, opportunityId?: string): EditorialPattern {
    // 1. Filter patterns that pass EditorialValidator QA rules
    const validPatterns = allEditorialPatterns.filter(p => {
      if (p.id === fallbackPattern.id) return false; // reserve fallback for last resort
      const res = EditorialValidator.validate(p, ctx);
      return res.isValid;
    });

    if (validPatterns.length === 0) {
      return fallbackPattern;
    }

    // 2. Repetition avoidance: prefer a valid pattern not in recentPatternIds
    const unshownPatterns = validPatterns.filter(p => !this.recentPatternIds.includes(p.id));
    const candidatePool = unshownPatterns.length > 0 ? unshownPatterns : validPatterns;

    // 3. Deterministic hash selection from candidate pool based on opportunityId if provided
    let selectedIndex = 0;
    if (opportunityId) {
      let hash = 0;
      for (let i = 0; i < opportunityId.length; i++) {
        hash = (hash << 5) - hash + opportunityId.charCodeAt(i);
        hash |= 0;
      }
      selectedIndex = Math.abs(hash) % candidatePool.length;
    }

    const chosen = candidatePool[selectedIndex] || fallbackPattern;

    // 4. Update session queue history (track up to 5 recent patterns)
    this.recentPatternIds.push(chosen.id);
    if (this.recentPatternIds.length > 5) {
      this.recentPatternIds.shift();
    }

    return chosen;
  }
}
