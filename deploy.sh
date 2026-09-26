#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point. The canonical deploy contract is scripts/deploy.ts.
exec npx tsx scripts/deploy.ts "$@"
