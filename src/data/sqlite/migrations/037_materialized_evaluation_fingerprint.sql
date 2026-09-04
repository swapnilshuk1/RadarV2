-- Gate 2 provenance closure: context identity and exact evaluation identity
-- are distinct facts. Existing derived rows remain nullable and are served as
-- INVALID until rematerialized from their canonical intrinsic payload.
ALTER TABLE materialized_evaluations ADD COLUMN evaluation_fingerprint TEXT;
