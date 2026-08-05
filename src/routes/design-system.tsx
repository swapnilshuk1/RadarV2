import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/design-system")({
  head: () => ({
    meta: [
      { title: "RADAR v2 — Design System & Advisory Register" },
      { name: "description", content: "Executive design system tokens, typography rules, and editorial paper components." },
    ],
  }),
  component: DesignSystemPage,
});

function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-24">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 sm:py-12">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="label-mono hover:text-foreground font-normal">
              ← Return to Shortlist
            </Link>
            <span className="label-mono text-muted-foreground font-normal">
              RADAR v2 Design System · Reference v2.4
            </span>
          </div>

          <h1 className="mt-6 font-display text-4xl sm:text-6xl text-foreground font-normal">
            Executive Advisory Register
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground font-normal">
            The authoritative visual design system and component register for RADAR v2. Designed for high-tier executive readability on warm parchment.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8 space-y-16">
        {/* SECTION 1: COLOR PALETTE */}
        <section className="space-y-6">
          <div>
            <span className="label-mono text-primary font-normal">01 / Palette</span>
            <h2 className="font-display text-3xl text-foreground font-normal mt-1">Color Tokens</h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 border border-border rounded-sm bg-background">
              <div className="h-12 w-full rounded-xs bg-background border border-border" />
              <p className="font-mono text-xs mt-3 font-medium text-foreground">--background</p>
              <p className="font-mono text-[0.65rem] text-muted-foreground">#FAF8F5 (Warm Parchment)</p>
            </div>

            <div className="p-4 border border-border rounded-sm bg-background">
              <div className="h-12 w-full rounded-xs bg-foreground" />
              <p className="font-mono text-xs mt-3 font-medium text-foreground">--foreground</p>
              <p className="font-mono text-[0.65rem] text-muted-foreground">#222222 (Deep Ink)</p>
            </div>

            <div className="p-4 border border-border rounded-sm bg-background">
              <div className="h-12 w-full rounded-xs bg-signal" />
              <p className="font-mono text-xs mt-3 font-medium text-foreground">--signal</p>
              <p className="font-mono text-[0.65rem] text-muted-foreground">oklch(0.42 0.12 155) (Emerald)</p>
            </div>

            <div className="p-4 border border-border rounded-sm bg-background">
              <div className="h-12 w-full rounded-xs bg-caution" />
              <p className="font-mono text-xs mt-3 font-medium text-foreground">--caution</p>
              <p className="font-mono text-[0.65rem] text-muted-foreground">#B25E00 (Warm Amber)</p>
            </div>
          </div>
        </section>

        {/* SECTION 2: TYPOGRAPHY HIERARCHY */}
        <section className="space-y-6 border-t border-border pt-12">
          <div>
            <span className="label-mono text-primary font-normal">02 / Typography</span>
            <h2 className="font-display text-3xl text-foreground font-normal mt-1">Font Hierarchy</h2>
          </div>

          <div className="space-y-8 divide-y divide-border">
            <div className="pt-4">
              <span className="label-mono block text-muted-foreground mb-2">Display H1 (Instrument Serif 400)</span>
              <p className="font-display text-4xl sm:text-6xl text-foreground font-normal">
                The shortlist.
              </p>
            </div>

            <div className="pt-6">
              <span className="label-mono block text-muted-foreground mb-2">Display H2 (Instrument Serif 400)</span>
              <p className="font-display text-2xl sm:text-4xl text-foreground font-normal">
                Yes — but for a very specific reason.
              </p>
            </div>

            <div className="pt-6">
              <span className="label-mono block text-muted-foreground mb-2">Pull Quote / Serif Body (Instrument Serif 400 Italic/Normal)</span>
              <p className="font-display text-xl sm:text-2xl text-foreground font-normal max-w-2xl">
                A solid tactical fit. While slightly below C-suite altitude, this Head seat offers direct functional execution authority.
              </p>
            </div>

            <div className="pt-6">
              <span className="label-mono block text-muted-foreground mb-2">Eyebrow Mono (.label-mono / JetBrains Mono)</span>
              <p className="label-mono text-foreground font-normal">
                TODAY'S EXECUTIVE BRIEFING · 06 AUG 2026 · BRIEF 01 OF 689
              </p>
            </div>

            <div className="pt-6">
              <span className="label-mono block text-muted-foreground mb-2">Body Text (Manrope 400)</span>
              <p className="text-sm sm:text-base text-foreground font-normal leading-relaxed max-w-xl">
                Significant increase in commercial ownership and P&amp;L execution at DaMENSCH focused on growth strategy and commercial performance.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 3: DECISION BADGES & BUTTONS */}
        <section className="space-y-6 border-t border-border pt-12">
          <div>
            <span className="label-mono text-primary font-normal">03 / Actions</span>
            <h2 className="font-display text-3xl text-foreground font-normal mt-1">Decision Badges &amp; Buttons</h2>
          </div>

          <div className="space-y-6">
            <div>
              <span className="label-mono block text-muted-foreground mb-3">Status Badges</span>
              <div className="flex flex-wrap gap-3 items-center">
                <span className="label-mono rounded-[3px] bg-signal px-2 py-1 text-white font-normal uppercase">
                  Pursue
                </span>
                <span className="label-mono rounded-[3px] bg-caution px-2 py-1 text-white font-normal uppercase">
                  Consider
                </span>
                <span className="label-mono rounded-[3px] bg-muted px-2 py-1 text-muted-foreground font-normal uppercase">
                  Pass
                </span>
              </div>
            </div>

            <div>
              <span className="label-mono block text-muted-foreground mb-3">Executive Action Buttons</span>
              <div className="flex flex-wrap gap-3 items-center">
                <button className="rounded-[4px] bg-signal px-5 py-2.5 label-mono text-white font-normal uppercase">
                  Pursue
                </button>
                <button className="rounded-[4px] border border-caution/50 px-5 py-2.5 label-mono text-caution font-normal uppercase">
                  Consider
                </button>
                <button className="rounded-[4px] border border-border px-5 py-2.5 label-mono text-muted-foreground font-normal uppercase">
                  Pass
                </button>
                <button className="rounded-[4px] bg-foreground px-5 py-2.5 label-mono text-white font-normal uppercase">
                  Apply ↗
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: CALLOUT BLOCKS & DIVIDERS */}
        <section className="space-y-6 border-t border-border pt-12">
          <div>
            <span className="label-mono text-primary font-normal">04 / Callouts</span>
            <h2 className="font-display text-3xl text-foreground font-normal mt-1">Editorial Callout Blocks</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="border-l-2 border-signal pl-4">
              <p className="label-mono text-signal font-normal">Proceed if / Why pursue</p>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground font-normal">
                Direct P&amp;L ownership aligned to your marketing strategy precedents.
              </p>
            </div>

            <div className="border-l-2 border-caution pl-4">
              <p className="label-mono text-caution font-normal">Pause if / Watch for</p>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground font-normal">
                Confirm regional P&amp;L boundaries during initial recruiter screening call.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 5: UNBOXED LIST ITEMS */}
        <section className="space-y-6 border-t border-border pt-12">
          <div>
            <span className="label-mono text-primary font-normal">05 / List Structure</span>
            <h2 className="font-display text-3xl text-foreground font-normal mt-1">Unboxed Paper Lists</h2>
          </div>

          <ol className="divide-y divide-border border-y border-border">
            <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4">
              <span className="label-mono tabular-nums text-border-strong font-normal">01</span>
              <p className="text-sm leading-relaxed text-foreground font-normal">
                Moves you closer to enterprise CMO / CCO scope through direct commercial ownership.
              </p>
            </li>
            <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4">
              <span className="label-mono tabular-nums text-border-strong font-normal">02</span>
              <p className="text-sm leading-relaxed text-foreground font-normal">
                Increases P&amp;L authority and multi-market growth expansion experience.
              </p>
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}
