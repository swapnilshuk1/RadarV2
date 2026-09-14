# RADAR v2 Gate 1B — Non-Technical Adjudication Web Portal Guide

This guide describes the 1-page web portal designed for non-technical human adjudicators to annotate and reconcile reference ground truth for Gate 1B Batch 06 without handling raw JSON files, hashes, or offsets.

---

## 1. Quick Start

To launch the adjudication portal, run:

```powershell
npm run adjudication:app
```
*(or `npx tsx scripts/transition/adjudication-server.ts`)*

The server will start on port `4050`:
```text
================================================================
  RADAR v2 Gate 1B — Human Adjudication Portal
================================================================
  Reviewer 1 URL : http://localhost:4050/reviewer1
  Reviewer 2 URL : http://localhost:4050/reviewer2
  Reconciler URL : http://localhost:4050/reconcile
----------------------------------------------------------------
  Materials Dir  : audit-reports/gate1b-batch06/annotation
================================================================
```

*(If running on a remote server like Oracle Cloud, substitute `localhost` with the server IP: `http://161.118.175.246:4050/...`)*

---

## 2. The 3 Direct Links for the Team

Share each direct link with the corresponding person:

| Role | Person | Direct URL | What They See & Do |
| :--- | :--- | :--- | :--- |
| **Reviewer 1** | First Independent Reviewer | [http://localhost:4050/reviewer1](http://localhost:4050/reviewer1) | Reads clean text on the left, highlights sentences to quote them, selects categories, clicks **Add Fact**, and clicks **Save & Next**. Works 100% blind without seeing Reviewer 2. |
| **Reviewer 2** | Second Independent Reviewer | [http://localhost:4050/reviewer2](http://localhost:4050/reviewer2) | Identical independent interface. Works 100% blind without seeing Reviewer 1. |
| **Adjudicator** | Reconciler / Arbiter | [http://localhost:4050/reconcile](http://localhost:4050/reconcile) | Sees Reviewer 1 and Reviewer 2 facts side-by-side. One-click **Auto-Pair** for agreed facts, one-click arbitration for discrepancies, and saves the authoritative reconciliation. |

---

## 3. How It Works (Fool-Proof for Non-Tech Users)

### A. Independent Reviewer Workflow (`/reviewer1` & `/reviewer2`)

1. **Enter Your Name**: In the top navigation bar, type your name or ID (e.g. `ALICE`). The browser remembers it automatically.
2. **Select Document**: Use the document dropdown or click **◀ Prev / Next ▶**.
   - Completed documents show a green `[✓]`.
   - Incomplete documents show `[○]`.
3. **Read & Highlight**:
   - The original Job Description (or Candidate Resume) appears in the left panel.
   - Simply **highlight any sentence with your mouse**; the quote box on the right fills automatically with the exact text and character offsets.
4. **Choose Category & Options**:
   - Pick the category from the dropdown (e.g. *Reporting Line*, *P&L Ownership*, *Budget Scope*, *Team Size*, *0-to-1 Build*).
   - Select **Affirmed** (role does this) or **Negated** (JD explicitly says role does NOT do this, like "no direct reports").
   - Click **+ Add Fact**.
5. **Save**:
   - Click **Save & Go Next ➔**.
   - The portal validates the fact schema instantly in real-time, writes the `*_REV1.json` or `*_REV2.json` file to disk, and moves to the next document.

---

### B. Adjudicator Workflow (`/reconcile`)

1. **Check Readiness**:
   - The document dropdown flags documents as:
     - `[✓ Ready]` (Both Reviewer 1 and Reviewer 2 have submitted).
     - `[Waiting]` (One or both reviewers haven't submitted yet).
     - `[★ Reconciled]` (Already adjudicated and finalized).
2. **Side-by-Side Review**:
   - When viewing a ready document, Reviewer 1's facts appear in the left column and Reviewer 2's facts appear in the right column.
3. **One-Click Reconciliation**:
   - Click **⚡ Auto-Pair All Matching Facts as AGREED**: Pairs overlapping facts automatically and marks them as `AGREED`.
   - For any fact unique to one reviewer or where they diverged, click **+ Use REV1 Fact** or **+ Use REV2 Fact** to adjudicate the authoritative version.
4. **Final Save & Validation**:
   - Click **Save Progress** or **Save & Go Next ➔**.
   - The portal:
     1. Automatically computes SHA-256 hashes of `*_REV1.json` and `*_REV2.json`.
     2. Sets `dualReviewVerified: true` and attaches the adjudicator ID.
     3. Cross-verifies all fact IDs.
     4. Runs canonical validation against the Gate 1B schema.
     5. Saves the final authoritative `*_RECONCILIATION.json`.

---

## 4. Final Automated Ingestion Check

Once the human team has finished annotating and reconciling a holdout, run the ingestion tool to compile the frozen truth:

```powershell
npx tsx scripts/transition/ingest-batch06-human-truth.ts primary
```
*(and `secondary` when secondary is completed)*

The tool checks 100% population completeness (50 roles + 16 candidates for Primary) and outputs the final cryptographic reference truth hash.
