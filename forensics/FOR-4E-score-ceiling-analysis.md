# FOR-4E Score Ceiling & Formula Mathematical Analysis

## 1. The Model C Mathematical Formulation
The intrinsic quality score is calculated by `QualityScoreCalculator.calculate` as:

$$\text{Quality Score} = \left(\frac{0.30}{0.65}\right) \text{Career} + \left(\frac{0.15}{0.65}\right) \text{Capability} + \left(\frac{0.20}{0.65}\right) \text{Opportunity}$$

$$\text{Quality Score} = 0.4615 \times \text{Career} + 0.2308 \times \text{Capability} + 0.3077 \times \text{Opportunity}$$

## 2. The Root Cause of the 83-Point Ceiling
When scraped job descriptions lack explicit executive compensation ranges or private company financials:
1. **Opportunity Assessment Fallback**: Defaults to **80** (`src/lib/intelligence/policy/QualityScoreCalculator.ts:114`).
2. **Career Assessment Baseline**: Anchored at **80** minus regression penalties (`QualityScoreCalculator.ts:110`).
3. **Capability Fit**: Varies from $0$ to $100$ based on skill overlap.

### Theoretical Bounds:
- Even at **100% Capability Fit** ($100$):
  $$\text{Score} = (0.4615 \times 80) + (0.2308 \times 100) + (0.3077 \times 80) = 36.92 + 23.08 + 24.62 = \mathbf{84.62} \approx \mathbf{85}$$
- At **90% Capability Fit** ($90$):
  $$\text{Score} = (0.4615 \times 80) + (0.2308 \times 90) + (0.3077 \times 80) = 36.92 + 20.77 + 24.62 = \mathbf{82.31} \approx \mathbf{83}$$

## 3. Conclusion
The 83-point score ceiling is a **direct mathematical consequence** of the default 80-point prior fallbacks on incomplete public JD metadata. It is mathematically impossible for any opportunity to score 90+ without modifying these fallback priors.
