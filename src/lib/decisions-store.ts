import { useEffect, useRef, useState } from "react";
import type { DecisionVerb } from "../data/opportunity-fixtures";
import {
  getDecisionsFn,
  saveDecisionFn,
  undoDecisionFn,
  clearDecisionsFn
} from "./intelligence/decisions-server";
import { requireDecisionAcknowledgement } from "./intelligence/decision-acknowledgement";

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

export function useDecisions() {
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const undo = async (jobHash: string) => {
    setError(null);
    const message = "Decision removal was not acknowledged by the server.";
    try {
      await requireDecisionAcknowledgement(() => undoDecisionFn({ data: { jobHash } }), message);
    } catch (error) {
      setError(message);
      throw error;
    }
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[jobHash];
      writeLocal(scopeRef.current, next);
      return next;
    });
  };

  const clear = async () => {
    setError(null);
    const message = "Decision clearing was not acknowledged by the server.";
    try {
      await requireDecisionAcknowledgement(() => clearDecisionsFn(), message);
    } catch (error) {
      setError(message);
      throw error;
    }
    setDecisions({});
    writeLocal(scopeRef.current, {});
  };

  return { decisions, decide, undo, clear, hydrated, error };
}
