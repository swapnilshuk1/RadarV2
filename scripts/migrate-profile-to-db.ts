/**
 * Retired pre-production migration entrypoint.
 *
 * Static candidate-profile.json is not an authoritative candidate source and
 * must not overwrite the source-bound projection used by evaluation contexts.
 * Use the normal profile document pipeline (or the explicit authoritative
 * bootstrap utility) so projection version and source bindings remain intact.
 */
console.error(
  "STATIC_PROFILE_MIGRATION_DISABLED: use the source-bound candidate document pipeline instead.",
);
process.exit(1);
