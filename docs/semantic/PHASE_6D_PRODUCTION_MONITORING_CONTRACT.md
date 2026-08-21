# PHASE 6D PRODUCTION MONITORING CONTRACT

============================================================
RADAR V4 CONTINUOUS DRIFT MONITORING CONSTITUTION
============================================================

This contract governs continuous monitoring, distribution drift detection, safety envelopes, and operational stabilization for RADAR V4 in production.

---

## 1. Population Segregation Invariant

All production metrics and alerts MUST execute exclusively against:

$$\text{populationType} = \text{"PRODUCTION"}$$

- **Production Dataset**: Live scraped executive opportunities in Turso Cloud LibSQL (`2,233` records).
- **Golden Fixture Suite**: Fixed regression anchor suite (`14` records, including `j-bmw-india-cmo` $+11.0$ recovery benchmark).
- **Rule**: Golden fixture delta recoveries MUST NEVER be aggregated into production distributions.

---

## 2. Production Score-Delta Safety Envelope

- **Production Observed Max Delta**: `+0.0`
- **Golden Certified Max Delta**: `+11.0`
- **Safety Bounds**:
  - `P0 Alert`: Any unexplained score delta in production ($\Delta \neq 0$ without corresponding registered evidence).
  - `P1 Alert`: Any production score delta exceeding $+11.0$ ($\Delta > 11.0$).
  - `P1 Alert`: Any negative score delta in production ($\Delta < 0$).
  - `P1 Alert`: Any verdict transition that cannot be explicitly traced to a verified semantic evidence node.

---

## 3. High-Risk Polysemous Token Pipeline & Zero-Escape Rule

The 14 polysemous tokens (`target`, `apple`, `amazon`, `shell`, `meta`, `gm`, `md`, `lead`, `head`, `executive`, `manager`, `director`, `account`, `enterprise`) must be continuously tracked across the 6-stage lifecycle:

$$\text{RAW\_DETECTION} \rightarrow \text{CONTEXTUALLY\_RESOLVED} \rightarrow \text{QUARANTINED} \rightarrow \text{NON\_SATISFYING} \rightarrow \text{SATISFYING} \rightarrow \text{SCORING\_ELIGIBLE}$$

- **Mandatory Invariant**: `falsePositiveScoringEscapes === 0`.
- Any false positive that contributes points to candidate scoring triggers an immediate **P0 Incident**.

---

## 4. Confidence & Semantic Distribution Baselines

- **Target Mean Confidence**: $\ge 0.90$ (Currently observed: `0.9324`).
- **Low Confidence Threshold**: $< 0.75$ (Must remain $< 2.0\%$ of total evidence).
- **Stratification**: Metrics must be broken down by source portal (`Workday`, `Naukri`, `LinkedIn`). Sudden drops in evidence density or parser errors must generate a `P2 Calibration Item`.

---

## 5. Calibration Queue Protocol & Zero Auto-Calibration Rule

- Detected drift, unmapped high-confidence synonyms, or portal syntax anomalies MUST be appended to `output/phase6d_calibration_queue.json`.
- **Absolute Invariant**: The engine MUST NEVER automatically alter ontology mappings, confidence thresholds, scoring weights, or policy cutoffs in production. All calibration requires offline verification and approval.
