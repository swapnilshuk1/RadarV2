import { createFileRoute } from "@tanstack/react-router";
import React from "react";

export const Route = createFileRoute("/workbench")({
  head: () => ({
    meta: [
      { title: "Acquisition Workbench — RADAR" },
    ],
  }),
  component: AcquisitionWorkbench,
});

function AcquisitionWorkbench() {
  return (
    <div className="min-h-screen bg-sand-50/50 pb-20">
      <header>
        <div className="border-b border-sand-200/50 bg-white/50 backdrop-blur-md sticky top-0 z-30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-ink">Acquisition Workbench</span>
              <span className="text-sand-500 text-sm">Control Tower</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-8 space-y-12">
        {/* Campaign Overview Section */}
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-xl font-medium text-ink">Campaign: Executive Leadership</h2>
            <div className="text-sm font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
              Coverage: 82%
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard title="Families Enabled" value="23" sub="out of 25 (2 paused)" />
            <MetricCard title="Searches Executed" value="119" sub="out of 284" />
            <MetricCard title="New Jobs" value="54" sub="Yield: 6.5%" />
            <MetricCard title="Duplicates" value="781" sub="Rate: 93.5%" />
          </div>
        </section>

        {/* Deep Dive Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <h3 className="text-lg font-medium text-ink border-b border-sand-200 pb-2">Family Performance</h3>
            <div className="space-y-4">
              <FamilyRow name="Marketing Leadership" yieldPct="18%" freshness="3.2 days" dupRate="76%" coverage="91%" />
              <FamilyRow name="Commercial Leadership" yieldPct="14%" freshness="4.1 days" dupRate="81%" coverage="88%" />
              <FamilyRow name="Transformation" yieldPct="12%" freshness="2.5 days" dupRate="85%" coverage="70%" />
              <FamilyRow name="Brand Marketing" yieldPct="2%" freshness="8.0 days" dupRate="98%" coverage="100%" status="Low Yield" />
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-medium text-ink border-b border-sand-200 pb-2 mb-4">Top Companies</h3>
              <ul className="space-y-2 text-sm text-ink-light">
                <li className="flex justify-between"><span>Adobe</span><span className="font-medium text-ink">12 opps</span></li>
                <li className="flex justify-between"><span>Microsoft</span><span className="font-medium text-ink">8 opps</span></li>
                <li className="flex justify-between"><span>Mastercard</span><span className="font-medium text-ink">7 opps</span></li>
                <li className="flex justify-between"><span>PepsiCo</span><span className="font-medium text-ink">5 opps</span></li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-medium text-ink border-b border-sand-200 pb-2 mb-4">Coverage Signals</h3>
              <div className="bg-white border border-sand-200 p-4 rounded-xl shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-emerald-600">High Yield</span>
                  <span className="text-xs bg-sand-100 px-2 py-0.5 rounded text-sand-600">Transformation</span>
                </div>
                <button className="w-full text-xs font-medium bg-sand-100 hover:bg-sand-200 text-ink py-1.5 rounded transition-colors">
                  Expand Catalog
                </button>
                <hr className="border-sand-200" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-rose-600">Low Yield</span>
                  <span className="text-xs bg-sand-100 px-2 py-0.5 rounded text-sand-600">Brand Marketing</span>
                </div>
                <button className="w-full text-xs font-medium bg-sand-100 hover:bg-sand-200 text-ink py-1.5 rounded transition-colors">
                  Reduce Budget
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ title, value, sub }: { title: string, value: string, sub: string }) {
  return (
    <div className="bg-white border border-sand-200 rounded-xl p-5 shadow-sm">
      <h4 className="text-sm font-medium text-sand-500 mb-1">{title}</h4>
      <div className="text-3xl font-semibold text-ink tracking-tight">{value}</div>
      <div className="text-xs text-sand-500 mt-2">{sub}</div>
    </div>
  );
}

function FamilyRow({ name, yieldPct, freshness, dupRate, coverage, status }: any) {
  return (
    <div className="flex items-center justify-between bg-white border border-sand-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      <div>
        <div className="font-medium text-ink flex items-center gap-2">
          {name}
          {status && <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">{status}</span>}
        </div>
        <div className="text-xs text-sand-500 mt-1 flex gap-4">
          <span>Yield: <span className="font-medium text-ink-light">{yieldPct}</span></span>
          <span>Dupes: <span className="font-medium text-ink-light">{dupRate}</span></span>
          <span>Fresh: <span className="font-medium text-ink-light">{freshness}</span></span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-ink">{coverage}</div>
        <div className="text-xs text-sand-400">Coverage</div>
      </div>
    </div>
  );
}
