#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
printf '\nDocHub document permissions — focused local release candidate verification\n'
if [[ ! -d services/api/node_modules || ! -d node_modules ]]; then
  echo 'Dependencies missing. Install existing project dependencies before verification.' >&2
  exit 1
fi
cd services/api
npm run db:migrate
npm run db:generate
npm run typecheck
node --import tsx --test src/document-permissions.test.ts src/worker-prerequisites.test.ts
npm run build
cd ../..
npm run build
printf '\nLocal builds and focused tests passed. Restart the one existing DocHub API and PDF worker.\n'
printf 'Existing PDFs require the explicit preview-backfill command in docs/operations/DOCHUB-DOCUMENT-PERMISSIONS.md.\n'
printf 'No GitHub push or infrastructure update was performed.\n'
