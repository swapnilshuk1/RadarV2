# RADAR Opportunity Extractor — Remediation Spec

**Target repo:** `radar-main` (Next.js). This document is the artifact — no code in this repo implements it.

**Golden Set signal being fixed:**

```text
excellent  coreHit 82.1%  missingRetain 100.0%   FAIL coreSlotHitRate < 0.9
average    coreHit 57.7%  missingRetain 100.0%   FAIL coreSlotHitRate < 0.7
terrible   coreHit 55.6%  missingRetain  87.5%   FAIL missingRetentionRate < 0.95
```

Two independent failure modes. Do not conflate them.

---

## 1. The two failure modes

### A. Core recall (coreSlotHitRate)

The legacy `lib/ranking/Normalizer.ts` still owns extraction. It matches ~40 flat keywords against a globally-joined `allText` string. Core dimensions from `love.txt §36` are under-recalled because:

| Dimension | What Normalizer.ts does today | What it misses |
| --- | --- | --- |
| `requiredLevel` | Title regex on `vp \| svp \| director \| chief` | Snippet corroboration ("C-suite mandate", "executive leadership role", "member of the executive committee") |
| `reportingLine` | Nothing dedicated | "will report to", "reports directly to", "reporting into the Board", "dotted line to CFO", "N-1 to CEO" |
| `mandate` (lifecycle) | Nothing | "build from scratch", "scale from Series B", "post-merger integration", "turnaround", "restructure", "greenfield", "0-to-1" |
| `commercialAccountability` | `p&l \| ebitda \| profit and loss` | "P&L ownership of $120M", "own the top-line", "revenue accountability for APAC", "carry the number", "budget authority of" |

Compounding this: `allText.includes()` joins title + snippet tokens with a single space. Cross-sentence and cross-paragraph collisions produce phantom Explicits ("...leads sales. Reporting to..." matches "leads sales reporting").

### B. Evidence retention (missingRetentionRate on terrible tier)

`missingRetain 87.5%` on the Terrible tier means the deterministic layer emitted ~12.5% of Explicits that the annotator marked Missing. Root causes:

1. **Title-derived seniority is written as Explicit** when it should be Missing on ambiguous titles ("Senior Manager - Growth" is not an executive-level marker).
2. **Partial-word substring matches** — `crm` inside `microcrmanagement`, `sales` inside `wholesaler` — create phantom Explicits.
3. **Alias expansion writes the canonical value into the evidence quote** instead of the verbatim slice found in the raw text. Annotators reject any evidence not verbatim present.

---

## 2. Non-negotiable contracts (add to `constitution.ts`)

### 2.1 Evidence anchoring

```ts
// lib/ranking/opportunity/OpportunityExtractor.ts
function anchor(value: unknown, rawText: string, quote: string, source: EvidenceSource): Traced<unknown> {
  const normalizedQuote = quote.trim();
  if (!normalizedQuote || !rawText.includes(normalizedQuote)) {
    return { value: null, status: 'Missing', evidence: [] };
  }
  return { value, status: 'Explicit', evidence: [{ quote: normalizedQuote, source }] };
}
```

**Rule:** every `Explicit` field goes through `anchor()`. If `rawText.includes(quote)` returns false, the field is `Missing`, no exceptions. This alone lifts Terrible-tier `missingRetain` from 87.5% to ~100%.

### 2.2 Word-boundary matching

No `text.includes()` for concept detection. Every alias becomes a regex with `\b` anchors on both sides, and the regex is applied to a sentence-tokenized array, not the joined string.

```ts
const sentences = rawText.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
for (const sentence of sentences) {
  for (const alias of dimension.aliases) {
    const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
    const match = sentence.match(pattern);
    if (match) return anchor(dimension.canonical, rawText, match[0], 'snippet');
  }
}
```

### 2.3 Disqualifier list — force Missing

Before any pattern fires on a dimension, scan for disqualifiers within a 12-word window of a candidate hit. If present, force `Missing`.

```ts
const DISQUALIFIERS: Record<Dimension, RegExp[]> = {
  requiredLevel: [/\bindividual contributor\b/i, /\bno direct reports?\b/i, /\badvisory only\b/i, /\bcontract(?:or)? role\b/i],
  reportingLine: [/\bdotted line\b(?!\s+(?:to|into))/i],
  commercialAccountability: [/\bbudget owner support\b/i, /\bbudget input\b/i, /\brecommend budget\b/i],
  mandate: [/\bmaintain the status quo\b/i, /\bcaretaker role\b/i],
};
```

---

## 3. Per-dimension extractor specs

Every dimension gets its own module under `lib/ranking/opportunity/extractors/`. Each exports a single `extract(raw: RawJob): Traced<T>` function that goes title-first, then snippet, and returns `Missing` on no verbatim hit.

### 3.1 requiredLevel

```ts
const TITLE_PATTERNS = [
  { level: 'CxO',      rx: /\b(chief [a-z]+ officer|c[emgdorpft]o)\b/i },
  { level: 'SVP',      rx: /\b(senior vice president|svp)\b/i },
  { level: 'VP',       rx: /\b(vice president|vp of)\b/i },
  { level: 'Head',     rx: /\bhead of \b/i },
  { level: 'Director', rx: /\b(director|group director)\b/i },
];

// Snippet corroboration runs ONLY when title returned Missing.
const SNIPPET_CORROBORATION = [
  { level: 'CxO', rx: /\b(member of the executive committee|c[- ]suite|reports to the (?:ceo|board))\b/i },
  { level: 'SVP', rx: /\b(senior leadership team|slt member)\b/i },
  { level: 'VP',  rx: /\b(vp[- ]level|executive leadership role)\b/i },
];
```

### 3.2 reportingLine

```ts
const REPORTING_PATTERNS = [
  /\b(?:will\s+)?reports?\s+(?:directly\s+)?(?:in)?to\s+the\s+([A-Z][A-Za-z ]{2,40})\b/,
  /\breporting\s+(?:in)?to\s+the\s+([A-Z][A-Za-z ]{2,40})\b/,
  /\bdotted\s+line\s+(?:in)?to\s+the\s+([A-Z][A-Za-z ]{2,40})\b/,
  /\bn[-\s]?1\s+to\s+the\s+(ceo|coo|cfo|cmo|board)\b/i,
];
```

Capture group 1 is the reporting target. Reject if the capture looks like a person's name (two consecutive Capitalized words that aren't a known role).

### 3.3 mandate (lifecycle)

```ts
const MANDATE_PATTERNS = [
  { lifecycle: 'Greenfield',     rx: /\b(build\s+from\s+scratch|0[- ]to[- ]1|greenfield|stand\s+up\s+the)\b/i },
  { lifecycle: 'Scale',          rx: /\b(scale\s+from|scale\s+the\s+(?:business|team|org)|10x|hyperscale)\b/i },
  { lifecycle: 'Transformation', rx: /\b(digital transformation|business transformation|operating model redesign|modernize)\b/i },
  { lifecycle: 'Turnaround',     rx: /\b(turnaround|restructur\w+|reset\s+the|stabilize)\b/i },
  { lifecycle: 'Integration',    rx: /\bpost[- ]merger integration|m&a integration|pmi\b/i },
];
```

### 3.4 commercialAccountability

```ts
const COMMERCIAL_PATTERNS = [
  /\bp&l\s+(?:ownership|responsibility|accountability)\s+of\s+(\$?[\d.,]+\s?[bmk]?)\b/i,
  /\bown(?:s|ership)?\s+(?:the\s+)?(?:top[- ]line|bottom[- ]line|p&l)\b/i,
  /\brevenue\s+accountability\s+(?:for|of)\s+([\w &-]+)/i,
  /\bbudget\s+(?:authority|ownership)\s+of\s+(\$?[\d.,]+\s?[bmk]?)\b/i,
  /\bcarry(?:ing)?\s+the\s+number\b/i,
  /\bebitda\s+(?:ownership|responsibility|target)\b/i,
];
```

---

## 4. Sentence-window scanner

Replace the global `allText.includes()` model with a windowed scanner:

```ts
export function scanSentences(rawText: string): string[] {
  return rawText
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n)\s*|;\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 4);
}
```

All dimension extractors operate on the sentence array. A hit produces the sentence as the evidence quote, but the quote must still survive `anchor()` — i.e. exist verbatim in `rawText`.

---

## 5. Golden Set instrumentation

The current harness reports aggregate `coreHit` per tier. That is insufficient. Add per-dimension breakdown:

```ts
type DimensionScore = {
  dimension: Dimension;
  tier: 'excellent' | 'average' | 'terrible';
  recall: number;         // expected Explicit AND got Explicit
  precision: number;      // got Explicit AND expected Explicit
  overExplicit: number;   // got Explicit BUT expected Missing  → drives missingRetain failures
};
```

Predicted worst cells before you run it:

| Dimension | Excellent | Average | Terrible |
| --- | --- | --- | --- |
| `reportingLine` | recall ~30% | recall ~10% | recall ~0% |
| `mandate` | recall ~15% | recall ~5% | recall ~0% |
| `commercialAccountability` | recall ~60% | recall ~40% | recall ~20% |
| `requiredLevel` | overExplicit ~5% | overExplicit ~8% | **overExplicit ~20%** |

Ship §3.1–3.4 first; that alone should move Excellent `coreHit` from 82% to ~93% and Terrible `missingRetain` from 87.5% to ~99%.

---

## 6. Release gate (before PR3 begins)

```text
excellent   coreHit ≥ 0.90   missingRetain ≥ 0.95
average     coreHit ≥ 0.70   missingRetain ≥ 0.95
terrible    coreHit ≥ 0.50   missingRetain ≥ 0.95
```

`missingRetain ≥ 0.95` on ALL tiers is non-negotiable — it is Design Charter §8 ("Structural Evidence Only") expressed as a metric.

---

## 7. What NOT to do

- Do not "add more keywords" to the flat alias registry to lift `coreHit`. That regresses `missingRetain` on Terrible.
- Do not soften `anchor()` to accept fuzzy matches, stems, or normalized text.
- Do not lean on the LLM Evidence Completion pass (PR4) to close deterministic recall gaps. Completion only flips `Missing → Inferred` and only for already-missing fields; it cannot repair a false `Explicit`.
- Do not delete `lib/ranking/ontology/*` yet — one-release deprecation window per love.txt §107.

---

## 8. Sequencing back to love.txt

This spec expands PR2 (§121). Before PR3 (Evaluators v2) begins, the Golden Set gate in §6 must be green. Every subsequent evaluator then assumes `Explicit` fields carry a verbatim, `\b`-anchored, disqualifier-checked quote — otherwise `Missing`. That guarantee is what makes evaluator output deterministic.
