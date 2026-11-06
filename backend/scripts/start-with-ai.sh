#!/usr/bin/env bash
# Local interactive startup. Real credentials stay in this process environment.
set +x
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ "$(node --version)" != v24.19.* ]]; then
  printf '%s\n' 'Put Node 24.19.0 on PATH before starting this backend.' >&2
  exit 2
fi
read -rsp 'Cloudflare Account ID (hidden): ' CLOUDFLARE_ACCOUNT_ID
printf '\n'
read -rsp 'Cloudflare Workers AI token (hidden): ' CLOUDFLARE_AUTH_TOKEN
printf '\n'
export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_AUTH_TOKEN
exec node --import tsx src/server.ts
