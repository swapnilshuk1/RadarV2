/**
 * Durable pursuit workspace route.
 *
 * The cockpit used to exist only as an overlay on the decision surfaces, so a
 * reload, a bookmark or a shared link lost the workspace. This route owns the
 * pursuit by job hash: it opens (or reopens) the pursuit server-side on the
 * client, then renders the cockpit full-page. Scope is resolved from the
 * authenticated session; optional tenant/person search params exist only for
 * delegated recruiter/admin access and are re-validated on the server.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PursuitCockpit } from "@/pursuit/components/PursuitCockpit";
import { openPursuitFn } from "@/pursuit/server";
import type { CockpitView } from "@/pursuit/types";

export const Route = createFileRoute("/pursuit/$jobHash")({
  head: () => ({
    meta: [
      { title: "Pursuit workspace — RADAR" },
      {
        name: "description",
        content:
          "Your pursuit workspace: thesis, evidence ledger, resume studio, outreach kit and interview brief for a single opportunity.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PursuitWorkspacePage,
});

function PursuitWorkspacePage() {
  const { jobHash } = Route.useParams();
  const search = Route.useSearch() as { tenantId?: string; personId?: string };
  const navigate = useNavigate();
  const openPursuit = useServerFn(openPursuitFn);
  const [view, setView] = useState<CockpitView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await openPursuit({
          data: {
            ...(search.tenantId && search.personId
              ? { tenantId: search.tenantId, personId: search.personId }
              : {}),
            jobHash,
          },
        });
        if (alive) setView(next);
      } catch (cause) {
        if (!alive) return;
        const raw = cause instanceof Error ? cause.message : String(cause ?? "");
        setError(
          /unauthor|401|session|sign in/i.test(raw)
            ? "Your session has expired. Sign in again to open this pursuit."
            : raw || "This pursuit could not be opened.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobHash, openPursuit, search.personId, search.tenantId]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-lg font-semibold text-slate-100">Pursuit could not be opened</h1>
        <p className="mt-2 text-sm text-slate-300">{error}</p>
        <button
          type="button"
          onClick={() => void navigate({ to: "/decisions" })}
          className="mt-6 rounded-md border border-slate-600 px-4 py-2 text-xs uppercase tracking-wider text-slate-300 hover:text-slate-100"
        >
          Back to your opportunities
        </button>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <p className="text-sm text-slate-300">Opening pursuit workspace…</p>
      </main>
    );
  }

  return (
    <PursuitCockpit
      scope={view.scope}
      jobHash={view.pursuit.jobHash}
      initialView={view}
      onClose={() => void navigate({ to: "/decisions" })}
    />
  );
}
