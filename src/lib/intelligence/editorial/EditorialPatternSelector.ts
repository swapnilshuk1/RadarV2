import type { EditorialPattern, HeadlineSkeleton } from "./EditorialPattern";
import type { EditorialContext } from "./EditorialContext";
import { EditorialValidator } from "./EditorialValidator";
import { allEditorialPatterns, fallbackPattern } from "./patterns";

export interface PatternHistoryEntry {
  patternId: string;
  patternFamily: string;
  skeleton: HeadlineSkeleton;
  purpose: string;
}

export class EditorialPatternSelector {
  private static sessionHistory: PatternHistoryEntry[] = [];

  public static clearHistory(): void {
    this.sessionHistory = [];
  }

  public static getHistory(): PatternHistoryEntry[] {
    return [...this.sessionHistory];
  }

  public static select(ctx: EditorialContext, opportunityId?: string, bypassHistory: boolean = false): EditorialPattern {
    // 1. Filter valid patterns using EditorialValidator QA rules
    const validPatterns = allEditorialPatterns.filter((p) => {
      if (p.id === fallbackPattern.id) return false;
      return EditorialValidator.validate(p, ctx).isValid;
    });

    if (validPatterns.length === 0) {
      return fallbackPattern;
    }

    let candidatePool = validPatterns;

    if (!bypassHistory) {
      // 2. Multi-dimensional repetition & skeleton cap filtering
      const totalSelections = this.sessionHistory.length;

      const filteredPool = validPatterns.filter((p) => {
        // Avoid exact pattern ID repeat in recent history
        const idRecent = this.sessionHistory.slice(-5).some((entry) => entry.patternId === p.id);
        if (idRecent) return false;

        // Avoid immediate repeat of same patternFamily, same skeleton, or same purpose
        const last = this.sessionHistory[this.sessionHistory.length - 1];
        if (last) {
          if (last.patternFamily === p.patternFamily) return false;
          if (last.skeleton === p.skeleton) return false;
          if (last.purpose === p.editorialPurpose) return false;
        }

        // Enforce max 40% skeleton distribution rule across session
        if (totalSelections >= 3) {
          const skeletonCount = this.sessionHistory.filter((entry) => entry.skeleton === p.skeleton).length;
          const currentPct = skeletonCount / totalSelections;
          if (currentPct >= 0.4) return false;
        }

        return true;
      });

      // Fall back to un-repeated IDs if strict filter narrows pool to 0
      const unshownPatterns = validPatterns.filter(
        (p) => !this.sessionHistory.some((entry) => entry.patternId === p.id)
      );

      candidatePool =
        filteredPool.length > 0
          ? filteredPool
          : unshownPatterns.length > 0
          ? unshownPatterns
          : validPatterns;
    }

    // 3. Deterministic hash selection from candidate pool using company + role seed for pattern diversity
    let selectedIndex = 0;
    const seedString = opportunityId || "editorial_pattern_seed";
    if (seedString) {
      let hash = 0;
      for (let i = 0; i < seedString.length; i++) {
        hash = (hash << 5) - hash + seedString.charCodeAt(i);
        hash |= 0;
      }
      selectedIndex = Math.abs(hash) % candidatePool.length;
    }

    const chosen = candidatePool[selectedIndex] || fallbackPattern;

    if (!bypassHistory) {
      // 4. Update session history entry
      this.sessionHistory.push({
        patternId: chosen.id,
        patternFamily: chosen.patternFamily,
        skeleton: chosen.skeleton,
        purpose: chosen.editorialPurpose,
      });
    }

    return chosen;
  }
}
