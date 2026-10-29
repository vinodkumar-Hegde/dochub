#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$project_root/services/api"
cd "$api_dir"

if [[ ! -f .env ]]; then
  echo 'Missing services/api/.env; stopping without consuming queue messages.' >&2
  exit 1
fi
if [[ -z "${AWS_PROFILE:-}" ]]; then
  echo 'Export AWS_PROFILE with your authenticated DOCUSEND profile before running this script.' >&2
  exit 1
fi
if [[ ! -d node_modules/tsx ]]; then
  echo 'Missing API dependencies. Install dependencies in services/api first.' >&2
  exit 1
fi

# Node 22 reads gitignored local configuration; do not source secrets into shell history.
# The worker itself checks Poppler, performs a harmless ClamAV scan,
# connects to PostgreSQL, and resolves the AWS SDK credential provider before polling.
exec node --env-file=.env --import tsx src/worker.ts
