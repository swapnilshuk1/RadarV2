# FOR-4D5 — CONTROLLED CLIENT FRESHNESS / HOMESCREEN REVALIDATION REPORT

## Executive Summary
FOR-4D5 eliminated the stale pre-FOR-4D3 homescreen state (487 shortlisted) and verified that fresh route entry and loader revalidation correctly surface all 720 shortlisted recommendations (233 remaining unreviewed for executive action) with zero database mutations.

---

## 1. Root Cause Identification
- **Stale State Mechanism**: In an unrefreshed browser tab open during/prior to the background FOR-4D3 evaluation run, TanStack Router's route loader cache held pre-FOR-4D3 metrics where `totalShortlisted = 487`. Because all 487 historical shortlisted items had recorded user decisions in `canonical_decisions`, `shortlistedOps.length` was 0, triggering the empty state card message: *"All 487 shortlist opportunities have recorded decisions."*
- **Category Cache Mechanism**: In `src/routes/index.tsx`, `categoryCacheRef` held category opportunity arrays indefinitely across re-renders without clearing when route loader data updated.

---

## 2. Minimal Application Fix Applied
- Modified `src/routes/index.tsx` to add an `useEffect` hook that automatically clears `categoryCacheRef.current` whenever `opportunitiesList` updates from route loader revalidation.
- Combined with `staleTime: 0` in `createFileRoute('/')`, every fresh route navigation or revalidation re-fetches authoritative server state from Turso Cloud.

---

## 3. Post-Fix Verification & Metrics Alignment
- **Screened**: 3,002
- **Canonical Decisions**: 1,509 (1,498 active candidate decisions)
- **Active PURSUITS**: 308 (100% preserved)
- **ALL Unreviewed**: 1,504
- **TOTAL SHORTLISTED**: 720
- **UNREVIEWED SHORTLIST**: 233
- **NEEDS MORE SIGNAL**: 639 / 639

---

## 4. Test & Data Integrity Certification
- **Database Mutations**: 0
- **Canonical Decisions Changed**: 0
- **Verdicts Changed**: 0
- **Vitest Suite**: 102/102 test files passed (920/920 tests)
