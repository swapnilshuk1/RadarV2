# RADAR Remediation Status

Baseline:
- base commit: `1f440e34f32fe06637596f5e48c2417f1bc19e19`
- branch: `remediation/01-auth-permission-non-escalation`
- certification status: baseline typecheck passed; the certification and build runners start but this terminal integration returns before their child-process completion status. The Gate 0 integrity suites pass (16 tests); the new authorization regression fails as expected against the confirmed defect.

## Completed
- Current branch head — Gate 0 safety coverage made mandatory; added the authorization permission non-escalation regression matrix.
- Current branch head — repaired Gate 0b test fixtures so evaluated-output assertions establish candidate, opportunity, and referential prerequisites.

## Current
- remediation ID: Gate 1 / Remediation 2 — authorization capability non-escalation
- branch: `remediation/01-auth-permission-non-escalation`
- reproduction status: confirmed and repaired. The non-admin resolver branch constructed `effectivePermissions` with unconditional `run:scraper` and `read:credentials`; it now preserves normalized stored grants. `manage:search_plan` remains an explicit scrape-entry policy only, not a capability grant.

## Blocked / Requires Decision
- This terminal integration does not retain final output/exit status for nested `npm run certify` or `npm run build` child processes. An external run is required to distinguish an application hang from the runner defect.

## Deferred
- Gate 1 remediations 1 and 3 through 5 remain deferred pending external review of this isolated authorization change.
