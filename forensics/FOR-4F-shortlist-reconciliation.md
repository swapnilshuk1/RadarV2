# FOR-4F Shortlist Numbers Forensic Reconciliation

## 1. Reconstructing All Observed Shortlist Numbers

| Observed Number | Exact Population Definition | Status |
| :--- | :--- | :--- |
| **82** | **Actionable Review Queue**: Unreviewed Engine PURSUE (18) + Unreviewed Engine CONSIDER (64) awaiting review. | **AUTHORITATIVE LIVE QUEUE** |
| **102** | **Total Engine Qualified**: All opportunities where the engine issued PURSUE (22) or CONSIDER (80). | **AUTHORITATIVE ENGINE FIT** |
| **330** | **Total Executive Pursuits**: All opportunities marked PURSUE by the user (`canonical_decisions.action = 'PURSUE'`). | **AUTHORITATIVE USER PURSUITS** |
| **432** | **Combined Shortlist Interest**: 330 User Pursuits + 82 Unreviewed Engine Shortlist + 20 Reviewed Engine Shortlist. | **COMBINED INTEREST POOL** |
| **569** | Legacy composite snapshot (User Pursuits + Considered + Unreviewed + Historical test matches). | **LEGACY CACHED METRIC** |
| **487** | Total positive candidate interest pool in earlier migration state (330 Pursues + 138 Considers + 19 Explicit). | **LEGACY SNAPSHOT** |
| **720** | Unreviewed candidate queue before full evaluation wave hydration (865 - 145). | **LEGACY WAVE DELTA** |

## 2. Conclusion
The true, live unreviewed shortlist presented on the homepage is **82**.
