-- 013: Replace boolean onboarding flag with progressive setup state.
-- V1 assumption: exactly one executive profile per person. Document if this changes.
ALTER TABLE people ADD COLUMN onboarding_progress TEXT DEFAULT '{"orientationSeen":false,"evidenceStatus":"pending","intentStatus":"pending","arrivalSeen":false}';
