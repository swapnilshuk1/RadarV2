import { useEffect, useState } from "react";
import type { DecisionVerb } from "../data/opportunity-fixtures";
import {
  getDecisionsFn,
  saveDecisionFn,
  syncDecisionsFn,
  undoDecisionFn,
  clearDecisionsFn
} from "./intelligence/decisions-server";

export type DecisionRecord = { verb: DecisionVerb; at: number };
export type DecisionMap = Record<string, DecisionRecord>;

const KEY = "radar.decisions.v1";
const SYNC_FLAG = "radar.decisions.synced.v1";

function readLocal(): DecisionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DecisionMap) : {};
  } catch {
    return {};
  }
}

function writeLocal(next: DecisionMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("radar:decisions"));
  } catch {
    /* ignore */
  }
}

export function activePursuits(): number {
  if (typeof window === "undefined") return 0;
  const map = readLocal();
  return Object.values(map).filter((d) => d.verb === "PURSUE").length;
}

export function useDecisions() {
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const initialLocal = readLocal();

    async function hydrate() {
      // 1. Initial local render for immediate UI responsiveness
      if (isMounted) {
        setDecisions(initialLocal);
        setHydrated(true);
      }

      // 2. Fetch server canonical state from Turso/SQLite
      try {
        const res = await getDecisionsFn();
        if (res && res.success && res.decisions) {
          const serverMap: DecisionMap = {};
          for (const [hash, val] of Object.entries(res.decisions)) {
            serverMap[hash] = {
              verb: val.verb as DecisionVerb,
              at: val.updatedAt ? new Date(val.updatedAt).getTime() : Date.now()
            };
          }

          // 3. Auto-sync local storage decisions to server if local has unsynced items
          if (typeof window !== "undefined" && Object.keys(initialLocal).length > 0 && Object.keys(initialLocal).length > Object.keys(serverMap).length) {
            await syncDecisionsFn({ data: { decisions: initialLocal } });
            window.localStorage.setItem(SYNC_FLAG, "true");
          }

          // 4. Merge server decisions into client state
          const merged = { ...initialLocal, ...serverMap };
          if (isMounted) {
            setDecisions(merged);
            writeLocal(merged);
          }
        }
      } catch (err) {
        console.error("[useDecisions] Server sync error:", err);
      }
    }

    hydrate();

    const onChange = () => setDecisions(readLocal());
    window.addEventListener("radar:decisions", onChange);
    window.addEventListener("storage", onChange);

    return () => {
      isMounted = false;
      window.removeEventListener("radar:decisions", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const decide = (jobHash: string, verb: DecisionVerb) => {
    setDecisions((prev) => {
      const next = { ...prev, [jobHash]: { verb, at: Date.now() } };
      writeLocal(next);
      return next;
    });

    // Fire background server call to Turso/SQLite
    saveDecisionFn({ data: { jobHash, verb } }).catch((err) => {
      console.error("[useDecisions] Error saving decision to server:", err);
    });
  };

  const undo = (jobHash: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[jobHash];
      writeLocal(next);
      return next;
    });

    // Fire background server call to Turso/SQLite
    undoDecisionFn({ data: { jobHash } }).catch((err) => {
      console.error("[useDecisions] Error removing decision from server:", err);
    });
  };

  const clear = () => {
    setDecisions({});
    writeLocal({});

    // Fire background server call to Turso/SQLite
    clearDecisionsFn().catch((err) => {
      console.error("[useDecisions] Error clearing decisions on server:", err);
    });
  };

  return { decisions, decide, undo, clear, hydrated };
}
