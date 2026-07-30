import { createFileRoute, Link } from "@tanstack/react-router";
import { type DimensionResult, type Opportunity } from "../data/opportunity-fixtures";
import { getOpportunitiesFn } from "../lib/intelligence/opportunity-server";
import { candidateProfile } from "../data/candidate-profile";

export const Route = createFileRoute("/qa/mapping")({
  head: () => ({
    meta: [
      { title: "QA · Candidate → Dimension mapping — RADAR" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Diagnostic view of which candidate-profile fields feed each radar dimension." },
    ],
  }),
  loader: async () => {
    return {
      opportunitiesList: await getOpportunitiesFn()
    };
  },
  component: MappingQA,
});

/** Heuristic detector: which candidate-profile paths are referenced by a proof string. */
const DETECTORS: Array<{ path: string; test: RegExp }> = [
  { path: "identity.currentTitle", test: /\b(VP Marketing|current VP|Performance CoE Lead)\b/i },
  { path: "executiveIdentity.archetype", test: /\bCommercial Growth Leader\b/i },
  { path: "experience.yearsExperience", test: /\b20\+?\s*years?\b/i },
  { path: "experience.teamSizeManaged", test: /\b40[- ](?:member|person)\b/i },
  { path: "experience.feeBookScale", test: /\$8M|Ford fee book|Ford commercial/i },
  { path: "experience.achievements[BMW retainer]", test: /₹36\s*Cr|BMW\s+(?:retainer|3-year)/i },
  { path: "experience.achievements[Ford 3%→32%]", test: /3%\s*to\s*(?:over\s*)?32%|Ford's digital revenue/i },
  { path: "leadershipProfile.boardExposure", test: /board (?:exposure|reporting)|boardExposure/i },
  { path: "strategy.boardReadiness", test: /boardReadiness/i },
  { path: "strategy.targetTitles", test: /targetTitles|target titles|CMO trajectory|SVP.*target list/i },
  { path: "capabilities.growth", test: /capabilities\.growth|Growth Strategy|Demand Generation/i },
  { path: "capabilities.crm", test: /capabilities\.crm|Salesforce Marketing Cloud|Salesforce CDP|CRM (?:aliases|family)/i },
  { path: "capabilities.analytics", test: /capabilities\.analytics|analytics.*family/i },
  { path: "capabilities.transformation", test: /capabilities\.transformation|Center of Excellence|CoE thinking/i },
  { path: "preferences.locations", test: /preferences\.locations|Gurugram|Delhi NCR/i },
  { path: "leadershipProfile.globalMarkets", test: /13[- ](?:market|international)|13 APAC/i },
  { path: "platforms", test: /\bplatforms\b|SFMC|Data Cloud/i },
  { path: "evidence[Center of Excellence]", test: /GCC|Global Capability Center|40-person/i },
  { path: "evidence[CRM Transformation]", test: /legacy-to-Salesforce|CRM (?:migration|reset)/i },
];

function detect(text: string): string[] {
  const hits = DETECTORS.filter((d) => d.test.test(text)).map((d) => d.path);
  return Array.from(new Set(hits));
}

type Cell = {
  opp: Opportunity;
  dim: DimensionResult;
  paths: string[];
  missing: boolean; // no candidateProof at all (excluding intentionally Missing JD)
};

function analyze(list: Opportunity[]): Cell[] {
  const rows: Cell[] = [];
  for (const opp of list) {
    for (const dim of opp.dimensions) {
      const proofText = dim.candidateProof ? `${dim.candidateProof.headline} ${dim.candidateProof.detail}` : "";
      const paths = proofText ? detect(proofText) : [];
      const jdMissing = dim.jdEvidence.status === "Missing";
      const missing = !dim.candidateProof && !jdMissing;
      rows.push({ opp, dim, paths, missing });
    }
  }
  return rows;
}

function MappingQA() {
  const { opportunitiesList } = Route.useLoaderData();
  const rows = analyze(opportunitiesList);
  const totalMappable = rows.filter((r) => r.dim.jdEvidence.status !== "Missing").length;
  const withProof = rows.filter((r) => r.dim.candidateProof).length;
  const withDetected = rows.filter((r) => r.paths.length > 0).length;
  const coverage = totalMappable ? Math.round((withProof / totalMappable) * 100) : 0;
  const detectionRate = withProof ? Math.round((withDetected / withProof) * 100) : 0;

  // fields never referenced anywhere
  const referenced = new Set(rows.flatMap((r) => r.paths));
  const allPaths = DETECTORS.map((d) => d.path);
  const orphanFields = allPaths.filter((p) => !referenced.has(p));

  const byOpp = new Map<string, Cell[]>();
  for (const r of rows) {
    const key = r.opp.jobHash;
    if (!byOpp.has(key)) byOpp.set(key, []);
    byOpp.get(key)!.push(r);
  }

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-6xl px-4 sm:px-8 py-10">
          <h1 className="font-serif text-3xl leading-tight">Mapping QA report</h1>
          <p className="mt-3 max-w-3xl text-sm text-ink-muted">
             For each opportunity × radar dimension, this view shows the JD evidence, the personalization proof rendered
            in the brief, and which <code className="font-mono text-[12px]">candidate-profile.json</code> paths that
            proof references (heuristic match on the proof text).
          </p>

          <dl className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">Dimension coverage</dt>
              <dd className="mt-1 font-serif text-2xl">
                {withProof}/{totalMappable} <span className="text-ink-muted">({coverage}%)</span>
              </dd>
              <p className="text-[12px] text-ink-muted">JD-anchored cells with a candidate proof.</p>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">Field detection</dt>
              <dd className="mt-1 font-serif text-2xl">
                {withDetected}/{withProof} <span className="text-ink-muted">({detectionRate}%)</span>
              </dd>
              <p className="text-[12px] text-ink-muted">Proofs that resolve to a specific profile path.</p>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">Orphan fields</dt>
              <dd className="mt-1 font-serif text-2xl">{orphanFields.length}</dd>
              <p className="text-[12px] text-ink-muted">Tracked profile paths never referenced by any proof.</p>
            </div>
          </dl>

          {orphanFields.length > 0 && (
            <div className="mt-6 rounded-sm border border-hairline bg-white px-4 py-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">Unreferenced paths</span>
              <ul className="mt-2 flex flex-wrap gap-2">
                {orphanFields.map((p) => (
                  <li key={p} className="font-mono text-[11.5px] rounded-sm bg-amber-50 px-2 py-1 text-amber-900 border border-amber-200">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {Array.from(byOpp.entries()).map(([hash, cells]) => {
        const opp = cells[0].opp;
        const missingCount = cells.filter((c) => c.missing).length;
        return (
          <section key={hash} className="border-b border-hairline">
            <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-serif text-xl">
                  <Link to="/opportunity/$jobHash" params={{ jobHash: hash }} className="hover:underline">
                    {opp.decision} · {opp.role} — {opp.company}
                  </Link>
                </h2>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-ink-muted">
                  {missingCount > 0 ? `${missingCount} unmapped` : "fully mapped"}
                </span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-muted">
                      <th className="py-2 pr-4">Dimension</th>
                      <th className="py-2 pr-4">JD evidence</th>
                      <th className="py-2 pr-4">Candidate proof</th>
                      <th className="py-2 pr-4">Profile fields</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cells.map(({ dim, paths, missing }) => {
                      const jdMissing = dim.jdEvidence.status === "Missing";
                      return (
                        <tr key={dim.key} className="border-b border-hairline/60 align-top">
                          <td className="py-3 pr-4">
                            <div className="font-medium">{dim.label}</div>
                            <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-muted">
                              {dim.importance} · {dim.bucket}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-ink-muted">
                            {jdMissing ? (
                              <span className="font-mono text-[11.5px] rounded-sm bg-neutral-100 px-2 py-0.5">Missing in JD</span>
                            ) : (
                              <span className="italic">"{dim.jdEvidence.evidence[0]?.quote}"</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {dim.candidateProof ? (
                              <>
                                <div className="font-medium">{dim.candidateProof.headline}</div>
                                <div className="text-ink-muted">{dim.candidateProof.detail}</div>
                              </>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {paths.length ? (
                              <ul className="flex flex-col gap-1">
                                {paths.map((p) => (
                                  <li key={p} className="font-mono text-[11px] text-ink">
                                    {p}
                                  </li>
                                ))}
                              </ul>
                            ) : dim.candidateProof ? (
                              <span className="font-mono text-[11px] text-amber-800">unresolved</span>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </td>
                          <td className="py-3">
                            {missing ? (
                              <span className="font-mono text-[11px] rounded-sm border border-red-200 bg-red-50 px-2 py-0.5 text-red-800">
                                UNMAPPED
                              </span>
                            ) : jdMissing ? (
                              <span className="font-mono text-[11px] text-ink-muted">n/a</span>
                            ) : paths.length ? (
                              <span className="font-mono text-[11px] rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                                anchored
                              </span>
                            ) : (
                              <span className="font-mono text-[11px] rounded-sm border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900">
                                proof only
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}