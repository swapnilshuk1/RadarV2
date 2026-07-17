<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# RADAR Evidence Invariants

> [!IMPORTANT]
> - Raw normalized text must always be persisted alongside structured evidence within document content.
> - Extractors should remain replaceable and reproducible from this raw text at any point.

# RADAR Architectural Complexity Guardrails

> [!IMPORTANT]
> - **Every new layer must replace complexity below it, not add complexity beside it.**
> - **Every new feature must attach to an existing layer before introducing a new layer.**
>   * *A new technology?* Extend the Technology ontology.
>   * *A new executive signal?* Extend an existing structural extractor (e.g., `mandate`, `commercialAccountability`, or `reportingLine`).
>   * *A new recommendation heuristic?* Extend Capability scoring.
>   * Only create a brand-new layer if the existing architecture cannot express the new concept without becoming inconsistent. This prevents the gradual accumulation of parallel pipelines, duplicate abstractions, and special-case logic.
> - If a proposed feature introduces another ontology, graph, or extraction stage, it must convincingly answer two questions before it is accepted:
>   1. What specific user decision does this improve?
>   2. Why can't the existing `Technology ──► Capability ──► Recommendation` pipeline answer it?
> - If those questions cannot be answered convincingly, **do not build the new layer**. Every component must directly support helping an executive decide whether a job is worth pursuing, rather than becoming an increasingly sophisticated information extraction system.
# RADAR Corpus Taxonomy & Valuation

> [!IMPORTANT]
> - **The Tier 1 Corpus is the primary asset of RADAR.** Data acquisition has higher marginal value than architectural or ontology engineering.
> - **Frozen Corpus Tier Definitions**:
>   * **Tier 1 (Modern Corpus)**: Full raw normalized source text preserved. Golden standard, reproducible, auditable.
>   * **Tier 2 (Legacy Structured)**: Structured legacy evidence present, but raw text is missing. Useful but permanently limited and non-replayable.
>   * **Tier 3 (Blind Corpus)**: Completely empty or missing text. Pure technical debt; candidate for replacement/deprecating.

# Sprint 2 to Sprint 3 Transition Readiness Gates

> [!IMPORTANT]
> Do NOT transition from Sprint 2 (Modernize the Corpus) to Sprint 3 (Richer Corpus Mining) until ALL five of the following readiness criteria are met:
> 1. **Representative Decision Coverage**: $\ge 250$ unique Tier 1 documents **AND** decision space bounds strictly met:
>    * Every target executive function represented ($\ge 5\%$).
>    * Every employer archetype represented (Mid Market, Enterprise, GCC, Startup, PE-backed).
>    * No dominant function $> 30\%$ of the population.
>    * No employer archetype $> 40\%$ of the population.
> 2. **Ingestion Modernization Rate**: $\ge 99\%$ over recent runs.
> 3. **Integrity Failures**: $0$ (verified by `npm run test:eqe` check).
> 4. **Portal Success**: Stable over multiple runs (verified by Portal Health summaries).
> 5. **Duplicate Rate**: Within expected operating range.
