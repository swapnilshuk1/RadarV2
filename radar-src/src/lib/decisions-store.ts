import { useEffect, useState } from "react";
import type { DecisionVerb } from "../data/opportunity-fixtures";

export type DecisionRecord = { verb: DecisionVerb; at: number };
export type DecisionMap = Record<string, DecisionRecord>;

const KEY = "radar.decisions.v1";

function read(): DecisionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DecisionMap) : {};
  } catch {
    return {};
  }
}

function write(next: DecisionMap) {
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
  const map = read();
  return Object.values(map).filter((d) => d.verb === "PURSUE").length;
}

export function useDecisions() {
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDecisions(read());
    setHydrated(true);
    const onChange = () => setDecisions(read());
    window.addEventListener("radar:decisions", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("radar:decisions", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const decide = (jobHash: string, verb: DecisionVerb) => {
    setDecisions((prev) => {
      const next = { ...prev, [jobHash]: { verb, at: Date.now() } };
      write(next);
      return next;
    });
  };

  const undo = (jobHash: string) => {
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[jobHash];
      write(next);
      return next;
    });
  };

  const clear = () => {
    setDecisions({});
    write({});
  };

  return { decisions, decide, undo, clear, hydrated };
}
