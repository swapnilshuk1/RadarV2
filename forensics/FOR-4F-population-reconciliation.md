# FOR-4F Population Reconciliation (All 3,002 Active Candidates)

## 1. Mutually Exclusive Population Segmentation
Every single candidate in the active search plan (`sp_canonical_swapnil`, context `fbcfc83c5f...`) is accounted for in this exact segmentation:

| Population Segment | Count | Evaluated | Sparse Spec | User Decided | Unreviewed | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CURRENT_EVALUATED_WITH_USER_DECISION** | **1,416** | Yes | No | Yes | No | Evaluated in active context with historical user choice. |
| **CURRENT_EVALUATED_UNREVIEWED** | **947** | Yes | No | No | Yes | Evaluated in active context, pending user review. |
| **CURRENT_SPARSE_SPEC_WITH_USER_DECISION** | **82** | No | Yes | Yes | No | Low-text job (<25 words) with historical user choice. |
| **CURRENT_SPARSE_SPEC_UNREVIEWED** | **557** | No | Yes | No | Yes | Low-text job (<25 words) pending user review / signal. |
| **TOTAL CANDIDATES** | **3,002** | **2,363** | **639** | **1,498** | **1,504** | **100% Corpus Coverage** |

## 2. Core Population Equations
1. $\text{Total Active Candidates} = \text{Evaluated (2,363)} + \text{Sparse Spec (639)} = \mathbf{3,002}$
2. $\text{Total User Decisions} = \text{Evaluated Decided (1,416)} + \text{Sparse Decided (82)} = \mathbf{1,498}$
3. $\text{Total Unreviewed} = \text{Evaluated Unreviewed (947)} + \text{Sparse Unreviewed (557)} = \mathbf{1,504}$
4. $\text{Total Active Candidates} = \text{Decisions (1,498)} + \text{Unreviewed (1,504)} = \mathbf{3,002}$
