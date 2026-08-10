import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/design-system")({
  head: () => ({
    meta: [
      { title: "RADAR v2 — Executive Advisory Constitution & Living Design System" },
      { name: "description", content: "The formal design constitution, semantic tokens, domain components, and editorial principles governing RADAR v2." },
    ],
  }),
  component: DesignSystemPage,
});

type TabType = "foundations" | "components" | "principles";

function DesignSystemPage() {
  const [activeTab, setActiveTab] = useState<TabType>("foundations");

  return (
    <div className="min-h-screen pb-24 bg-background text-foreground font-sans antialiased">
      {/* Header Bar */}
      <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <Link to="/" className="label-mono hover:text-foreground font-normal transition-colors">
              ← Back to Shortlist
            </Link>
            <span className="text-border">|</span>
            <span className="label-mono text-muted-foreground font-normal">Executive Advisory Constitution</span>
          </div>

          {/* Top Section Selector */}
          <nav className="flex items-center gap-1 border border-border rounded-md p-1 bg-background">
            <button
              onClick={() => setActiveTab("foundations")}
              className={`px-4 py-1.5 label-mono uppercase rounded-xs transition-colors cursor-pointer ${
                activeTab === "foundations" ? "bg-foreground text-white font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Foundations
            </button>
            <button
              onClick={() => setActiveTab("components")}
              className={`px-4 py-1.5 label-mono uppercase rounded-xs transition-colors cursor-pointer ${
                activeTab === "components" ? "bg-foreground text-white font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Components
            </button>
            <button
              onClick={() => setActiveTab("principles")}
              className={`px-4 py-1.5 label-mono uppercase rounded-xs transition-colors cursor-pointer ${
                activeTab === "principles" ? "bg-foreground text-white font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Principles
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8">
        {/* Title Hero */}
        <div className="border-b border-border pb-8">
          <span className="label-mono text-muted-foreground font-normal">System Architecture</span>
          <h1 className="mt-2 font-display text-4xl sm:text-6xl text-foreground font-normal tracking-tight">
            Executive Advisory Constitution
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground font-light leading-relaxed">
            Living tokens, domain components, and advisory principles governing executive headroom decisions.
          </p>
        </div>

        {/* TAB 1: FOUNDATIONS */}
        {activeTab === "foundations" && (
          <div className="mt-12 space-y-16">
            {/* 1. Executive Palette & Decision Color Jobs */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">01 / Palette</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Executive Palette &amp; Color Jobs</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-xl font-light">
                  Color in RADAR represents executive judgement—never arbitrary branding or decoration.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-md border border-border p-4 bg-card">
                  <div className="h-10 w-full rounded-xs bg-signal" />
                  <div className="mt-3">
                    <span className="label-mono font-medium text-signal block">Confidence</span>
                    <span className="text-xs text-muted-foreground block mt-1">Green (`--signal`)</span>
                    <p className="text-xs text-foreground mt-2 font-light">High strategic alignment &amp; proven career overlap.</p>
                  </div>
                </div>

                <div className="rounded-md border border-border p-4 bg-card">
                  <div className="h-10 w-full rounded-xs bg-caution" />
                  <div className="mt-3">
                    <span className="label-mono font-medium text-caution block">Unknown</span>
                    <span className="text-xs text-muted-foreground block mt-1">Amber (`--caution`)</span>
                    <p className="text-xs text-foreground mt-2 font-light">Requires validation or missing friction data.</p>
                  </div>
                </div>

                <div className="rounded-md border border-border p-4 bg-card">
                  <div className="h-10 w-full rounded-xs bg-pass" />
                  <div className="mt-3">
                    <span className="label-mono font-medium text-muted-foreground block">Contradiction</span>
                    <span className="text-xs text-muted-foreground block mt-1">Red / Neutral (`--pass`)</span>
                    <p className="text-xs text-foreground mt-2 font-light">Strategic divergence from career trajectory.</p>
                  </div>
                </div>

                <div className="rounded-md border border-border p-4 bg-card">
                  <div className="h-10 w-full rounded-xs bg-border-strong" />
                  <div className="mt-3">
                    <span className="label-mono font-medium text-foreground block">Evidence</span>
                    <span className="text-xs text-muted-foreground block mt-1">Grey (`--border-strong`)</span>
                    <p className="text-xs text-foreground mt-2 font-light">Fact provenance, citations &amp; metadata labels.</p>
                  </div>
                </div>

                <div className="rounded-md border border-border p-4 bg-card">
                  <div className="h-10 w-full rounded-xs bg-foreground" />
                  <div className="mt-3">
                    <span className="label-mono font-medium text-background block">Action</span>
                    <span className="text-xs text-muted-foreground block mt-1">Black (`--foreground`)</span>
                    <p className="text-xs text-foreground mt-2 font-light">Primary decision triggers &amp; application links.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Semantic Spacing Scale */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">02 / Spacing</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Semantic Spacing Scale</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-xl font-light">
                  Rhythmic tokens from `space-1` to `space-7` govern spacing and create a mathematical baseline.
                </p>
              </div>

              <div className="border border-border rounded-md bg-card divide-y divide-border">
                {[
                  { name: "space-1", size: "8px (0.5rem)", usage: "Tight micro-spacing, badge padding, hairline offsets." },
                  { name: "space-2", size: "12px (0.75rem)", usage: "Compact inline gap, chip spacing, dense table cell margin." },
                  { name: "space-3", size: "16px (1.0rem)", usage: "Default element spacing, component padding, list item gap." },
                  { name: "space-4", size: "24px (1.5rem)", usage: "Comfortable container padding, card inset, grid column gap." },
                  { name: "space-5", size: "40px (2.5rem)", usage: "Typical section spacing, mandate block division." },
                  { name: "space-6", size: "64px (4.0rem)", usage: "Chapter break, major dossier segment separator." },
                  { name: "space-7", size: "96px (6.0rem)", usage: "Page transition, hero header margin." },
                ].map((s) => (
                  <div key={s.name} className="flex flex-wrap items-center justify-between p-4 gap-4">
                    <div className="min-w-[140px]">
                      <span className="label-mono text-foreground font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground block">{s.size}</span>
                    </div>
                    <div className="flex-1 text-xs text-foreground font-light max-w-md">
                      {s.usage}
                    </div>
                    <div className="h-4 bg-foreground/15 rounded-xs" style={{ width: s.size.split(" ")[0] }} />
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Grid Architecture & Layout Blueprint */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">03 / Layout</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Grid &amp; Layout Archetypes</h2>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-foreground font-medium block mb-1">Wide Layout</span>
                  <p className="text-xs text-muted-foreground mb-3">Full executive dashboard container (max-w-[1180px]). Used for shortlist queue &amp; corpus browser.</p>
                  <div className="h-16 border border-dashed border-border-strong rounded bg-background flex items-center justify-center text-xs text-muted-foreground">
                    1180px Container (12-Col Responsive)
                  </div>
                </div>

                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-foreground font-medium block mb-1">Reading Layout</span>
                  <p className="text-xs text-muted-foreground mb-3">Optimal reading column (max-w-2xl / 680px). Used for narrative briefs and evidence summaries.</p>
                  <div className="h-16 max-w-[320px] mx-auto border border-dashed border-border-strong rounded bg-background flex items-center justify-center text-xs text-muted-foreground">
                    680px Executive Reading Column
                  </div>
                </div>

                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-foreground font-medium block mb-1">Split Layout</span>
                  <p className="text-xs text-muted-foreground mb-3">Narrative column (60%) + Evidence sidebar (40%). Used for dossier analysis.</p>
                  <div className="grid grid-cols-[1.5fr_1fr] gap-2 h-16 text-xs text-muted-foreground">
                    <div className="border border-dashed border-border-strong rounded bg-background flex items-center justify-center">Narrative Brief (60%)</div>
                    <div className="border border-dashed border-border-strong rounded bg-background flex items-center justify-center">Evidence Rail (40%)</div>
                  </div>
                </div>

                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-foreground font-medium block mb-1">Dense Layout</span>
                  <p className="text-xs text-muted-foreground mb-3">Compact table/list view (`py-3.5`). Fits +1 mandate per viewport in Shortlist Queue.</p>
                  <div className="space-y-1 h-16 overflow-hidden">
                    <div className="h-4 border-b border-border bg-background flex items-center px-2 text-xs text-muted-foreground">01 · VP Growth Mandate · $250K</div>
                    <div className="h-4 border-b border-border bg-background flex items-center px-2 text-xs text-muted-foreground">02 · Chief Commercial Officer · $320K</div>
                    <div className="h-4 border-b border-border bg-background flex items-center px-2 text-xs text-muted-foreground">03 · Head of Digital Strategy · $210K</div>
                  </div>
                </div>
              </div>
            </section>

            {/* 4. Elevation & Paper Surface Philosophy */}
            <section className="border border-border rounded-md p-8 bg-card">
              <span className="label-mono text-primary font-normal block mb-1">Surface Philosophy</span>
              <h3 className="font-display text-2xl text-foreground font-normal">Paper Surface Elevation</h3>
              <p className="mt-3 text-sm text-foreground leading-relaxed font-light max-w-3xl">
                "Components exist on paper. Separation is achieved through rhythm, typography, and rules—never heavy drop shadows or floating SaaS cards."
              </p>
            </section>
          </div>
        )}

        {/* TAB 2: COMPONENTS (Organized by Domain Object) */}
        {activeTab === "components" && (
          <div className="mt-12 space-y-16">
            {/* 1. Advisory Components */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">01 / Advisory</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Advisory Components</h2>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Recommendation Panel */}
                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-muted-foreground block mb-3">Recommendation Panel</span>
                  <div className="border-l-2 border-signal pl-4 py-2">
                    <span className="label-mono text-signal font-normal block">Verdict · Pursue</span>
                    <p className="font-display text-xl text-foreground mt-1">Direct P&amp;L ownership with proven scale overlap.</p>
                  </div>
                </div>

                {/* Proceed/Pause Callouts */}
                <div className="border border-border rounded-md p-6 bg-card space-y-4">
                  <span className="label-mono text-muted-foreground block mb-2">Proceed / Pause Callouts</span>
                  <div className="border-l-2 border-signal pl-3">
                    <p className="label-mono text-signal">Proceed If</p>
                    <p className="text-xs text-foreground mt-1">Strong commercial alignment to precedent trajectory.</p>
                  </div>
                  <div className="border-l-2 border-caution pl-3">
                    <p className="label-mono text-caution">Pause If</p>
                    <p className="text-xs text-foreground mt-1">Reporting line is below CXO level.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Evidence Components */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">02 / Evidence</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Evidence Components</h2>
              </div>

              <div className="border border-border rounded-md p-6 bg-card space-y-6">
                <div>
                  <span className="label-mono text-muted-foreground block mb-3">Evidence Table &amp; Claim Row</span>
                  <div className="border border-border rounded overflow-hidden divide-y divide-border">
                    <div className="flex items-center justify-between p-3 bg-muted/30">
                      <span className="label-mono text-foreground font-normal">Mandate Claim</span>
                      <span className="label-mono text-muted-foreground">Proven Match</span>
                    </div>
                    <div className="flex items-center justify-between p-3">
                      <span className="text-xs text-foreground font-normal">Scale P&amp;L from $10M to $50M</span>
                      <span className="label-mono rounded px-2 py-0.5 bg-signal/15 text-signal text-xs">Verified (94%)</span>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="label-mono text-muted-foreground block mb-3">Evidence Pills &amp; Badges</span>
                  <div className="flex flex-wrap gap-2">
                    <span className="label-mono rounded px-2 py-1 bg-signal text-white">Pursue Badge</span>
                    <span className="label-mono rounded px-2 py-1 bg-caution text-white">Consider Badge</span>
                    <span className="label-mono rounded px-2 py-1 bg-muted text-muted-foreground">Pass Badge</span>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. Navigation & Structural Components */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">03 / Navigation</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Navigation &amp; Structural Components</h2>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-muted-foreground block mb-3">Sticky Executive Action Bar</span>
                  <div className="flex items-center gap-2 p-3 bg-background border border-border rounded">
                    <button className="px-3 py-1.5 bg-signal text-white label-mono uppercase rounded-xs">Pursue</button>
                    <button className="px-3 py-1.5 border border-caution/50 text-caution label-mono uppercase rounded-xs">Consider</button>
                    <button className="px-3 py-1.5 border border-border text-muted-foreground label-mono uppercase rounded-xs">Pass</button>
                    <button className="ml-auto px-3 py-1.5 bg-foreground text-white label-mono uppercase rounded-xs">Apply ↗</button>
                  </div>
                </div>

                <div className="border border-border rounded-md p-6 bg-card">
                  <span className="label-mono text-muted-foreground block mb-3">Section Marker</span>
                  <div className="flex items-baseline gap-3 border-b border-border pb-2">
                    <span className="font-display text-2xl text-border-strong">III</span>
                    <span className="label-mono text-foreground">Strategic Alignment</span>
                  </div>
                </div>
              </div>
            </section>

            {/* 4. Empty & Loading States */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">04 / States</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Empty &amp; Loading States</h2>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="border border-dashed border-border rounded-md p-8 text-center bg-card">
                  <span className="label-mono text-muted-foreground block mb-2">Empty State</span>
                  <p className="font-display text-xl text-foreground">No mandate recommendations pending review.</p>
                  <p className="text-xs text-muted-foreground mt-1">All scraped opportunities have been evaluated into your decision register.</p>
                </div>

                <div className="border border-border rounded-md p-8 bg-card space-y-3">
                  <span className="label-mono text-muted-foreground block mb-2">Skeleton Loading State</span>
                  <div className="h-4 bg-muted/60 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-muted/40 rounded w-1/2 animate-pulse" />
                  <div className="h-3 bg-muted/30 rounded w-5/6 animate-pulse" />
                </div>
              </div>
            </section>

            {/* 5. Executive Data Formatting Standards */}
            <section className="border border-border rounded-md p-6 bg-card space-y-4">
              <div>
                <span className="label-mono text-primary font-normal">05 / Data Formatting</span>
                <h3 className="font-display text-2xl text-foreground font-normal mt-1">Executive Data Standards</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 text-xs">
                <div className="p-3 border border-border rounded">
                  <span className="label-mono text-muted-foreground block mb-1">Currency</span>
                  <span className="font-mono text-foreground font-medium">₹2.4 Cr · $250K</span>
                  <span className="text-xs text-muted-foreground block mt-1">Never raw unformatted integers like `24000000`.</span>
                </div>

                <div className="p-3 border border-border rounded">
                  <span className="label-mono text-muted-foreground block mb-1">Dates</span>
                  <span className="font-mono text-foreground font-medium">06 Aug 2026</span>
                  <span className="text-xs text-muted-foreground block mt-1">Standardized DD MMM YYYY format.</span>
                </div>

                <div className="p-3 border border-border rounded">
                  <span className="label-mono text-muted-foreground block mb-1">Percentages</span>
                  <span className="font-mono text-foreground font-medium">94% overlap</span>
                  <span className="text-xs text-muted-foreground block mt-1">Evidence fit coverage ratio.</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: PRINCIPLES */}
        {activeTab === "principles" && (
          <div className="mt-12 space-y-16">
            {/* 1. Editorial Principles */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">01 / Principles</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Editorial Principles</h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { title: "One idea per screen.", desc: "Each viewport section conveys a single advisory statement or proof point." },
                  { title: "Evidence before recommendation.", desc: "Claims and verified facts must precede executive verdict controls." },
                  { title: "Whitespace communicates confidence.", desc: "Calibrated spacing (`space-1` to `space-7`) replaces noisy borders and heavy dividers." },
                  { title: "Typography carries hierarchy.", desc: "Instrument Serif headlines, Manrope body copy, and JetBrains Mono metadata." },
                  { title: "Every component answers a question.", desc: "Explicit semantics: Proceed If, Pause If, Watch For, Evidence provenance." },
                  { title: "Color indicates judgement.", desc: "Green (Confidence), Amber (Unknown), Red (Contradiction), Grey (Evidence), Black (Action)." },
                ].map((p, idx) => (
                  <div key={idx} className="border border-border rounded-md p-5 bg-card">
                    <span className="label-mono text-primary block mb-2">Rule 0{idx + 1}</span>
                    <h3 className="font-display text-xl text-foreground font-normal">{p.title}</h3>
                    <p className="text-xs text-muted-foreground font-light mt-2 leading-relaxed">{p.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 2. Component Hierarchy Architecture */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">02 / Hierarchy</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Component Hierarchy Tree</h2>
              </div>

              <div className="border border-border rounded-md p-6 bg-card font-mono text-xs text-foreground space-y-2">
                <p className="text-muted-foreground">// Structural React Component Architecture</p>
                <div className="pl-0 text-foreground font-semibold">Page (e.g. Executive Dossier / Shortlist Queue)</div>
                <div className="pl-4 text-primary">└── Chapter (e.g. Executive Brief / Proof Chain)</div>
                <div className="pl-8 text-foreground">    └── Section (e.g. Mandate Overlap / Watch For)</div>
                <div className="pl-12 text-signal font-medium">        └── Component (e.g. Recommendation Panel / Proceed Block)</div>
                <div className="pl-16 text-muted-foreground">            └── Primitive (e.g. Label / Badge / Hairline Divider)</div>
              </div>
            </section>

            {/* 3. Motion Restraint Protocol */}
            <section className="space-y-6">
              <div>
                <span className="label-mono text-primary font-normal">03 / Motion</span>
                <h2 className="font-display text-3xl text-foreground font-normal mt-1">Motion Principles</h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="border border-border rounded-md p-4 bg-card">
                  <span className="label-mono text-foreground font-medium block">Principle 01</span>
                  <p className="font-display text-lg text-foreground mt-1">Motion never entertains.</p>
                </div>
                <div className="border border-border rounded-md p-4 bg-card">
                  <span className="label-mono text-foreground font-medium block">Principle 02</span>
                  <p className="font-display text-lg text-foreground mt-1">Motion only explains.</p>
                </div>
                <div className="border border-border rounded-md p-4 bg-card">
                  <span className="label-mono text-foreground font-medium block">Principle 03</span>
                  <p className="font-display text-lg text-foreground mt-1">Motion is always interruptible.</p>
                </div>
                <div className="border border-border rounded-md p-4 bg-card">
                  <span className="label-mono text-foreground font-medium block">Principle 04</span>
                  <p className="font-display text-lg text-foreground mt-1">Motion never blocks reading.</p>
                </div>
              </div>
            </section>

            {/* 4. Icon Restraint Philosophy */}
            <section className="border border-border rounded-md p-8 bg-card">
              <span className="label-mono text-primary font-normal block mb-1">Icon Philosophy</span>
              <h3 className="font-display text-2xl text-foreground font-normal">Iconography Restraint</h3>
              <p className="mt-3 text-sm text-foreground leading-relaxed font-light max-w-3xl">
                "Icons clarify. Typography communicates. Decoration is avoided."
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
