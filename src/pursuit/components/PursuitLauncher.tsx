/**
 * Launch boundary between RADAR's decision surface and the Pursuit Cockpit.
 *
 * Kept as a context provider so a page only has to call `launch(jobHash)` — the
 * overlay, loading and error handling live here, which keeps the host route's
 * decision logic untouched and the module easy to port.
 *
 * Scope note: the launcher never requires tenant/person identifiers from the URL.
 * An authenticated session is sufficient; the server resolves and returns the
 * verified scope on the CockpitView, which is what the cockpit then operates on.
 * Optional `scope` props are only for delegated (recruiter/admin) access, where
 * the server re-validates the requested person before granting it.
 */

import { useServerFn } from "@tanstack/react-start";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PursuitCockpit } from "./PursuitCockpit";
import { openPursuitFn, pursueOpportunityFn } from "../server";
import type { CockpitView } from "../types";

interface LauncherContext {
  /** Reopens an existing pursuit without touching the decision record. */
  launch: (jobHash: string) => Promise<void>;
  /** Atomic PURSUE: records the decision and opens the pursuit in one command. */
  pursue: (jobHash: string, reason?: string) => Promise<void>;
  pending: boolean;
  available: boolean;
}

const Context = createContext<LauncherContext>({
  launch: async () => {},
  pursue: async () => {},
  pending: false,
  available: false,
});

export const usePursuitLauncher = () => useContext(Context);

/** Server failures reach the browser as opaque responses; keep them readable. */
function describeLaunchFailure(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  if (/unauthor|401|session|sign in/i.test(raw)) {
    return "Your session has expired. Sign in again, then reopen the cockpit.";
  }
  if (!raw || /<!doctype|<html|\[object/i.test(raw)) {
    return "The server could not be reached. Please try again in a moment.";
  }
  return raw;
}


export function PursuitLauncherProvider({
  scope,
  children,
}: {
  scope?: { tenantId?: string; personId?: string };
  children: ReactNode;
}) {
  const [view, setView] = useState<CockpitView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openPursuit = useServerFn(openPursuitFn);
  const pursueOpportunity = useServerFn(pursueOpportunityFn);

  const requestedTenantId = scope?.tenantId;
  const requestedPersonId = scope?.personId;

  const launch = useCallback(
    async (jobHash: string) => {
      setPending(true);
      setError(null);
      try {
        setView(
          await openPursuit({
            data: {
              ...(requestedTenantId && requestedPersonId
                ? { tenantId: requestedTenantId, personId: requestedPersonId }
                : {}),
              jobHash,
            },
          }),
        );
      } catch (cause) {
        setError(describeLaunchFailure(cause));
      } finally {
        setPending(false);
      }
    },
    [openPursuit, requestedPersonId, requestedTenantId],
  );

  const pursue = useCallback(
    async (jobHash: string, reason?: string) => {
      setPending(true);
      setError(null);
      try {
        const result = await pursueOpportunity({
          data: {
            ...(requestedTenantId && requestedPersonId
              ? { tenantId: requestedTenantId, personId: requestedPersonId }
              : {}),
            jobHash,
            ...(reason ? { reason } : {}),
          },
        });
        setView(result.view);
        // Keep the decision surface in step with the canonical record.
        if (typeof window !== "undefined")
          window.dispatchEvent(new CustomEvent("radar:decisions"));
      } catch (cause) {
        setError(describeLaunchFailure(cause));
      } finally {
        setPending(false);
      }
    },
    [pursueOpportunity, requestedPersonId, requestedTenantId],
  );

  const value = useMemo(
    () => ({ launch, pursue, pending, available: true }),
    [launch, pursue, pending],
  );

  return (
    <Context.Provider value={value}>
      {children}
      {error && (
        <div
          role="alert"
          data-testid="pursuit-launch-error"
          className="fixed bottom-5 right-5 z-[120] max-w-sm rounded-md border border-red-500/40 bg-[#0F172A] p-4 shadow-xl"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-red-400">
            Pursuit cockpit could not open
          </p>
          <p className="mt-1 text-sm text-slate-200">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-3 text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {view && (
        <PursuitCockpit
          scope={view.scope}
          jobHash={view.pursuit.jobHash}
          initialView={view}
          onClose={() => setView(null)}
        />
      )}
    </Context.Provider>
  );
}
