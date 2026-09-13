# Gate 1B Batch 06 — Candidate Document Provenance & Privacy Certification

**Date**: 2026-09-13  
**Status**: Certified Synthetic & Anonymized (Zero Third-Party PII)  
**Governance Scope**: Gate 1B Batch 06 Blind Validation (Step 3A)

---

## 1. Provenance Statement
All 24 candidate documents packaged for Gate 1B Batch 06:
- **Primary Certification Corpus**: 16 candidate resumes (`PRIMARY_CANDIDATE_01.md` through `PRIMARY_CANDIDATE_16.md`)
- **Secondary Remediation Holdout**: 8 candidate resumes (`SECONDARY_CANDIDATE_01.md` through `SECONDARY_CANDIDATE_08.md`)

are **100% synthetic benchmarking artifacts**, procedurally assembled specifically to stress-test candidate schema extraction, chronology parsing, metric retention, and employer attribution.

## 2. Privacy & PII Invariants
1. **No Third-Party PII**: Zero real individuals, personal resumes, or confidential career profiles are stored, tracked, or committed to Git history.
2. **Fictitious Entities & Personas**:
   - Persona names (e.g. *Rajesh Nair*, *Sunita Sharma*, *Arun Krishnamurthy*, *Priya Venkatesh*, *Vikram Malhotra*, etc.) are synthetic test personas.
   - Employer names (e.g. *CloudScale Technologies*, *OmniRetail India*, *FinTech Nexa*, *HealthBridge India*, *LogiMove India*, *BrandPulse India*, *SecureNet Asia*) are fictitious enterprise entities created for benchmark testing.
   - Contact identifiers utilize reserved RFC 2606 domain names (`@example.com`) and generic non-routable dummy phone sequences (`(+91) 98860 12345`).
3. **Repository Cleanliness**: No private candidate data from local storage or cloud Turso DB candidate profile records (`people`, `candidate_profiles`) was copied into these fixtures.
4. **Permanent Safe Commits**: Because these documents contain zero proprietary, personal, or third-party data, committing their text and cryptographic hashes satisfies all privacy and copyright requirements.
