/**
 * Skin gallery — the full visual showroom for RADAR's interface skins,
 * rendered on sample content only: no data calls, database or model use.
 * Selecting here writes the same persisted preference as the header control.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  SKINS,
  applyAppearance,
  applySkin,
  readAppearance,
  readSkin,
  type Appearance,
  type SkinId,
} from "@/components/skins/skin";

export const Route = createFileRoute("/skins")({
  head: () => ({
    meta: [
      { title: "Interface skins — RADAR" },
      {
        name: "description",
        content: "Choose how RADAR looks: five interface skins across every page type, in light or dark.",
      },
      { property: "og:title", content: "Interface skins — RADAR" },
      { property: "og:description", content: "RADAR, Boardroom, Signal, Atelier and iPhone — five interface skins for the advisory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SkinsPage,
});

// ---------------------------------------------------------------- sample data
type Verdict = "PURSUE" | "CONSIDER" | "PASS";
const OPPS: Array<{ rank: number; verdict: Verdict; company: string; role: string; thesis: string; fit: number; evid: string; stage: string }> = [
  { rank: 1, verdict: "PURSUE", company: "WPP", role: "Global Client Services Lead", thesis: "A book-owner's mandate: the role pays for the client P&L he already carried at VML.", fit: 4, evid: "14/19", stage: "Interviewing" },
  { rank: 2, verdict: "CONSIDER", company: "GlobalLogic", role: "VP, Data & AI Practice", thesis: "Strong practice-building proof; the AI delivery depth is inferred, not shown.", fit: 3, evid: "9/17", stage: "Ready" },
  { rank: 3, verdict: "CONSIDER", company: "Antal International", role: "Managing Partner", thesis: "Commercial ownership transfers; search-practice craft is the open question.", fit: 3, evid: "8/16", stage: "Preparing" },
  { rank: 4, verdict: "PASS", company: "Jobgether", role: "Head of Marketing Ops", thesis: "Scope sits two levels below the current career capital.", fit: 1, evid: "4/15", stage: "—" },
];
const REASONS = [
  "$8M agency fee book owned end-to-end at VML",
  "40-member delivery operation built from zero",
  "13 APAC and Middle East markets operated",
];
const EVIDENCE: Array<{ req: string; rel: "DIRECT" | "ADJACENT" | "UNSUPPORTED"; kind: "EXPLICIT" | "INFERRED" }> = [
  { req: "Own a client P&L", rel: "DIRECT", kind: "EXPLICIT" },
  { req: "Lead a multi-market team", rel: "DIRECT", kind: "EXPLICIT" },
  { req: "Retain and grow top-10 accounts", rel: "ADJACENT", kind: "INFERRED" },
  { req: "Holding-company governance", rel: "UNSUPPORTED", kind: "INFERRED" },
];

// ---------------------------------------------------------------- primitives
function VerdictMark({ v, skin, big }: { v: Verdict; skin: SkinId; big?: boolean }) {
  const size = big ? "text-sm px-4 py-2" : "text-[0.65rem] px-2 py-1";
  if (skin === "boardroom") {
    if (v === "PURSUE") return <span className={`label-mono ${size} bg-decision-pursue text-decision-pursue-fg`}>Pursue</span>;
    if (v === "CONSIDER") return <span className={`label-mono ${size} border border-decision-consider text-decision-consider`}>Consider</span>;
    return <span className={`label-mono ${size} text-decision-pass line-through`}>Pass</span>;
  }
  if (skin === "signal") {
    const color = v === "PURSUE" ? "text-decision-pursue border-decision-pursue" : v === "CONSIDER" ? "text-decision-consider border-decision-consider" : "text-decision-pass border-decision-pass";
    return <span className={`font-mono tabular ${big ? "text-base" : "text-xs"} border-l-4 pl-2 ${color}`}>[{v}]</span>;
  }
  if (skin === "atelier") {
    if (v === "PURSUE")
      return (
        <span className={`inline-flex items-center justify-center rounded-full bg-decision-pursue text-decision-pursue-fg font-serif italic ${big ? "h-20 w-20 text-xl" : "h-12 w-12 text-sm"}`}>
          Pursue
        </span>
      );
    if (v === "CONSIDER") return <span className={`rounded-full border border-skin-accent px-3 py-1 font-serif italic text-decision-consider ${big ? "text-lg" : "text-sm"}`}>Consider</span>;
    return <span className={`font-serif italic text-decision-pass ${big ? "text-lg" : "text-sm"}`}>Pass</span>;
  }
  const cls = v === "PURSUE" ? "badge-pursue" : v === "CONSIDER" ? "badge-consider" : "badge-pass";
  return <span className={`${cls} label-mono ${size} rounded`}>{v}</span>;
}

function Btn({ skin, primary, children, kbd }: { skin: SkinId; primary?: boolean; children: ReactNode; kbd?: string }) {
  const shape =
    skin === "atelier" ? "rounded-full px-6 py-3" : skin === "radar" ? "rounded-md px-4 py-2" : "rounded-[2px] px-4 py-2";
  if (skin === "boardroom" && !primary) return <button type="button" className="text-sm underline underline-offset-4 text-foreground">{children}</button>;
  const look = primary
    ? skin === "atelier" || skin === "radar" || skin === "boardroom"
      ? "bg-primary text-primary-foreground"
      : "bg-skin-accent text-skin-accent-fg"
    : skin === "atelier"
      ? "border border-skin-accent text-foreground"
      : "border border-border text-foreground";
  return (
    <button type="button" className={`${shape} ${look} text-sm font-medium inline-flex items-center gap-2`}>
      {children}
      {kbd && <kbd className="font-mono text-[0.65rem] opacity-70 border border-current px-1 rounded-[2px]">{kbd}</kbd>}
    </button>
  );
}

function Kicker({ skin, children }: { skin: SkinId; children: ReactNode }) {
  if (skin === "atelier") return <p className="font-serif italic text-skin-accent text-lg">{children}</p>;
  if (skin === "boardroom") return <p className="label-mono border-t-2 border-skin-rule pt-2 text-muted-foreground" style={{ fontVariant: "small-caps" }}>{children}</p>;
  if (skin === "signal") return <p className="font-mono text-xs text-skin-accent">// {String(children).toUpperCase()}</p>;
  return <p className="label-mono text-muted-foreground">{children}</p>;
}

function Meter({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`h-2.5 w-2 ${i < n ? "bg-skin-accent" : "bg-muted"}`} />
      ))}
    </span>
  );
}

function KindDot({ k }: { k: "EXPLICIT" | "INFERRED" }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.65rem] text-muted-foreground">
      <span className={`h-2 w-2 rounded-full border border-evidence-matched ${k === "EXPLICIT" ? "bg-evidence-matched" : ""}`} />
      {k}
    </span>
  );
}

const relColor = (r: string) => (r === "DIRECT" ? "text-evidence-matched" : r === "ADJACENT" ? "text-evidence-adjacent" : "text-evidence-missing");

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <div className="border border-border bg-background overflow-hidden rounded-[var(--radius)]">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- page types
function DecisionsSample({ skin }: { skin: SkinId }) {
  if (skin === "boardroom")
    return (
      <div className="p-6">
        <Kicker skin={skin}>I. Ranked opportunities</Kicker>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b-2 border-skin-rule">
              {["#", "Verdict", "Company", "Role", "Thesis", ""].map((h) => <th key={h} className="py-2 pr-4 font-normal label-mono">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {OPPS.map((o) => (
              <tr key={o.rank} className="border-b border-border align-top">
                <td className="py-3 pr-4 font-serif text-lg">{o.rank}</td>
                <td className="py-3 pr-4"><VerdictMark v={o.verdict} skin={skin} /></td>
                <td className="py-3 pr-4 font-serif">{o.company}</td>
                <td className="py-3 pr-4">{o.role}</td>
                <td className="py-3 pr-4 text-muted-foreground max-w-xs">{o.thesis}</td>
                <td className="py-3 text-right"><Btn skin={skin} primary={o.verdict === "PURSUE"}>{o.verdict === "PURSUE" ? "Open pursuit" : "Read memo"}</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (skin === "signal")
    return (
      <div>
        <div className="sticky top-0 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2 font-mono text-xs">
          <span className="text-skin-accent">FILTER</span>
          {["ALL 66", "PURSUE 2", "CONSIDER 15", "PASS 49"].map((f, i) => (
            <span key={f} className={`px-2 py-0.5 border ${i === 1 ? "border-skin-accent text-skin-accent" : "border-border text-muted-foreground"}`}>{f}</span>
          ))}
          <span className="ml-auto text-muted-foreground">J/K move · P/C/X decide</span>
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {OPPS.map((o) => (
            <div key={o.rank} className="bg-card p-4">
              <div className="flex items-center justify-between"><VerdictMark v={o.verdict} skin={skin} /><span className="font-mono tabular text-xs text-muted-foreground">#{o.rank}</span></div>
              <p className="mt-3 font-serif text-lg leading-tight">{o.company}</p>
              <p className="text-sm text-muted-foreground">{o.role}</p>
              <div className="mt-3 flex items-center justify-between font-mono tabular text-xs">
                <span className="flex items-center gap-2">FIT <Meter n={o.fit} /></span>
                <span>EVID {o.evid}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  if (skin === "atelier")
    return (
      <div className="space-y-6 p-8">
        <Kicker skin={skin}>This week, two deserve you.</Kicker>
        {OPPS.slice(0, 3).map((o) => (
          <article key={o.rank} className="flex items-center gap-8 rounded-[var(--radius)] border border-border bg-card p-8">
            <div className="flex-1">
              <p className="font-serif text-4xl leading-none">{o.company}</p>
              <p className="mt-1 text-sm text-muted-foreground">{o.role}</p>
              <blockquote className="mt-4 border-l-2 border-skin-accent pl-4 font-serif text-xl italic">“{o.thesis}”</blockquote>
            </div>
            <div className="flex flex-col items-center gap-4"><VerdictMark v={o.verdict} skin={skin} /><Btn skin={skin} primary={o.verdict === "PURSUE"}>Read</Btn></div>
          </article>
        ))}
      </div>
    );
  return (
    <div className="grid gap-4 p-6 sm:grid-cols-2">
      {OPPS.map((o) => (
        <div key={o.rank} className="rounded-md border border-border bg-card p-5">
          <VerdictMark v={o.verdict} skin={skin} />
          <p className="mt-3 font-serif text-xl">{o.role}</p>
          <p className="text-sm text-muted-foreground">{o.company}</p>
          <p className="mt-2 text-sm">{o.thesis}</p>
        </div>
      ))}
    </div>
  );
}

function EvidenceRows({ skin }: { skin: SkinId }) {
  return (
    <ul className="divide-y divide-border">
      {EVIDENCE.map((e) => (
        <li key={e.req} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span>{e.req}</span>
          <span className="flex items-center gap-4">
            <KindDot k={e.kind} />
            <span className={`font-mono text-xs ${relColor(e.rel)} ${skin === "signal" ? "tabular" : ""}`}>{e.rel}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function DossierSample({ skin }: { skin: SkinId }) {
  const o = OPPS[0];
  const decide = (
    <div className={`flex ${skin === "boardroom" ? "flex-col items-stretch" : "flex-wrap items-center"} gap-3`}>
      <Btn skin={skin} primary kbd={skin === "signal" ? "P" : undefined}>Pursue</Btn>
      <Btn skin={skin} kbd={skin === "signal" ? "C" : undefined}>Consider</Btn>
      <Btn skin={skin} kbd={skin === "signal" ? "X" : undefined}>Pass</Btn>
    </div>
  );
  if (skin === "boardroom")
    return (
      <div className="grid md:grid-cols-[260px_1fr]">
        <aside className="border-r border-border bg-card p-6 space-y-6">
          <div><VerdictMark v={o.verdict} skin={skin} big /></div>
          <ol className="space-y-3 text-sm">
            {REASONS.map((r, i) => <li key={r} className="flex gap-3"><span className="font-serif text-skin-accent">{["i", "ii", "iii"][i]}.</span>{r}</li>)}
          </ol>
          {decide}
        </aside>
        <div className="p-8">
          <Kicker skin={skin}>II. Executive thesis</Kicker>
          <h2 className="mt-3 text-3xl leading-tight">{o.company} is buying a client book-owner, and that is what he has been.</h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">The mandate is retention and growth of a top-tier client portfolio across markets. The record shows direct P&L ownership, multi-market leadership and a built delivery engine.</p>
          <div className="mt-6"><Kicker skin={skin}>III. Evidence</Kicker><EvidenceRows skin={skin} /></div>
        </div>
      </div>
    );
  if (skin === "signal")
    return (
      <div className="relative pb-16">
        <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-5">
          {[
            ["VERDICT", <VerdictMark key="v" v={o.verdict} skin={skin} big />],
            ["FIT", <Meter key="m" n={o.fit} />],
            ["EVIDENCE", <span key="e" className="font-mono tabular text-xl">{o.evid}</span>],
            ["OPEN Qs", <span key="q" className="font-mono tabular text-xl">3</span>],
            ["STAGE", <span key="s" className="font-mono text-sm">{o.stage.toUpperCase()}</span>],
          ].map(([k, v]) => (
            <div key={String(k)} className="bg-card p-4"><p className="font-mono text-[0.65rem] text-muted-foreground">{k}</p><div className="mt-2">{v}</div></div>
          ))}
        </div>
        {["Thesis", "Evidence map", "Risks & hinges"].map((s, i) => (
          <details key={s} open={i < 2} className="border-b border-border px-5 py-3">
            <summary className="cursor-pointer font-mono text-xs text-skin-accent">{s.toUpperCase()}</summary>
            <div className="mt-3 text-sm">{i === 0 ? "Buying a client book-owner; the record shows direct P&L ownership across 13 markets." : i === 1 ? <EvidenceRows skin={skin} /> : "Holding-company governance is unproven."}</div>
          </details>
        ))}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-skin-accent bg-card px-5 py-3">
          <span className="font-mono text-xs text-muted-foreground">DECIDE</span>{decide}
        </div>
      </div>
    );
  if (skin === "atelier")
    return (
      <div className="relative mx-auto max-w-3xl p-10">
        <div className="absolute right-6 top-6"><VerdictMark v={o.verdict} skin={skin} /></div>
        <Kicker skin={skin}>A note on {o.company}</Kicker>
        <blockquote className="mt-4 font-serif text-4xl leading-tight">“The role pays for the client P&L he already carried.”</blockquote>
        <p className="mt-6 text-lg text-muted-foreground leading-relaxed">The mandate is the retention and growth of a top-tier portfolio. His record speaks to it directly, with one honest gap in holding-company governance.</p>
        <div className="mt-8"><EvidenceRows skin={skin} /></div>
        <div className="mt-10 rounded-[var(--radius)] border border-skin-accent bg-card p-8 text-center">
          <p className="font-serif text-2xl italic">Your decision</p>
          <div className="mt-4 flex justify-center">{decide}</div>
        </div>
      </div>
    );
  return (
    <div className="p-8">
      <VerdictMark v={o.verdict} skin={skin} />
      <h2 className="mt-3 text-3xl">{o.role} · {o.company}</h2>
      <p className="mt-3 text-muted-foreground">{o.thesis}</p>
      <div className="mt-5"><EvidenceRows skin={skin} /></div>
      <div className="mt-6">{decide}</div>
    </div>
  );
}

function CockpitSample({ skin }: { skin: SkinId }) {
  const tabs = ["Strategy", "Resume", "Outreach", "Interview"];
  const next = "Send the executive note to the WPP talent partner";
  if (skin === "boardroom")
    return (
      <div className="grid md:grid-cols-[200px_1fr]">
        <nav className="border-r border-border p-6">
          <Kicker skin={skin}>Contents</Kicker>
          <ol className="mt-3 space-y-2 text-sm">
            {tabs.map((t, i) => <li key={t} className={i === 0 ? "font-semibold border-l-2 border-skin-accent pl-2" : "pl-2.5 text-muted-foreground"}>{["I", "II", "III", "IV"][i]}. {t}</li>)}
          </ol>
        </nav>
        <div className="p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-skin-rule pb-3">
            <p className="font-serif text-2xl">Pursuit memorandum — WPP</p>
            <p className="label-mono text-muted-foreground">Stage: Interviewing · Package 3/4</p>
          </div>
          <p className="mt-4 text-sm"><span className="label-mono text-skin-accent">Next action</span> — {next}</p>
          <p className="mt-6 font-serif text-lg">Win theme</p>
          <p className="text-muted-foreground">Commercial ownership of a multi-market client book, proven at VML.</p>
        </div>
      </div>
    );
  if (skin === "signal")
    return (
      <div className="grid md:grid-cols-[1fr_280px]">
        <div className="p-5">
          <div className="flex gap-1 font-mono text-xs">{tabs.map((t, i) => <span key={t} className={`px-3 py-1 border ${i === 0 ? "border-skin-accent text-skin-accent" : "border-border text-muted-foreground"}`}>{t.toUpperCase()}</span>)}</div>
          <div className="mt-4 min-h-40 border border-border bg-card p-4 text-sm">Win theme: commercial ownership of a multi-market client book… <span className="animate-pulse text-skin-accent">▍</span></div>
        </div>
        <aside className="border-l border-border bg-card p-5 font-mono text-xs space-y-3">
          <p className="text-skin-accent">READINESS 3/4</p>
          {["Strategy", "Resume", "Exec note", "Interview stories"].map((c, i) => <p key={c} className="flex justify-between"><span>{c}</span><span className={i < 3 ? "text-evidence-matched" : "text-evidence-missing"}>{i < 3 ? "OK" : "--"}</span></p>)}
          <p className="pt-2 text-muted-foreground">TOKENS 9,204 / 20,000</p>
          <div className="h-1 bg-muted"><div className="h-1 w-[46%] bg-skin-accent" /></div>
        </aside>
      </div>
    );
  if (skin === "atelier")
    return (
      <div className="mx-auto max-w-4xl p-10">
        <div className="rounded-[var(--radius)] bg-primary p-8 text-primary-foreground">
          <p className="font-serif italic text-lg opacity-80">Your next move</p>
          <p className="mt-2 font-serif text-3xl leading-tight">{next}</p>
          <div className="mt-5"><span className="rounded-full bg-skin-accent px-5 py-2 text-sm text-skin-accent-fg">Open the note</span></div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">{tabs.map((t, i) => <span key={t} className={`rounded-full px-5 py-2 text-sm ${i === 0 ? "bg-card border border-skin-accent" : "text-muted-foreground"}`}>{t}</span>)}</div>
        <p className="mt-6 font-serif text-2xl">Commercial ownership of a multi-market client book, proven at VML.</p>
      </div>
    );
  return (
    <div className="p-6">
      <p className="label-mono text-muted-foreground">Pursuit cockpit</p>
      <p className="font-display text-xl">Global Client Services Lead · WPP</p>
      <p className="label-mono mt-1 text-muted-foreground">Pursuit stage: Interviewing · Package readiness 3/4</p>
      <div className="mt-3 flex gap-1">{tabs.map((t, i) => <span key={t} className={`pursuit-tab ${i === 0 ? "pursuit-tab-active" : ""}`}>{t}</span>)}</div>
    </div>
  );
}

function ProfileSample({ skin }: { skin: SkinId }) {
  const field = skin === "atelier" ? "rounded-full px-5 py-3" : skin === "radar" ? "rounded-md px-3 py-2" : "rounded-[2px] px-3 py-2";
  return (
    <div className="grid gap-6 p-6 md:grid-cols-2">
      <div>
        <Kicker skin={skin}>What's missing</Kicker>
        <p className="mt-3 text-sm"><span className="font-semibold text-evidence-adjacent">2 CV versions</span> not yet processed — recommendations still use the previous evidence.</p>
        <div className="mt-4"><Btn skin={skin} primary>Refresh recommendations</Btn></div>
      </div>
      <div className="space-y-3">
        <label className="block text-sm">Archetype name<input readOnly value="Commercial P&L owner" className={`mt-1 w-full border border-input bg-card ${field}`} /></label>
        <div className={`border border-dashed border-border-strong bg-card p-6 text-center text-sm text-muted-foreground ${skin === "atelier" ? "rounded-[var(--radius)]" : ""}`}>Drop CV versions here</div>
        <Btn skin={skin}>Save archetype</Btn>
      </div>
    </div>
  );
}

function LoginSample({ skin }: { skin: SkinId }) {
  return (
    <div className="flex min-h-72 items-center justify-center p-10">
      <div className={`w-full max-w-sm text-center ${skin === "signal" ? "border border-skin-accent p-8" : ""}`}>
        <p className={skin === "signal" ? "font-mono text-xs text-skin-accent" : "label-mono text-muted-foreground"}>{skin === "signal" ? "RADAR // SECURE ACCESS" : "Private advisory"}</p>
        <h2 className={`mt-3 ${skin === "atelier" ? "text-5xl" : "text-3xl"}`}>RADAR</h2>
        <p className="mt-2 text-sm text-muted-foreground">Where your limited career headspace should go.</p>
        <div className="mt-6 flex justify-center"><Btn skin={skin} primary>Sign in with Google</Btn></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
function SkinsPage() {
  const [skin, setSkin] = useState<SkinId>("radar");
  const [appearance, setAppearance] = useState<Appearance>("system");

  // The gallery is a live try-on: it drives the same persisted state the
  // header control writes, so what you see here is what every page renders.
  useEffect(() => {
    setSkin(readSkin());
    setAppearance(readAppearance());
  }, []);

  const pickSkin = (id: SkinId) => {
    applySkin(id);
    setSkin(id);
  };
  const pickAppearance = (id: Appearance) => {
    applyAppearance(id);
    setAppearance(id);
  };

  const meta = SKINS.find((entry) => entry.id === skin) ?? SKINS[0];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <div className="mr-auto">
            <p className="label-mono text-muted-foreground">Interface skins</p>
            <p className="font-serif text-xl">{meta.name} — {meta.stance}</p>
          </div>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Skin">
            {SKINS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={skin === entry.id}
                onClick={() => pickSkin(entry.id)}
                data-testid={`gallery-skin-${entry.id}`}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  skin === entry.id ? "border-foreground bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border border-border" role="group" aria-label="Appearance">
            {(["light", "dark", "system"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={appearance === option}
                onClick={() => pickAppearance(option)}
                data-testid={`gallery-appearance-${option}`}
                className={`px-3 py-1.5 text-sm capitalize ${appearance === option ? "bg-muted font-semibold" : ""}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <p className="mx-auto max-w-6xl px-6 pb-2 text-xs text-muted-foreground">
          Your choice is saved and applies to every page. Appearance stays independent of the skin.
        </p>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <Frame label="Triage list — opportunities"><DecisionsSample skin={skin} /></Frame>
        <Frame label="Memo — opportunity dossier"><DossierSample skin={skin} /></Frame>
        <Frame label="Workspace — pursuit cockpit"><CockpitSample skin={skin} /></Frame>
        <Frame label="Form — profile and CVs"><ProfileSample skin={skin} /></Frame>
        <Frame label="Entry — sign in"><LoginSample skin={skin} /></Frame>
      </div>
    </main>
  );
}
