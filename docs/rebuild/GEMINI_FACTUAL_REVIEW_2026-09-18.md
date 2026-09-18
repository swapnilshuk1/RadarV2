# Gemini factual reviewer — local validation

The owner-selected `gemini-3.8-flash` returned HTTP 200 through Vertex's global endpoint using existing local ADC credentials. No credentials were committed or copied to production.

The independent reviewer checks dossier prose against frozen evidence. Bedrock remains the staged evaluator and composer. Review findings enter the existing bounded section repair loop; the reviewer cannot change the canonical decision, screening or career-capital adjudication. Each sentence must receive exactly one identified review. Missing/duplicate reviews fail validation. Provider failures pause work instead of consuming semantic repair attempts.

The transport explicitly uses `responseJsonSchema`, while canonical validation remains in Zod. Existing Gemini callers retain their regional endpoint and OpenAPI schema defaults. New presentations use `dossier-v3.6` and record the reviewer model and `editorial-facts-v1` policy. Historical presentation rows remain untouched.

## Retained real examples

With the same supplied evidence and instructions used for earlier model comparisons:

| Check | Gemini result |
| --- | --- |
| Managing a 40-member team inflated into 40 direct reports | Detected |
| Market-pay benchmark asserted without market evidence | Detected |
| Missing proof turned into a candidate's absolute lack of background | Detected |
| Legitimate grounded inference control | Accepted |

All four responses covered every supplied sentence using HIGH thinking. Subsequent Bedrock repairs passed the Gemini reviewer: pay and candidate absence after one attempt, team scope after two. These are bounded regression results, not proof of population-wide accuracy.

Private, retained inputs/results are under `.radar/gemini-reviewer-1789742709111/`. The first full local dossier attempt stopped on a provider failure after one section succeeded. A single-section retry succeeded. The resumed full-evidence review detected inappropriate attribution of studio funding to the hiring platform, but another section exhausted the 16,384-token budget under HIGH thinking.

The candidate configuration therefore uses MEDIUM thinking with the same strict contract and a 16,384-token output budget. Its repeat calibration was blocked before semantic output: all four calls returned HTTP 403, denying `aiplatform.endpoints.predict` for the exact model in the configured project. Evidence is retained separately under `.radar/gemini-reviewer-medium-1789745426688/`. Earlier successful access must not be represented as current access. MEDIUM has **not** passed real calibration; full-dossier persistence and rendered verification remain incomplete. Truncated/malformed provider output now pauses work instead of triggering expensive prose regeneration.

## Validation and release boundary

- Final focused model/composition/serving checks: 3 files, 59 tests passed, including independent-reviewer routing, persisted provenance and safe handling of truncated reviewer output.
- Application TypeScript check passed.
- Production build passed; the local build took approximately 20 minutes.
- Full certification and exact-commit CI are separate from the still-blocked real semantic validation.
- No Oracle changes, production backfill, merge to main, or serving activation occurred.

Production requires its own verified ADC configuration and model access. Local ADC success does not establish production access. The full local dossier and release-readiness evidence remain prerequisites to rollout.
