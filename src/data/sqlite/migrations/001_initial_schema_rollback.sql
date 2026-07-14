-- Rollback Migration 001

DROP TABLE IF EXISTS outcomes;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS recommendations;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS preference_profiles;
DROP TABLE IF EXISTS career_profiles;
DROP TABLE IF EXISTS people;

DROP TABLE IF EXISTS claim_facts;
DROP TABLE IF EXISTS claims;
DROP TABLE IF EXISTS fact_evidence;
DROP TABLE IF EXISTS facts;
DROP TABLE IF EXISTS evidence;
DROP TABLE IF EXISTS extractions;
DROP TABLE IF EXISTS source_listings;
DROP TABLE IF EXISTS opportunities;
DROP TABLE IF EXISTS companies;

DROP TABLE IF EXISTS _migrations;
