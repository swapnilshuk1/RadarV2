import { useEffect, useRef, useState } from "react";
import type { DecisionVerb } from "../data/opportunity-fixtures";
import {
  getDecisionsFn,
  saveDecisionFn,
  undoDecisionFn,
  clearDecisionsFn
} from "./intelligence/decisions-server";

export type DecisionRecord = { verb: DecisionVerb; at: number; reviewedFingerprint?: string | null };
export type DecisionMap = Record<string, DecisionRecord>;

const KEY_PREFIX = "radar.decisions.cache.v2:";

export function decisionCacheKey(scope: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(scope)}`;
}

function readLocal(scope: string | null): DecisionMap {
  if (typeof window === "undefined" || !scope) return {};
  try {
    const raw = window.localStorage.getItem(decisionCacheKey(scope));
    return raw ? (JSON.parse(raw) as DecisionMap) : {};
  } catch {
    return {};
  }
}

function writeLocal(scope: string | null, next: DecisionMap) {
  if (typeof window === "undefined" || !scope) return;
  try {
    window.localStorage.setItem(decisionCacheKey(scope), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("radar:decisions"));
  } catch {
    /* ignore */
  }
}

export function activePursuits(): number {
  // This historical helper has no authenticated scope input. It must not read
  // a cross-account cache; canonical callers obtain pursuit state from server.
  return 0;
}

export function useDecisions() {
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [hydrated, setHydrated] = useState(false);
  const scopeRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function hydrate() {
      // Canonical server state wins on every authenticated hydration. Browser
      // cache is a scoped convenience mirror, never an import source.
      try {
        const res = await getDecisionsFn();
        if (res && res.success && res.decisions) {
          let currentServerMap: DecisionMap = {};
          for (const [hash, val] of Object.entries(res.decisions)) {
            currentServerMap[hash] = {
              verb: val.verb as DecisionVerb,
              at: val.updatedAt ? new Date(val.updatedAt).getTime() : Date.now(),
              reviewedFingerprint: (val as any).reviewedFingerprint || null
            };
          }

          const resolvedScope = typeof (res as any).cacheScope === "string" ? (res as any).cacheScope : null;
          if (isMounted) {
            scopeRef.current = resolvedScope;
            setDecisions(currentServerMap);
            writeLocal(resolvedScope, currentServerMap);
            setHydrated(true);
          }
        }
      } catch (err) {
        console.error("[useDecisions] Server sync error:", err);
      }
    }

    hydrate();

    const onChange = () => {
      const resolvedScope = scopeRef.current;
      if (resolvedScope) setDecisions(readLocal(resolvedScope));
    };
    window.addEventListener("radar:decisions", onChange);
    window.addEventListener("storage", onChange);

    return () => {
      isMounted = false;
      window.removeEventListener("radar:decisions", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const decide = async (jobHash: string, verb: DecisionVerb, reviewedFingerprint?: string | null) => {
    // A browser fingerprint is display metadata only. Canonical provenance is
    // acknowledged by the server after it resolves the scoped current artifact.
    const result = await saveDecisionFn({ data: { jobHash, verb, reviewedFingerprint } });
    if (!result?.success) throw new Error("Decision persistence was not acknowledged by the server.");
    setDecisions((prev) => {
      const next = { ...prev, [jobHash]: { verb, at: Date.now(), reviewedFingerprint: result.reviewedFingerprint ?? null } };
      writeLocal(scopeRef.current, next);
      return next;
    });
  };

  const undo = (jobHash: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[jobHash];
      writeLocal(scopeRef.current, next);
      return next;
    });

    // Fire background server call to Turso/SQLite
    undoDecisionFn({ data: { jobHash } }).catch((err) => {
      console.error("[useDecisions] Error removing decision from server:", err);
    });
  };

  const clear = () => {
    setDecisions({});
    writeLocal(scopeRef.current, {});

    // Fire background server call to Turso/SQLite
    clearDecisionsFn().catch((err) => {
      console.error("[useDecisions] Error clearing decisions on server:", err);
    });
  };

  return { decisions, decide, undo, clear, hydrated };
}
