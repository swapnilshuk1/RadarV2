-- Migration 015: Add reviewed_fingerprint column to decisions table for evaluation provenance
ALTER TABLE decisions ADD COLUMN reviewed_fingerprint TEXT;
