-- 035: Persist deterministic candidate-eligibility outcomes.
--
-- Candidate projection remains the binary serving boundary. These nullable,
-- additive fields retain the tri-state policy outcome and the geographic
-- evidence that produced it, without reinterpreting existing projections.

ALTER TABLE search_plan_candidates ADD COLUMN eligibility TEXT
  CHECK (eligibility IS NULL OR eligibility IN ('ELIGIBLE', 'REVIEW', 'INELIGIBLE'));

ALTER TABLE search_plan_candidates ADD COLUMN eligibility_reason_codes_json TEXT;

ALTER TABLE search_plan_candidates ADD COLUMN location_policy TEXT
  CHECK (location_policy IS NULL OR location_policy IN ('GURUGRAM_ONLY', 'NCR', 'REMOTE_COMPATIBLE', 'NATIONWIDE'));

ALTER TABLE search_plan_candidates ADD COLUMN location_evidence TEXT;

