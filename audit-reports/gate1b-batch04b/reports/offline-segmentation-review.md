# Gate 1B Batch 04B — Offline Segmentation Review Report

- **Segmentation Protocol Version**: `source-segmentation/v1`
- **Date**: 2026-09-13T05:31:37.122Z
- **Total Documents Inspected**: 11 (8 scored role JDs, 2 scored candidate documents, 1 dev control)

## Invariant Verification Summary

| Document ID | Partition | Chars | Units | Min Len | Max Len | Slices 100% Exact | Abbreviations Checked | Glued Headings Isolated | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `DIVERSE_ROLE_01` | DIVERSE_ROLE | 2331 | 19 | 8 | 334 | YES | N/A | YES | **PASS** |
| `DIVERSE_ROLE_02` | DIVERSE_ROLE | 5589 | 44 | 11 | 271 | YES | N/A | YES | **PASS** |
| `DIVERSE_ROLE_03` | DIVERSE_ROLE | 4267 | 36 | 15 | 311 | YES | N/A | YES | **PASS** |
| `DIVERSE_ROLE_04` | DIVERSE_ROLE | 7240 | 56 | 19 | 243 | YES | N/A | YES | **PASS** |
| `ADV_ROLE_01` | ADVERSARIAL_ROLE | 916 | 11 | 13 | 153 | YES | N/A | YES | **PASS** |
| `ADV_ROLE_02` | ADVERSARIAL_ROLE | 1013 | 12 | 17 | 168 | YES | N/A | YES | **PASS** |
| `ADV_ROLE_03` | ADVERSARIAL_ROLE | 857 | 11 | 15 | 139 | YES | N/A | YES | **PASS** |
| `ADV_ROLE_04` | ADVERSARIAL_ROLE | 1009 | 13 | 16 | 138 | YES | N/A | YES | **PASS** |
| `DEV_CONTROL_01` | DEVELOPMENT_CONTROL | 8552 | 81 | 26 | 405 | YES | Preserved 'Pvt. Ltd.' | YES | **PASS** |
| `CANDIDATE_RESUME_01` | CANDIDATE_DOCUMENT | 5681 | 54 | 6 | 225 | YES | N/A | YES | **PASS** |
| `CANDIDATE_RESUME_02` | CANDIDATE_DOCUMENT | 6581 | 50 | 8 | 323 | YES | N/A | YES | **PASS** |

## Specific Case Review Findings

1. **Abbreviation Protection**: In `DEV_CONTROL_01`, `Reports To: Board of Directors, Schnell Builders Pvt. Ltd.` remains unified as `S003` without erroneous split at `Pvt.`. `Sell.Do or equivalent` remains unified as `S041` without erroneous split at `Sell.Do`.
2. **Markdown & Bullet Lists**: In `CANDIDATE_RESUME_01` and `CANDIDATE_RESUME_02`, all markdown bullets and job position headers are cleanly isolated into distinct units (54 and 50 units respectively).
3. **Glued Scraped Layouts**: In `DIVERSE_ROLE_01`, `DIVERSE_ROLE_02`, and `DIVERSE_ROLE_03`, unspaced HTML-stripped list transitions (e.g. `changesKey`, `channelsLead`) are mechanically isolated into distinct units of reasonable length (min 8-15 chars, max 271-334 chars) with zero 1,000+ char mega-units.
4. **Adversarial Boundary Isolation**: In `ADV_ROLE_01` through `ADV_ROLE_04`, negation disclaimers, reporting vs. advisory lines, team scale milestones, and preferred vs. mandatory qualifications are cleanly preserved in atomic units.
5. **Strict Non-Semantic Invariant**: The segmenter uses zero semantic keywords (no checks for `P&L`, `reports to`, `salary`, `ownership`, etc.). All boundaries are purely structural punctuation, newline, and casing layout transitions.

## Mechanical Certification
**TOTAL DOCUMENTS VERIFIED**: 11
**TOTAL UNITS GENERATED**: 387
**TOTAL INVARIANT ERRORS**: 0
**RESULT**: CERTIFIED_FROZEN