# FOR-4F Evaluation Count Reconciliation (Resolving Conflicting Counts)

## 1. The Apparent Conflict
- **Prior Report 1**: Stated 2,363 Evaluated, 639 Sparse Spec.
- **Prior Report 2**: Stated 865 Evaluated, 639 Sparse Spec, 1,498 Unmaterialized.

## 2. Mathematical & Code Resolution
The divergence arose from different SQL filter definitions in intermediate audit scratch scripts:

$$\begin{aligned}
\text{Total Active Corpus} &= 3,002 \\
\text{Total Evaluated in Active Context} &= 2,363 \\
\text{Evaluated with User Decisions} &= 1,416 \\
\text{Evaluated Unreviewed} &= 947 \\
\text{Evaluated Unreviewed (minus Sparse overlap)} &= 865 \\
\text{Total Sparse Spec} &= 639 \\
\text{Sparse with Decisions} &= 82 \\
\text{Sparse Unreviewed} &= 557
\end{aligned}$$

- When an audit script queried `WHERE evaluation_context_fingerprint = ? AND d.action IS NULL`, it counted only **unreviewed evaluations** (yielding ~865–947) and mistook the 1,498 user-decided items for "unmaterialized".
- In reality, all **2,363 evaluated opportunities** and **639 sparse specs** are materialized in the active context `fbcfc83c5f...`.
