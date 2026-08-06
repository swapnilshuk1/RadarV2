import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type Opportunity, type DecisionVerb } from "../data/opportunity-fixtures";
import { InlineBrief } from "../components/radar/InlineBrief";
import { useDecisions } from "../lib/decisions-store";
import { getOpportunitiesFn } from "../lib/intelligence/opportunity-server";
import { getScraperCounts } from "../data/scraped-jobs";

export const Route = createFileRoute("/font-sandbox")({
  head: () => ({
    meta: [
      { title: "Font Sandbox — RADAR Executive Advisory" },
      { name: "description", content: "Interactive font testing sandbox for RADAR typography." },
    ],
  }),
  loader: async () => {
    return {
      opportunitiesList: await getOpportunitiesFn(),
    };
  },
  component: FontSandbox,
});

// Curated Google Fonts collection
const FONT_OPTIONS = {
  serifDisplay: [
    { name: "Instrument Serif", family: "'Instrument Serif', Georgia, serif", importName: "Instrument+Serif" },
    { name: "Playfair Display", family: "'Playfair Display', Georgia, serif", importName: "Playfair+Display:ital,wght@0,400..700;1,400..700" },
    { name: "Bodoni Moda", family: "'Bodoni Moda', Georgia, serif", importName: "Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..700" },
    { name: "Newsreader", family: "'Newsreader', Georgia, serif", importName: "Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700" },
    { name: "Cormorant Garamond", family: "'Cormorant Garamond', Georgia, serif", importName: "Cormorant+Garamond:ital,wght@0,400..700;1,400..700" },
    { name: "Lora", family: "'Lora', Georgia, serif", importName: "Lora:ital,wght@0,400..700;1,400..700" },
    { name: "Fraunces", family: "'Fraunces', Georgia, serif", importName: "Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700" },
    { name: "Merriweather", family: "'Merriweather', Georgia, serif", importName: "Merriweather:ital,wght@0,300..700;1,300..700" },
    { name: "EB Garamond", family: "'EB Garamond', Georgia, serif", importName: "EB+Garamond:ital,wght@0,400..700;1,400..700" },
    { name: "Cinzel", family: "'Cinzel', Georgia, serif", importName: "Cinzel:wght@400..700" },
  ],
  sans: [
    { name: "Manrope", family: "'Manrope', sans-serif", importName: "Manrope:wght@400..700" },
    { name: "Inter", family: "'Inter', sans-serif", importName: "Inter:wght@300..700" },
    { name: "Outfit", family: "'Outfit', sans-serif", importName: "Outfit:wght@300..700" },
    { name: "Plus Jakarta Sans", family: "'Plus Jakarta Sans', sans-serif", importName: "Plus+Jakarta+Sans:wght@300..700" },
    { name: "DM Sans", family: "'DM Sans', sans-serif", importName: "DM+Sans:ital,wght@0,300..700;1,300..700" },
    { name: "Space Grotesk", family: "'Space Grotesk', sans-serif", importName: "Space+Grotesk:wght@300..700" },
    { name: "Public Sans", family: "'Public Sans', sans-serif", importName: "Public+Sans:ital,wght@0,300..700;1,300..700" },
    { name: "Open Sans", family: "'Open Sans', sans-serif", importName: "Open+Sans:ital,wght@0,300..700;1,300..700" },
    { name: "Roboto", family: "'Roboto', sans-serif", importName: "Roboto:ital,wght@0,300..700;1,300..700" },
  ],
  mono: [
    { name: "JetBrains Mono", family: "'JetBrains Mono', monospace", importName: "JetBrains+Mono:wght@400..700" },
    { name: "Space Mono", family: "'Space Mono', monospace", importName: "Space+Mono:ital,wght@0,400;0,700;1,400" },
    { name: "IBM Plex Mono", family: "'IBM Plex Mono', monospace", importName: "IBM+Plex+Mono:ital,wght@0,300..700;1,300..700" },
    { name: "Fira Code", family: "'Fira Code', monospace", importName: "Fira+Code:wght@300..700" },
    { name: "Inconsolata", family: "'Inconsolata', monospace", importName: "Inconsolata:wght@300..700" },
    { name: "Roboto Mono", family: "'Roboto Mono', monospace", importName: "Roboto+Mono:ital,wght@0,300..700;1,300..700" },
  ]
};

const PRESETS = [
  {
    name: "Classic RADAR",
    pageTitle: "Instrument Serif",
    roleTitle: "Instrument Serif",
    briefHeadline: "Instrument Serif",
    body: "Manrope",
    mono: "JetBrains Mono"
  },
  {
    name: "High Readability Modern",
    pageTitle: "Playfair Display",
    roleTitle: "Plus Jakarta Sans",
    briefHeadline: "Playfair Display",
    body: "Inter",
    mono: "Space Mono"
  },
  {
    name: "Pure Inter (Swiss Grotesk)",
    pageTitle: "Inter",
    roleTitle: "Inter",
    briefHeadline: "Inter",
    body: "Inter",
    mono: "JetBrains Mono"
  },
  {
    name: "Geometric Tech (Space + Jakarta)",
    pageTitle: "Space Grotesk",
    roleTitle: "Space Grotesk",
    briefHeadline: "Plus Jakarta Sans",
    body: "Plus Jakarta Sans",
    mono: "Space Mono"
  },
  {
    name: "Silicon Valley Exec (Outfit + DM Sans)",
    pageTitle: "Outfit",
    roleTitle: "Outfit",
    briefHeadline: "Outfit",
    body: "DM Sans",
    mono: "IBM Plex Mono"
  },
  {
    name: "Editorial Neo-Grotesk (Public Sans)",
    pageTitle: "Public Sans",
    roleTitle: "Public Sans",
    briefHeadline: "Public Sans",
    body: "Public Sans",
    mono: "Fira Code"
  },
  {
    name: "Humanist Executive (Manrope + Open)",
    pageTitle: "Manrope",
    roleTitle: "Manrope",
    briefHeadline: "Manrope",
    body: "Open Sans",
    mono: "Roboto Mono"
  },
  {
    name: "Architectural Sans (Space + Inter)",
    pageTitle: "Space Grotesk",
    roleTitle: "Plus Jakarta Sans",
    briefHeadline: "Outfit",
    body: "Inter",
    mono: "IBM Plex Mono"
  },
  {
    name: "Literary Editorial",
    pageTitle: "Cormorant Garamond",
    roleTitle: "Bodoni Moda",
    briefHeadline: "Newsreader",
    body: "Public Sans",
    mono: "JetBrains Mono"
  },
  {
    name: "Warm Journal",
    pageTitle: "Fraunces",
    roleTitle: "Lora",
    briefHeadline: "Fraunces",
    body: "Open Sans",
    mono: "Fira Code"
  }
];

function FontSandbox() {
  const { decisions, decide: recordDecision } = useDecisions();
  const [open, setOpen] = useState<string | null>("j-001"); // Default open top card to test brief

  const loaderData = Route.useLoaderData();
  const opportunitiesList: Opportunity[] = (loaderData as any)?.opportunitiesList || [];
  const baseCounts = getScraperCounts();

  // Control Panel Toggle State
  const [showExplorer, setShowExplorer] = useState(true);

  // Font selections state
  const [pageTitleFont, setPageTitleFont] = useState("Instrument Serif");
  const [roleTitleFont, setRoleTitleFont] = useState("Instrument Serif");
  const [briefHeadlineFont, setBriefHeadlineFont] = useState("Instrument Serif");
  const [bodyFont, setBodyFont] = useState("Manrope");
  const [monoFont, setMonoFont] = useState("JetBrains Mono");

  const [titleWeight, setTitleWeight] = useState("400");
  const [bodyWeight, setBodyWeight] = useState("400");
  const [letterSpacing, setLetterSpacing] = useState("0em");

  // Dynamically load chosen Google Fonts
  useEffect(() => {
    const allSelected = [pageTitleFont, roleTitleFont, briefHeadlineFont, bodyFont, monoFont];
    const uniqueImports: string[] = [];

    allSelected.forEach((fontName) => {
      const found =
        FONT_OPTIONS.serifDisplay.find((f) => f.name === fontName) ||
        FONT_OPTIONS.sans.find((f) => f.name === fontName) ||
        FONT_OPTIONS.mono.find((f) => f.name === fontName);
      if (found && !uniqueImports.includes(found.importName)) {
        uniqueImports.push(found.importName);
      }
    });

    if (uniqueImports.length === 0) return;

    const linkId = "google-fonts-sandbox-link";
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?${uniqueImports.map((i) => `family=${i}`).join("&")}&display=swap`;
  }, [pageTitleFont, roleTitleFont, briefHeadlineFont, bodyFont, monoFont]);

  // Find font families by name
  const getFamily = (fontName: string) => {
    const found =
      FONT_OPTIONS.serifDisplay.find((f) => f.name === fontName) ||
      FONT_OPTIONS.sans.find((f) => f.name === fontName) ||
      FONT_OPTIONS.mono.find((f) => f.name === fontName);
    return found ? found.family : "sans-serif";
  };

  const remaining = useMemo(
    () => opportunitiesList.filter((o: Opportunity) => !decisions[o.jobHash]),
    [opportunitiesList, decisions]
  );
  const visible = remaining.slice(0, 10);

  const decide = (jobHash: string, verb: DecisionVerb) => {
    recordDecision(jobHash, verb);
    setOpen((cur) => (cur === jobHash ? null : cur));
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setPageTitleFont(preset.pageTitle);
    setRoleTitleFont(preset.roleTitle);
    setBriefHeadlineFont(preset.briefHeadline);
    setBodyFont(preset.body);
    setMonoFont(preset.mono);
  };

  return (
    <div className="min-h-screen pb-24 bg-background text-foreground">
      {/* ────────────────────────────────────────────────────────────────────────
          STICKY FONT CONTROL SANDBOX PANEL
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur-md shadow-md transition-all">
        {!showExplorer ? (
          /* Collapsed View Bar */
          <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-2.5 sm:px-8">
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground truncate">
              <span className="font-semibold uppercase tracking-widest text-primary">Typography Active:</span>
              <span className="truncate">Header: <strong className="text-foreground font-medium">{pageTitleFont}</strong></span>
              <span className="hidden sm:inline">· Role: <strong className="text-foreground font-medium">{roleTitleFont}</strong></span>
              <span className="hidden md:inline">· Body: <strong className="text-foreground font-medium">{bodyFont}</strong></span>
              <span className="hidden lg:inline">· Mono: <strong className="text-foreground font-medium">{monoFont}</strong></span>
            </div>
            <button
              onClick={() => setShowExplorer(true)}
              className="ml-4 shrink-0 rounded bg-foreground px-3 py-1.5 font-mono text-xs text-background font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5"
            >
              ⚙️ Show Font Explorer ▼
            </button>
          </div>
        ) : (
          /* Full Control Panel View */
          <div className="mx-auto max-w-[1280px] px-4 py-4 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3">
              <div>
                <span className="font-mono text-[11px] uppercase tracking-widest text-primary font-semibold">
                  RADAR Typography Sandbox
                </span>
                <h2 className="font-serif text-lg text-foreground font-medium">
                  Live Shortlist Font Evaluator
                </h2>
              </div>

              {/* Presets & Hide Button */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground mr-1">Presets:</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyPreset(p)}
                    className="rounded border border-border bg-surface-raised px-2.5 py-1 text-xs font-sans hover:bg-foreground hover:text-background transition-colors cursor-pointer"
                  >
                    {p.name}
                  </button>
                ))}

                <button
                  onClick={() => setShowExplorer(false)}
                  className="ml-2 rounded border border-border bg-foreground px-3 py-1 text-xs font-mono text-background hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1 font-medium"
                  title="Hide control panel to view full post"
                >
                  Hide Explorer ▲
                </button>
              </div>
            </div>

          {/* Form Controls */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            {/* Control 1: Page Title */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Page Header ("The shortlist.")
              </label>
              <select
                value={pageTitleFont}
                onChange={(e) => setPageTitleFont(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-sans text-xs focus:ring-1 focus:ring-primary"
              >
                <optgroup label="Serif / Display">
                  {FONT_OPTIONS.serifDisplay.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Sans-Serif">
                  {FONT_OPTIONS.sans.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Control 2: Role Title */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Role Title ("Head of Growth")
              </label>
              <select
                value={roleTitleFont}
                onChange={(e) => setRoleTitleFont(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-sans text-xs focus:ring-1 focus:ring-primary"
              >
                <optgroup label="Serif / Display">
                  {FONT_OPTIONS.serifDisplay.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Sans-Serif">
                  {FONT_OPTIONS.sans.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Control 3: Executive Brief Headline */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Brief Headline ("A non-executive...")
              </label>
              <select
                value={briefHeadlineFont}
                onChange={(e) => setBriefHeadlineFont(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-sans text-xs focus:ring-1 focus:ring-primary"
              >
                <optgroup label="Serif / Display">
                  {FONT_OPTIONS.serifDisplay.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Sans-Serif">
                  {FONT_OPTIONS.sans.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Control 4: Body Prose */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Body Prose / Paragraphs
              </label>
              <select
                value={bodyFont}
                onChange={(e) => setBodyFont(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-sans text-xs focus:ring-1 focus:ring-primary"
              >
                <optgroup label="Sans-Serif">
                  {FONT_OPTIONS.sans.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Serif">
                  {FONT_OPTIONS.serifDisplay.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Control 5: Monospace / Labels */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Monospace / Metadata
              </label>
              <select
                value={monoFont}
                onChange={(e) => setMonoFont(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-sans text-xs focus:ring-1 focus:ring-primary"
              >
                {FONT_OPTIONS.mono.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          LIVE SHORTLIST PAGE RENDER ENGINE
          ──────────────────────────────────────────────────────────────────────── */}
      <main
        className="mx-auto max-w-[1180px] px-5 sm:px-8 mt-8"
        style={{
          fontFamily: getFamily(bodyFont),
          fontWeight: bodyWeight,
          letterSpacing: letterSpacing,
        }}
      >
        {/* Header Summary */}
        <section className="grid gap-8 border-b border-border py-9 sm:py-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p
              className="text-xs uppercase tracking-widest text-muted-foreground"
              style={{ fontFamily: getFamily(monoFont) }}
            >
              Today's executive briefing · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </p>
            <h1
              className="mt-3 text-[3.25rem] leading-[0.92] tracking-tight sm:text-7xl text-foreground"
              style={{ fontFamily: getFamily(pageTitleFont), fontWeight: titleWeight }}
            >
              The shortlist.
            </h1>
            <p
              className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground font-normal"
              style={{ fontFamily: getFamily(bodyFont) }}
            >
              Six mandates cleared the bar out of {baseCounts.total} scraped this week. Decide on one and the next in line takes its slot.
            </p>
          </div>

          {/* Stats Box */}
          <div
            className="flex items-baseline gap-6 sm:gap-10 border-t border-border pt-4 lg:border-t-0 lg:pt-0"
            style={{ fontFamily: getFamily(monoFont) }}
          >
            <div>
              <div className="text-4xl sm:text-5xl text-foreground font-normal tabular-nums">40</div>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground font-normal">Reviewed</p>
            </div>
            <span className="text-border-strong text-xl font-light">/</span>
            <div>
              <div className="text-4xl sm:text-5xl text-foreground font-normal tabular-nums">74</div>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground font-normal">To act on</p>
            </div>
            <span className="text-border-strong text-xl font-light">/</span>
            <div>
              <div className="text-4xl sm:text-5xl text-foreground font-normal tabular-nums">9</div>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground font-normal">Read this week</p>
            </div>
          </div>
        </section>

        {/* Shortlist Queue Sub-header */}
        <div
          className="mt-8 flex items-baseline justify-between border-b border-border pb-3"
          style={{ fontFamily: getFamily(monoFont) }}
        >
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Shortlist Queue · Sorted by fit
          </span>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {remaining.length} awaiting review
          </span>
        </div>

        {/* Opportunity List */}
        <ol className="divide-y divide-border border-b border-border">
          {visible.map((o: Opportunity, index: number) => {
            const isOpen = open === o.jobHash;
            const itemNumber = String(index + 1).padStart(2, "0");

            return (
              <li key={o.jobHash} className="py-2 transition-colors hover:bg-surface-raised/40">
                <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span
                        className="text-xs tabular-nums text-muted-foreground font-normal"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        {itemNumber}
                      </span>
                      
                      {/* Role Title */}
                      <Link
                        to="/opportunity/$jobHash"
                        params={{ jobHash: o.jobHash }}
                        className="text-2xl sm:text-3xl text-foreground hover:underline decoration-1 underline-offset-4"
                        style={{ fontFamily: getFamily(roleTitleFont) }}
                      >
                        {o.role}
                      </Link>

                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] uppercase font-semibold text-white bg-signal"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        Pursue
                      </span>

                      <span
                        className="text-xs uppercase tracking-wider text-muted-foreground"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        Growth Marketing
                      </span>
                    </div>

                    <p
                      className="mt-1 text-xs uppercase tracking-wider text-muted-foreground"
                      style={{ fontFamily: getFamily(monoFont) }}
                    >
                      {o.company} · {o.location} · {o.scrapedFrom}
                    </p>

                    <p
                      className="mt-1 text-sm italic text-muted-foreground font-normal"
                      style={{ fontFamily: getFamily(bodyFont) }}
                    >
                      {o.role} mandate at {o.company} focused on Commercial Growth & Scale.
                    </p>
                  </div>

                  <div className="flex shrink-0 items-baseline gap-4 sm:flex-col sm:items-end sm:gap-1">
                    <div
                      className="text-3xl sm:text-4xl text-foreground font-normal tabular-nums"
                      style={{ fontFamily: getFamily(roleTitleFont) }}
                    >
                      94<span className="text-xs text-muted-foreground font-normal">/100</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : o.jobHash)}
                      className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer"
                      style={{ fontFamily: getFamily(monoFont) }}
                    >
                      {isOpen ? "− Close" : "+ Brief"}
                    </button>
                  </div>
                </div>

                {/* Inline Brief Accordion Card */}
                {isOpen && (
                  <div
                    className="mb-6 mt-2 rounded-lg border border-border bg-card p-6 shadow-sm"
                    style={{
                      fontFamily: getFamily(bodyFont)
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                      <span
                        className="text-xs uppercase tracking-widest text-muted-foreground"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        Executive Brief
                      </span>
                      <span
                        className="text-sm font-semibold text-foreground"
                        style={{ fontFamily: getFamily(briefHeadlineFont) }}
                      >
                        Worth pursuing.
                      </span>
                    </div>

                    <h3
                      className="text-2xl sm:text-3xl text-foreground leading-snug mb-4"
                      style={{ fontFamily: getFamily(briefHeadlineFont) }}
                    >
                      A non-executive board directorship at {o.company} focused on fiduciary oversight, capital allocation, and risk management.
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4 text-sm">
                      <div className="p-3 bg-surface-raised rounded border border-border">
                        <span
                          className="block text-xs uppercase tracking-wider text-signal font-semibold mb-1"
                          style={{ fontFamily: getFamily(monoFont) }}
                        >
                          Proceed If
                        </span>
                        <p>Board oversight and strategic capital allocation advisory align with your career stage.</p>
                      </div>
                      <div className="p-3 bg-surface-raised rounded border border-border">
                        <span
                          className="block text-xs uppercase tracking-wider text-caution font-semibold mb-1"
                          style={{ fontFamily: getFamily(monoFont) }}
                        >
                          Pause If
                        </span>
                        <p>Confirm D&O insurance coverage terms and committee cadence expectations.</p>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-border">
                      <button
                        onClick={() => decide(o.jobHash, "PURSUE")}
                        className="px-4 py-2 bg-signal text-white rounded text-xs uppercase font-semibold cursor-pointer"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        Pursue
                      </button>
                      <button
                        onClick={() => decide(o.jobHash, "CONSIDER")}
                        className="px-4 py-2 bg-caution text-white rounded text-xs uppercase font-semibold cursor-pointer"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        Consider
                      </button>
                      <button
                        onClick={() => decide(o.jobHash, "PASS")}
                        className="px-4 py-2 bg-foreground text-background rounded text-xs uppercase font-semibold cursor-pointer"
                        style={{ fontFamily: getFamily(monoFont) }}
                      >
                        Pass
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}
