# Context acquisition follow-up — 18 September 2026

## Proven locally

The owner-supplied Tavily credential was loaded from the ignored local key file into the ignored local environment. No credential value was logged or committed. Production environment configuration was not changed.

The first real `ProductionContextProvider.acquire` request succeeded but returned five syndicated job advertisements: the query included the role title. The production query now asks for company financial results, leadership, funding, workforce and expansion without the role title. The focused regression verifies that role-title text is not sent in the company-context query.

A repeat request retrieved company evidence, including Ericsson's official financial-results pages. A fresh isolated SQLite copy then exercised the real production input adapter and evaluator against the exact Ericsson job, opportunity version and bound candidate profile. It acquired five context sources, extracted **102 validated context claims**, froze the complete input and persisted a **PASS / BLOCKED** staged evaluation. Earlier inputs/evaluations were retained in their original local copies.

- Job: `44d233205afaa5863da15390554a2d18dc523c6072c2b6340d47e138580f1296`.
- Local v7 context: `b1be87d811740cc55edec6a26a33f86e84f6616f30b6f80131cb74de3269da26`.
- Profile: `projection-8acff2997f98e0d6418d8b01c5244128a6b9d6aa61232a5e791afd6210fea8e4`.
- Private evidence: `.radar/context-release-1789735492838/context-canary-result.json`, acquisition responses, frozen SQLite inputs and timestamped model calls.

This proves configured context acquisition through persisted evaluation. It does not prove a production rollout, broad population convergence, or a clean new dossier. The local process was stopped after evaluation persistence; no additional queue jobs were processed.

## Factual-review experiment was not promoted

A bounded prototype reviewed prose against evidence and returned section-specific repair feedback. Retained checks used the previously observed team-reporting, market-pay and candidate-absence examples plus a legitimate-inference control. GLM identified some defects but missed others; in real composition it also rejected defensible advice and equivalent wording, increasing repairs and risking loss of dossier richness. An independent DeepSeek check did not reliably close those gaps either.

A single capability request for `us.anthropic.claude-sonnet-4-6` returned Bedrock HTTP 403. A request for usable stronger-reviewer access was sent to the owner. Model access, not another routine approval, is the missing input for that route. No claim is made that enabling a model alone will fix the problem; the same retained cases must pass before a reviewer is adopted.

The unproven reviewer and proposed dossier-v3.6 change were removed from the working production code. Their patch, model inputs/outputs, failures and partial local runs remain under the ignored evidence directory. Existing production behavior remains dossier-v3.5. The known prose defects in `PRODUCTION_READINESS_2026-09-18.md` remain unresolved; successful retrieval does not close them.

Only the tested company-query correction and its regression are shipped in this follow-up. CI at the commit establishes the final TypeScript/build/certification result. No Oracle deployment, production configuration update, backfill, merge to main or serving activation occurred.
