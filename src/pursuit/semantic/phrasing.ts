/**
 * Context-aware phrase banks. Banks are organised by semantic function, not by
 * synonym: the evidence relationship decides WHAT may be said; the bank only
 * varies HOW it is said. Selection is seeded by (pursuit, artifact, slot) so a
 * pursuit reads the same on reload while different pursuits and slots vary. No
 * phrase repeats inside one package.
 */

import type { EvidenceRelationship } from "./types";
import { fingerprint } from "./engine";

export type CareerMove = "SAME_DOMAIN" | "LATERAL";

const BANKS = {
  proofLead: {
    DIRECT: [
      "A direct precedent:",
      "I have handled this same challenge before:",
      "The closest direct example from my work:",
      "This is work I have already owned:",
    ],
    ANALOGOUS: [
      "A closely related precedent:",
      "The operating parallel I would draw:",
      "While the context differs, the closest comparable experience is",
      "The nearest equivalent in my record:",
      "A comparable responsibility I carried:",
      "In a different setting, the same problem:",
      "The parallel from my own record:",
      "Closest in substance, if not in sector:",
    ],
    ADJACENT: [
      "Relevant adjacent experience includes",
      "A supporting capability I would bring:",
      "Related experience that carries over:",
      "Supporting context from my record:",
      "Also relevant:",
      "A related strength:",
    ],
    UNSUPPORTED: ["Relevant background:"],
  },
  execOpener: {
    SAME_DOMAIN: [
      "The {role} brief reads as a mandate I recognise from the inside.",
      "{company}'s {role} search caught my attention because it describes work I have been doing.",
      "I am writing about the {role} role at {company}; the mandate is close to what I run today.",
    ],
    LATERAL: [
      "The {role} role at {company} is a deliberate move for me, and I want to be precise about why it fits.",
      "I am approaching the {role} mandate from an adjacent field, and I think the transfer is stronger than it first looks.",
      "{company}'s {role} search is outside my current domain, but the underlying economics are ones I have run.",
    ],
  },
  execClose: [
    "If that reading is right, twenty minutes would tell us both whether it is worth going further.",
    "Happy to compare notes on the mandate whenever suits you.",
    "If useful, I can walk through how I would approach the first ninety days.",
  ],
  warmAsk: [
    "Would you be comfortable introducing me to whoever owns this hire?",
    "If you know the person leading this search, would you be open to making an introduction?",
    "Could you point me to the right person at {company}, or forward the note below?",
  ],
  followUpHook: [
    "One thing I did not mention last time.",
    "A point that may help as you shortlist.",
    "Adding one piece of context since my last note.",
  ],
  firstPersonGap: [
    "To be clear on fit: I have not run {domain} myself. What transfers is {kinds}, and I am explicit about the learning curve.",
    "Where I am not direct: {domain}. Where I am: {kinds}, which I think is the harder part to find.",
    "I would not claim {domain} experience. The case is {kinds}, applied to a new model I am committed to learning.",
  ],
  finalClose: [
    "Closing the loop on the {role} role. If it has moved on, no reply needed; if it is still open, I remain interested.",
    "Last note from me on {role}. Glad to reconnect if the timing changes.",
    "A brief final follow-up on {role}: still interested, and easy to reach if it reopens.",
  ],
  counterDirectGap: [
    "Do not imply {domain} experience you do not have. Lead instead with {evidence}, which carry the same {kinds} economics, then state plainly why you want to learn the {domain} model.",
    "Name the {domain} gap yourself, early. Then show that {evidence} prove the harder part of the job, {kinds}, and explain how you would close the domain learning curve.",
    "Treat {domain} as the honest gap. Anchor the answer on {evidence} as the transferable core, {kinds}, and be specific about what you would need to learn in the first months.",
  ],
  counterAnalogous: [
    "Frame {evidence} as the same {kinds} problem solved in a different setting, and invite them to test the parallels.",
    "Acknowledge the context shift, then walk through {evidence} as a working parallel for {kinds}.",
  ],
  counterRequirement: [
    "Answer with {evidence} and be clear about where the experience is direct and where it is related.",
    "Point to {evidence} as the relevant proof, without stretching it beyond what it shows.",
  ],
  counterNoEvidence: [
    "Acknowledge this directly and describe how you would build it quickly; do not claim it.",
    "Treat this as a learning agenda item, stated openly, rather than something to defend.",
  ],
  summaryOpen: {
    SAME_DOMAIN: [
      "{label}.",
      "{label}, with the record to show it.",
    ],
    LATERAL: [
      "{label}.",
      "Senior leader bringing {kinds} to a new domain.",
    ],
  },
} as const;

export type BankName = keyof typeof BANKS;

export class Phraser {
  private used = new Set<string>();
  constructor(private readonly seed: string) {}

  private choose(options: readonly string[], slot: string): string {
    if (options.length === 0) return "";
    const start = parseInt(fingerprint(`${this.seed}|${slot}`).slice(0, 8), 16) % options.length;
    for (let i = 0; i < options.length; i++) {
      const candidate = options[(start + i) % options.length]!;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
    return options[start]!;
  }

  proofLead(relationship: EvidenceRelationship, slot: string): string {
    return this.choose(BANKS.proofLead[relationship], `proofLead:${slot}`);
  }

  pick(
    bank: Exclude<BankName, "proofLead" | "execOpener" | "summaryOpen">,
    slot: string,
    vars: Record<string, string> = {},
  ): string {
    return fill(this.choose(BANKS[bank], `${bank}:${slot}`), vars);
  }

  pickByMove(
    bank: "execOpener" | "summaryOpen",
    move: CareerMove,
    slot: string,
    vars: Record<string, string> = {},
  ): string {
    return fill(this.choose(BANKS[bank][move], `${bank}:${slot}`), vars);
  }
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

/** Phrases only DIRECT evidence may license. */
export const DIRECT_ONLY_PHRASES = [
  /\ba direct precedent\b/i,
  /\bthe closest direct example\b/i,
  /\bthis is work i have already owned\b/i,
  /\bi have handled this same challenge before\b/i,
  /\bi have done this before\b/i,
  /\bi have already done (this|exactly)\b/i,
  /\bexactly what i (have done|did)\b/i,
  /\bi have (built|run) (a|an|the) (same|identical)\b/i,
];
