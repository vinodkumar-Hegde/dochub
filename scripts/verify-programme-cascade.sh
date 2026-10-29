#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
printf 'DocHub programme cascade: focused local verification\n'
cd "$ROOT/services/api"
npm run typecheck
node --import tsx --test src/programme-targets.test.ts src/sessions-policy.test.ts src/documents-policy.test.ts
npm run build
cd "$ROOT"
npm run build
printf 'PASS: typecheck, cascade/session/upload policies, API and frontend builds\n'
